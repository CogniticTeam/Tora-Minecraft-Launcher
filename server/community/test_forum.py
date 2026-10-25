import base64
import json
import sqlite3
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from fastapi.testclient import TestClient

from app import create_app, verify_ticket
from forum import Forum, ForumError
from backup import backup


class ForumTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'forum.sqlite3'
        self.forum = Forum(self.path, ['owner'])
        self.call('PUT', '/me', {'nickname': '站点管理员'}, 'owner')
        self.call('PUT', '/me', {'nickname': '测试玩家一'}, 'one')
        self.call('PUT', '/me', {'nickname': '测试玩家二'}, 'two')

    def tearDown(self):
        self.tmp.cleanup()

    def call(self, method, path, body=None, subject='owner', key=None, params=None):
        return self.forum.handle(method, path, params=params, data=body, subject=subject, idempotency=key)[0]

    def make_post(self, subject='owner', title='一个可复现的测试问题', key='post-key-000000001', **extra):
        body = dict(type='help', title=title, body='这是足够长的测试正文，包含实际问题。', version='1.21.1', loader='Fabric')
        body.update(extra)
        return self.call('POST', '/posts', body, subject, key)['data']

    def error(self, code, operation):
        with self.assertRaises(ForumError) as caught:
            operation()
        self.assertEqual(caught.exception.code, code)

    def test_new_categories_and_staff_only_announcements(self):
        self.error('forbidden', lambda: self.make_post('one', type='notice'))
        for category in ('news', 'be-addon', 'je-mod', 'texture', 'map', 'tool', 'server', 'team', 'video', 'creation', 'coding', 'feedback', 'bug', 'suggestion', 'notice'):
            self.forum.post_input(dict(type=category,title='分类验证',body='足够长的分类验证正文内容',version='1.21.1',loader='不限',source_url='https://example.com/resource',original_author='ResourceAuthor'))
        self.make_post(type='notice',key='category-notice-0001')
        self.make_post(type='je-mod',key='category-je-mod-00001',source_url='https://example.com/resource',original_author='ResourceAuthor')
        result = self.call('GET', '/posts', params={'type':'je-mod'})
        self.assertEqual(len(result['data']), 1)
        self.assertEqual(result['category_counts']['notice'], 1)

    def test_idempotency_is_atomic_and_content_change_is_rejected(self):
        with ThreadPoolExecutor(8) as pool:
            results = list(pool.map(lambda _: self.make_post(), range(8)))
        self.assertEqual(len({p['id'] for p in results}), 1)
        self.assertEqual(len(self.call('GET', '/posts')['data']), 1)
        self.error('idempotency_conflict', lambda: self.make_post(title='同一幂等键的不同内容'))

    def test_author_ownership_and_revision_conflicts(self):
        post = self.make_post()
        body = {k: post[k] for k in ('type', 'title', 'body', 'version', 'loader', 'source_url', 'original_author', 'revision')}
        self.error('forbidden', lambda: self.call('PATCH', '/posts/' + post['id'], body, 'two'))
        body['title'] = '作者修改后的标题'
        changed = self.call('PATCH', '/posts/' + post['id'], body)['data']
        self.assertEqual(changed['revision'], 2)
        self.error('revision_conflict', lambda: self.call('PATCH', '/posts/' + post['id'], body))

    def test_new_user_review_and_moderation_permissions(self):
        post = self.make_post('one')
        self.assertEqual(post['status'], 'pending')
        self.assertEqual(self.call('GET', '/posts', subject=None)['data'], [])
        self.error('not_found', lambda: self.call('GET', '/posts/' + post['id'], subject='two'))
        action = dict(action='approve', target_type='post', target_id=post['id'], revision=post['revision'], reason='审核通过')
        self.error('forbidden', lambda: self.call('POST', '/moderation/actions', action, 'two'))
        self.call('POST', '/moderation/actions', action)
        self.assertEqual(len(self.call('GET', '/posts', subject=None)['data']), 1)
        post = self.call('GET', '/posts/' + post['id'], subject='one')['data']
        edit = {k: post[k] for k in ('type', 'title', 'body', 'version', 'loader', 'source_url', 'original_author', 'revision')}
        self.assertEqual(self.call('PATCH', '/posts/' + post['id'], edit, 'one')['data']['status'], 'pending')

    def test_comments_acceptance_and_private_notifications(self):
        post = self.make_post()
        comment = self.call('POST', '/posts/' + post['id'] + '/comments', {'body': '来自另一位玩家的帮助'}, 'one', 'comment-key-000001')['data']
        self.error('forbidden', lambda: self.call('PUT', '/posts/' + post['id'] + '/accepted-answer', {'comment_id': comment['id']}, 'two'))
        result = self.call('PUT', '/posts/' + post['id'] + '/accepted-answer', {'comment_id': comment['id']})['data']
        self.assertEqual(result['accepted_comment_id'], comment['id'])
        self.assertEqual(self.call('GET', '/notifications', subject='one')['data'][0]['kind'], 'accepted')
        self.assertEqual(self.call('GET', '/notifications', subject='two')['data'], [])
        self.assertIsNone(self.call('DELETE', '/posts/' + post['id'] + '/accepted-answer')['data']['accepted_comment_id'])

    def test_reply_cannot_reference_another_post_or_nest_indefinitely(self):
        p1 = self.make_post()
        p2 = self.make_post(key='post-key-000000002')
        first = self.call('POST', '/posts/' + p1['id'] + '/comments', {'body': '第一层回复'}, 'one', 'comment-key-000001')['data']['id']
        self.error('invalid_parent', lambda: self.call('POST', '/posts/' + p2['id'] + '/comments', {'body': '错误跨帖回复', 'parent_id': first}, 'two', 'comment-key-000002'))
        second = self.call('POST', '/posts/' + p1['id'] + '/comments', {'body': '第二层回复', 'parent_id': first}, 'two', 'comment-key-000003')['data']['id']
        third = self.call('POST', '/posts/' + p1['id'] + '/comments', {'body': '展平后的回复', 'parent_id': second}, 'owner', 'comment-key-000004')['data']['id']
        comments = self.call('GET', '/posts/' + p1['id'] + '/comments')['data']
        self.assertEqual(next(c for c in comments if c['id'] == third)['parent_id'], first)

    def test_no_self_accept_and_unique_likes_bookmarks(self):
        p = self.make_post()
        comment = self.call('POST', '/posts/' + p['id'] + '/comments', {'body': '作者自己的回复'}, key='comment-key-000001')['data']['id']
        self.error('invalid_answer', lambda: self.call('PUT', '/posts/' + p['id'] + '/accepted-answer', {'comment_id': comment}))
        for _ in range(3):
            self.call('PUT', '/posts/' + p['id'] + '/like', subject='two')
            self.call('PUT', '/posts/' + p['id'] + '/bookmark', subject='two')
        self.assertEqual(self.call('GET', '/posts/' + p['id'], subject='two')['data']['likes'], 1)
        self.assertEqual(len(self.call('GET', '/posts', subject='two', params={'saved': '1'})['data']), 1)
        self.assertEqual(self.call('GET', '/posts', subject='one', params={'saved': '1'})['data'], [])

    def test_comment_edit_requires_owner_and_resets_old_acceptance(self):
        p = self.make_post()
        cid = self.call('POST', '/posts/' + p['id'] + '/comments', {'body': '原始有效回复'}, 'one', 'comment-key-000001')['data']['id']
        self.call('PUT', '/posts/' + p['id'] + '/accepted-answer', {'comment_id': cid})
        self.error('forbidden', lambda: self.call('PATCH', '/comments/' + cid, {'body':'试图越权修改', 'revision':1}, 'two'))
        self.call('PATCH', '/comments/' + cid, {'body':'作者编辑后的回复', 'revision':1}, 'one')
        self.error('revision_conflict', lambda: self.call('PATCH', '/comments/' + cid, {'body':'旧版本覆盖', 'revision':1}, 'one'))
        self.assertIsNone(self.call('GET', '/posts/' + p['id'])['data']['accepted_comment_id'])

    def test_report_hide_restore_lock_and_audit(self):
        p = self.make_post()
        self.call('POST', '/reports', {'target_type': 'post', 'target_id': p['id'], 'reason': '测试举报'}, 'one')
        reports = self.call('GET', '/moderation/reports')['data']
        self.assertEqual(len(reports), 1)
        action = dict(action='hide', target_type='post', target_id=p['id'], revision=1, reason='测试隐藏')
        self.call('POST', '/moderation/actions', action)
        self.error('not_found', lambda: self.call('GET', '/posts/' + p['id'], subject='one'))
        self.assertEqual(self.call('GET', '/moderation/reports')['data'], [])
        action.update(action='restore', revision=2)
        self.call('POST', '/moderation/actions', action)
        action.update(action='lock', revision=3)
        self.call('POST', '/moderation/actions', action)
        self.error('post_locked', lambda: self.call('POST', '/posts/' + p['id'] + '/comments', {'body': '被锁定后的回复'}, 'one', 'comment-key-000001'))
        with self.forum.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM moderation_log').fetchone()[0], 3)

    def test_mute_is_server_enforced_and_cannot_target_admin(self):
        target = self.call('GET', '/me', subject='two')['data']['id']
        self.call('POST', '/moderation/actions', dict(action='mute', target_type='profile', target_id=target, reason='测试禁言'))
        self.error('muted', lambda: self.make_post('two'))
        self.error('muted', lambda: self.call('PUT', '/me', {'nickname': '改名绕过禁言'}, 'two'))

    def test_pagination_search_filters_and_restart(self):
        self.make_post(title="带有 % 和 ' 的标题")
        self.make_post(title='另一个版本的帖子', key='post-key-000000002', version='1.20.1')
        first = self.call('GET', '/posts', params={'limit': '1'})
        second = self.call('GET', '/posts', params={'limit': '1', 'cursor': first['next_cursor']})
        self.assertNotEqual(first['data'][0]['id'], second['data'][0]['id'])
        self.assertEqual(len(self.call('GET', '/posts', params={'q': '%'})['data']), 1)
        self.assertEqual(len(self.call('GET', '/posts', params={'version': '1.21.1'})['data']), 1)
        self.forum = Forum(self.path, ['owner'])
        self.assertEqual(len(self.call('GET', '/posts')['data']), 2)
        self.error('invalid_cursor', lambda: self.call('GET', '/posts', params={'cursor': 'invalid'}))

    def test_limits_validation_and_consistent_backup(self):
        self.error('invalid_source_url', lambda: self.make_post(type='pack', source_url='javascript:alert(1)', original_author='作者'))
        switched = self.make_post('one', type='talk', source_url='https://example.test/old-pack', original_author='此前填写的作者')
        self.assertEqual((switched['source_url'], switched['original_author']), ('', ''))
        for i in range(3):
            self.make_post(key='valid-post-key-%03d' % i)
        self.error('rate_limited', lambda: self.make_post(key='valid-post-key-004'))
        dest = Path(self.tmp.name) / 'backup.sqlite3'
        with self.forum.connect() as source, sqlite3.connect(dest) as target:
            source.backup(target)
        copy = Forum(dest, ['owner'])
        self.assertEqual(len(copy.handle('GET', '/posts')[0]['data']), 3)

    def test_deployment_backup_is_standalone_and_restorable(self):
        self.make_post()
        folder = Path(self.tmp.name) / 'backups'
        backup(self.path, folder)
        files = list((folder / 'daily').glob('*.sqlite3'))
        self.assertEqual(len(files), 1)
        self.assertEqual(list((folder / 'daily').glob('*.tmp*')), [])
        with sqlite3.connect(files[0]) as db:
            self.assertEqual(db.execute('PRAGMA journal_mode').fetchone()[0], 'delete')
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM posts').fetchone()[0], 1)


class HttpBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.key = ec.generate_private_key(ec.SECP256R1())
        numbers = self.key.public_key().public_numbers()
        enc = lambda b: base64.urlsafe_b64encode(b).decode().rstrip('=')
        self.public = {'kty':'EC','crv':'P-256','x':enc(numbers.x.to_bytes(32,'big')),'y':enc(numbers.y.to_bytes(32,'big'))}
        self.gateway = 'gateway-test-only-' + 'a' * 40
        self.client = TestClient(create_app(Path(self.tmp.name)/'http.sqlite3', self.gateway, self.public, ['owner'], True))
        self.headers = {'Authorization': 'Bearer ' + self.gateway}

    def tearDown(self):
        self.client.close()
        self.tmp.cleanup()

    def token(self, **changes):
        enc = lambda x: base64.urlsafe_b64encode(x).decode().rstrip('=')
        now = int(time.time())
        claims = dict(iss='https://launcher-api.cogniticteam.com',aud='tora-community',sub='owner',scope=['community:read','community:write'],iat=now,exp=now+300,jti='test-id')
        claims.update(changes)
        h = enc(json.dumps(dict(alg='ES256',typ='JWT',kid='tora-community-v1')).encode())
        p = enc(json.dumps(claims).encode())
        r,s = decode_dss_signature(self.key.sign(f'{h}.{p}'.encode(),ec.ECDSA(hashes.SHA256())))
        return f'{h}.{p}.' + enc(r.to_bytes(32,'big') + s.to_bytes(32,'big'))

    def test_ticket_signature_audience_expiry_and_tampering(self):
        token = self.token()
        self.assertEqual(verify_ticket(token,self.public),'owner')
        for bad in [self.token(aud='launcher'),self.token(exp=int(time.time())-1),token[:-10]+'a'*10,'not.a.jwt']:
            with self.assertRaises(ForumError): verify_ticket(bad,self.public)

    def test_origin_boundary_and_public_read(self):
        self.assertEqual(self.client.get('/health').status_code,401)
        self.assertEqual(self.client.get('/health',headers=self.headers).status_code,200)
        self.assertEqual(self.client.get('/v1/community/posts',headers=self.headers).json()['data'],[])
        self.assertEqual(self.client.get('/v1/community/me',headers=self.headers).status_code,401)

    def test_profile_and_write_input_boundaries(self):
        h = {**self.headers,'X-Community-Authorization':'Bearer '+self.token(sub='minecraft_'+'a'*32,minecraft={'id':'a'*32,'name':'ToraPlayer'})}
        self.assertEqual(self.client.put('/v1/community/me',headers=h,json={'nickname':'站点管理员'}).status_code,200)
        self.assertEqual(self.client.post('/v1/community/posts',headers=h,content='not-json').status_code,415)
        response=self.client.post('/v1/community/posts',headers=h,json={'body':'x'*99000})
        self.assertEqual(response.status_code,413)
        bad={**self.headers,'X-Community-Authorization':'Bearer not.a.ticket'}
        self.assertEqual(self.client.get('/v1/community/me',headers=bad).status_code,401)

    def test_device_sessions_cannot_post_and_official_name_is_authoritative(self):
        guest = {**self.headers, 'X-Community-Authorization': 'Bearer '+self.token()}
        result = self.client.post('/v1/community/posts', headers=guest, json={'type':'talk'})
        self.assertEqual(result.status_code, 403)
        self.assertEqual(result.json()['error']['code'], 'minecraft_login_required')
        official = {**self.headers, 'X-Community-Authorization': 'Bearer '+self.token(sub='minecraft_'+'b'*32, minecraft={'id':'b'*32,'name':'RealPlayer'})}
        result = self.client.get('/v1/community/me', headers=official)
        self.assertEqual(result.json()['data']['nickname'], 'RealPlayer')
        result = self.client.put('/v1/community/me', headers=official, json={'nickname':'PretendName'})
        self.assertEqual(result.json()['data']['nickname'], 'RealPlayer')
        result = self.client.post('/v1/community/posts', headers={**official,'Idempotency-Key':'official-post-key-123'}, json={'type':'talk','title':'正式身份测试','body':'这是一个足够长的正版身份测试内容。','loader':'不限'})
        self.assertEqual(result.status_code, 202)
        self.assertEqual(result.json()['data']['author']['nickname'], 'RealPlayer')
        spoof = {**self.headers, 'X-Community-Authorization': 'Bearer '+self.token(minecraft={'id':'b'*32,'name':'RealPlayer'})}
        self.assertEqual(self.client.get('/v1/community/me', headers=spoof).status_code, 401)


    def test_verified_owner_installation_keeps_existing_admin_access(self):
        official = dict(sub='minecraft_'+'d'*32,minecraft={'id':'d'*32,'name':'OfficialOwner'})
        owned = {**self.headers,'X-Community-Authorization':'Bearer '+self.token(**official,launcher_sub='owner')}
        other = {**self.headers,'X-Community-Authorization':'Bearer '+self.token(**official,launcher_sub='other-installation')}
        self.assertEqual(self.client.get('/v1/community/me',headers=owned).json()['data']['role'], 'admin')
        self.assertEqual(self.client.get('/v1/community/me',headers=other).json()['data']['role'], 'member')
        self.assertEqual(self.client.get('/v1/community/moderation/reports',headers=other).status_code, 403)

    def test_profile_verifier_is_private_and_has_no_token_persistence(self):
        token = 'test-game-token-not-a-real-secret'
        calls = []
        def fetcher(value):
            calls.append(value)
            return {'id':'c'*32, 'name':'VerifiedUser'}
        secret = 'verification-test-secret-'+'v'*40
        with TestClient(create_app(Path(self.tmp.name)/'private.sqlite3', self.gateway, self.public, verify_token=secret, profile_fetcher=fetcher)) as client:
            route = '/internal/minecraft/profile'
            self.assertEqual(client.post(route, headers=self.headers, json={'accessToken':token}).status_code, 401)
            result = client.post(route, headers={'Authorization':'Bearer '+secret}, json={'accessToken':token})
            self.assertEqual(result.json(), {'id':'c'*32,'name':'VerifiedUser'})
            self.assertEqual(calls, [token])
            self.assertEqual(client.get('/health',headers={'Authorization':'Bearer '+secret}).status_code, 401)
            self.assertNotIn(token.encode(), (Path(self.tmp.name)/'private.sqlite3').read_bytes())



if __name__ == '__main__':
    unittest.main()
