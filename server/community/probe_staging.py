"""Deployment smoke test; only connects to the isolated loopback staging instance."""
import json
import sys
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def run(token_path, gateway_path):
    tokens = json.loads(Path(token_path).read_text())
    gateway = next(line.split('=', 1)[1].strip() for line in Path(gateway_path).read_text().splitlines() if line.startswith('COMMUNITY_GATEWAY_TOKEN='))
    base = 'http://127.0.0.1:8766/v1/community'
    suffix = uuid.uuid4().hex[:8]

    def call(method, path, body=None, actor=None, key=None, expected=200):
        headers = {'Authorization': 'Bearer ' + gateway, 'Content-Type': 'application/json'}
        if actor is not None: headers['X-Community-Authorization'] = 'Bearer ' + tokens[actor]
        if key: headers['Idempotency-Key'] = key
        req = Request(base + path, method=method, headers=headers, data=json.dumps(body).encode() if body is not None else None)
        try:
            with urlopen(req, timeout=10) as r: status, data = r.status, json.load(r)
        except HTTPError as e: status, data = e.code, json.load(e)
        assert status == expected, (method, path, status, data.get('error'))
        return data

    for actor in range(3): call('PUT','/me',{'nickname':'部署验收玩家'+str(actor)+'-'+suffix},actor)
    body=dict(type='help',title='独立测试库验收-'+suffix,body='这是隔离环境的测试内容，不会进入正式数据库。',version='1.21.1',loader='Fabric')
    key='stage-post-'+uuid.uuid4().hex
    post=call('POST','/posts',body,0,key,201)['data']
    assert call('POST','/posts',body,0,key,201)['data']['id']==post['id']
    pending=call('POST','/posts',{**body,'title':'待审核-'+suffix},1,'stage-post-'+uuid.uuid4().hex,202)['data']
    call('GET','/posts/'+pending['id'],actor=2,expected=404)
    call('POST','/posts',body,expected=401)
    call('PATCH','/posts/'+post['id'],{**body,'revision':1},2,expected=403)
    def moderate(action,target_type,target_id,revision=None):
        return call('POST','/moderation/actions',dict(action=action,target_type=target_type,target_id=target_id,revision=revision,reason='隔离部署验收'),0)
    moderate('approve','post',pending['id'],1)
    comment=call('POST','/posts/'+post['id']+'/comments',{'body':'另一位玩家的有效回复'},2,'stage-comment-'+uuid.uuid4().hex,201)['data']['id']
    call('PUT','/posts/'+post['id']+'/accepted-answer',{'comment_id':comment},0)
    for _ in range(2):
        call('PUT','/posts/'+post['id']+'/like',{},1)
        call('PUT','/posts/'+post['id']+'/bookmark',{},1)
    assert call('GET','/posts/'+post['id'],actor=1)['data']['likes']==1
    call('POST','/reports',dict(target_type='comment',target_id=comment,reason='隔离举报流程测试'),1)
    assert len(call('GET','/moderation/reports',actor=0)['data'])>=1
    moderate('hide','comment',comment,1)
    assert call('GET','/posts/'+post['id'],actor=1)['data']['accepted_comment_id'] is None
    moderate('restore','comment',comment,2)
    moderate('lock','post',post['id'],1)
    call('POST','/posts/'+post['id']+'/comments',{'body':'锁帖应拒绝回复'},1,'stage-comment-'+uuid.uuid4().hex,403)
    moderate('unlock','post',post['id'],2)
    notices=call('GET','/notifications',actor=2)
    assert notices['unread']>=1
    call('PUT','/notifications/read',{'before':notices['read_before']},2)
    result=dict(post_id=post['id'],pending_id=pending['id'],comment_id=comment,checks='create/replay/ownership/review/comment/accept/like/bookmark/report/hide/restore/lock/notification')
    Path('/root/tora-community-stage-receipt.json').write_text(json.dumps(result))
    print(json.dumps({'staging':'passed','checks':result['checks'],'production_data_written':False}))


if __name__=='__main__': run(sys.argv[1],sys.argv[2])
