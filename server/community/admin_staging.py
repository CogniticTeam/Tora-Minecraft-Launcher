"""Explicit local-only acceptance environment. Never run against the production database."""
import json
from pathlib import Path
import uvicorn
from app import create_app
from moderation import DeepSeekReview

root = Path('/tmp/tmcl-admin-staging')
root.mkdir(mode=0o700, exist_ok=True)
config = json.loads(Path('/tmp/tmcl-admin-private/staging.json').read_text())
app = create_app(root / 'community.sqlite3', config['gateway'], {}, writes=True,
                 admin_token=config['admin'], automatic_review=True,
                 reviewer=DeepSeekReview(Path('/tmp/tmcl-admin-private/deepseek.key').read_text().strip()))
store = app.state.store
with store.connect() as db:
    seeded = db.execute('SELECT COUNT(*) FROM posts').fetchone()[0] > 0
if not seeded:
    for i, name in enumerate(('OakPilot', 'BirchFox'), 1):
        subject = 'minecraft_' + format(i, '032x')
        store.sync_minecraft_profile(subject, name)
        for j, title in enumerate(('Fabric 模组安装笔记', '和朋友一起搭建生存小镇', '资源包与光影兼容问题')):
            store.handle('POST', '/posts', data=dict(type='tutorial' if j == 0 else 'talk', title=title, body='这是本地隔离验收的正常 Minecraft 内容。可以安装兼容的模组、分享建筑思路，并一起讨论资源包的使用体验。', loader='Fabric', version='1.20.1'), subject=subject, idempotency=f'isolated-admin-{i}-{j}-0001')
uvicorn.run(app, host='127.0.0.1', port=18765, log_level='warning', access_log=False)
