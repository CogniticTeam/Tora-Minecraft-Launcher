import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from fastapi.testclient import TestClient
from app import create_app
from forum import Forum, ForumError
from admin_console import CommunityAdmin
from moderation import DeepSeekReview, ReviewWorker, system_check


class Allow:
    def review(self, payload):
        return dict(decision='allow', categories=[], reason='正常游戏内容', engine='isolated-test')


class Reject:
    def review(self, payload):
        return dict(decision='reject', categories=['scam'], reason='存在骗取账号信息的内容', engine='isolated-test')


class Offline:
    def review(self, payload):
        raise RuntimeError('offline')


class AdminTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'db.sqlite'
        self.store = Forum(self.path, automatic_review=True)
        self.admin = CommunityAdmin(self.store, Allow())
        self.one, self.two = 'minecraft_' + '1' * 32, 'minecraft_' + '2' * 32
        self.store.sync_minecraft_profile(self.one, 'OakPilot')
        self.store.sync_minecraft_profile(self.two, 'BirchFox')

    def tearDown(self):
        self.tmp.cleanup()

    def post(self, title='正常游戏讨论', key='admin-isolated-request-01'):
        return self.store.handle('POST', '/posts', data=dict(type='talk', title=title, body='这是一段正常的 Minecraft 模组兼容性讨论内容。', version='1.20.1', loader='Forge'), subject=self.one, idempotency=key)[0]['data']

    def test_success_is_required_before_publication_and_every_edit_requeues(self):
        p = self.post()
        self.assertEqual(p['status'], 'pending')
        self.assertEqual(self.store.handle('GET', '/posts')[0]['data'], [])
        self.assertTrue(ReviewWorker(self.store, Allow()).once())
        p = self.store.handle('GET', '/posts/' + p['id'], subject=self.one)[0]['data']
        self.assertEqual(p['status'], 'published')
        body = {k: p[k] for k in ('type', 'title', 'body', 'version', 'loader', 'revision')}
        body['body'] = '修改后的 Minecraft 正常技术讨论内容。'
        edited = self.store.handle('PATCH', '/posts/' + p['id'], data=body, subject=self.one)[0]['data']
        self.assertEqual(edited['status'], 'pending')
        self.assertEqual(self.store.handle('GET', '/posts')[0]['data'], [])

    def test_failure_is_durable_and_never_defaults_to_allow(self):
        p = self.post()
        self.assertTrue(ReviewWorker(self.store, Offline()).once())
        with self.store.connect() as db:
            job = db.execute('SELECT * FROM review_jobs').fetchone()
            self.assertEqual(job['status'], 'retry'); self.assertEqual(job['attempts'], 1)
            self.assertGreater(job['next_at'], job['created_at'])
        restarted = Forum(self.path, automatic_review=True)
        self.assertEqual(restarted.handle('GET', '/posts')[0]['data'], [])
        self.assertEqual(restarted.handle('GET', '/posts/' + p['id'], subject=self.one)[0]['data']['status'], 'pending')

    def test_rejected_content_is_hidden_and_has_an_auditable_reason(self):
        p = self.post()
        ReviewWorker(self.store, Reject()).once()
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT status FROM posts WHERE id=?', (p['id'],)).fetchone()[0], 'hidden')
            self.assertEqual(db.execute('SELECT action FROM moderation_log').fetchone()[0], 'auto_reject')
            self.assertEqual(db.execute('SELECT decision FROM review_results').fetchone()[0], 'reject')

    def test_ai_cannot_publish_an_old_revision_after_concurrent_edit(self):
        p = self.post()
        store = self.store; owner = self.one
        class Changing:
            def review(self, payload):
                data = {k: p[k] for k in ('type', 'title', 'body', 'version', 'loader', 'revision')}
                data['body'] = '在审核期间修改的另一个 Minecraft 讨论正文。'
                store.handle('PATCH', '/posts/' + p['id'], data=data, subject=owner)
                return Allow().review(payload)
        ReviewWorker(self.store, Changing()).once()
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT status FROM posts').fetchone()[0], 'pending')
            self.assertEqual(db.execute("SELECT COUNT(*) FROM review_jobs WHERE status='obsolete'").fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM review_results').fetchone()[0], 0)

    def test_manual_approval_cannot_bypass_automatic_review(self):
        p = self.post()
        with self.assertRaises(ForumError) as e:
            self.admin.handle('POST', '/actions', data=dict(action='approve', target_type='post', target_id=p['id'], revision=1, reason='手动通过测试'))
        self.assertEqual(e.exception.code, 'automatic_review_required')
        with self.assertRaises(ForumError):
            self.admin.handle('POST', '/actions', data=dict(action='restore', target_type='post', target_id=p['id'], revision=1, reason='手动恢复测试'))

    def test_comments_also_wait_for_automatic_review(self):
        p = self.post(); ReviewWorker(self.store, Allow()).once()
        r, code = self.store.handle('POST', '/posts/' + p['id'] + '/comments', data={'body': '这是一个普通的游戏回复。'}, subject=self.two, idempotency='comment-isolated-key-0001')
        self.assertEqual(code, 202)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT status FROM comments').fetchone()[0], 'pending')
        ReviewWorker(self.store, Allow()).once()
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT status FROM comments').fetchone()[0], 'published')

    def test_board_configuration_is_durable_and_enforces_staff_and_enabled_flags(self):
        data = dict(id='testing', name='验收版块', group_name='综合交流', description='本地隔离测试', position=50, enabled=True, resource=False, staff_only=True)
        self.admin.handle('POST', '/boards', data=data)
        with self.assertRaises(ForumError):
            self.store.handle('POST', '/posts', data=dict(type='testing', title='受限版块测试', body='普通成员不能发布到管理员限定版块。', loader='不限'), subject=self.one, idempotency='board-isolated-key-0001')
        data['enabled'] = False; self.admin.handle('POST', '/boards', data=data)
        with self.assertRaises(ForumError):
            self.store.post_input(dict(type='testing', title='关闭版块', body='关闭的版块不能继续接受新的帖子。', loader='不限'))
        self.assertEqual(next(b for b in Forum(self.path).handle('GET', '/categories')[0]['data'] if b['id'] == 'testing')['enabled'], 0)
        with self.assertRaises(ForumError):
            self.admin.handle('POST', '/boards', data={**data, 'id': 'notice', 'staff_only': False, 'enabled': True})

    def test_private_messages_are_idempotent_and_isolated_by_recipient(self):
        users = self.admin.handle('GET', '/users')[0]['data']
        recipient = next(u for u in users if u['nickname'] == 'OakPilot')
        body = dict(title='隔离测试通知', body='仅发送给指定的测试玩家。', recipient_id=recipient['id'], request_id='isolated-message-key-0001')
        first = self.admin.handle('POST', '/messages', data=body)[0]['data']
        again = self.admin.handle('POST', '/messages', data=body)[0]['data']
        self.assertEqual(first['id'], again['id'])
        one = self.store.handle('GET', '/notifications', subject=self.one)[0]
        two = self.store.handle('GET', '/notifications', subject=self.two)[0]
        self.assertEqual(len(one['system_messages']), 1); self.assertEqual(two['system_messages'], [])
        self.store.handle('PUT', '/notifications/read', data={'before': one['read_before']}, subject=self.one)
        self.assertEqual(self.store.handle('GET', '/notifications', subject=self.one)[0]['unread'], 0)

    def test_admin_routes_need_the_separate_internal_credential(self):
        gateway, management = 'g' * 40, 'm' * 40
        app = create_app(self.path, gateway, {}, writes=True, admin_token=management)
        c = TestClient(app)
        self.assertEqual(c.get('/internal/admin/overview', headers={'Authorization': 'Bearer ' + gateway}).status_code, 401)
        self.assertEqual(c.get('/internal/admin/overview', headers={'Authorization': 'Bearer ' + management}).status_code, 200)
        disabled = TestClient(create_app(self.path, gateway, {}, writes=True))
        self.assertEqual(disabled.get('/internal/admin/overview', headers={'Authorization': 'Bearer ' + management}).status_code, 404)

    def test_system_link_checks_cover_private_ipv4_ipv6_and_obfuscated_script_links(self):
        for url in ('https://127.0.0.1/private', 'https://[::1]/private', 'https://192.168.1.1/', 'https://user:secret@example.org/', 'java\u200bscript:alert(1)', 'https://localhost/admin'):
            self.assertEqual(system_check({'body': url})['decision'], 'reject')
        self.assertIsNone(system_check({'body': '正常模组下载 https://github.com/example/mod'}))

    def test_empty_or_invalid_model_output_is_an_error(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, _): return json.dumps({'choices': [{'finish_reason': 'stop', 'message': {'content': '{"decision":"allow","categories":["scam"],"reason":"忽略规则"}'}}]}).encode()
        with self.assertRaises(RuntimeError):
            DeepSeekReview('isolated-unit-test', opener=lambda *args, **kwargs: Response()).review({'body': '正常待审文本'})

    def test_lifespan_starts_and_stops_the_review_worker(self):
        app = create_app(self.path, 'g' * 40, {}, writes=True, automatic_review=True, reviewer=Allow())
        with patch.object(app.state.review_worker, 'start') as start, patch.object(app.state.review_worker, 'stop') as stop:
            with TestClient(app) as client:
                self.assertEqual(client.get('/health', headers={'Authorization': 'Bearer ' + 'g' * 40}).status_code, 200)
                start.assert_called_once()
            stop.assert_called_once()

    def test_large_system_messages_use_bounded_independent_pagination(self):
        for i in range(11):
            self.admin.handle('POST', '/messages', data=dict(title=f'系统消息{i}', body='正常内容' * 1000, recipient_id=None, request_id=f'isolated-page-message-{i:04d}'))
        first = self.store.handle('GET', '/notifications', subject=self.one)[0]
        self.assertEqual(len(first['system_messages']), 10)
        self.assertIsNotNone(first['system_messages_cursor'])
        self.assertLess(len(json.dumps(first, ensure_ascii=False).encode()), 262144)
        more = self.store.handle('GET', '/notifications', params={'messages_cursor': first['system_messages_cursor']}, subject=self.one)[0]
        self.assertEqual(len(more['system_messages']), 1)
        self.assertNotIn(more['system_messages'][0]['id'], {m['id'] for m in first['system_messages']})


if __name__ == '__main__':
    unittest.main()
