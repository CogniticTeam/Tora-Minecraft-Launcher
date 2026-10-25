"""Versioned community configuration and private system-message delivery."""
import json
import re
import time
from forum import ForumError, ident, text

DEFAULT_BOARDS = [
    ("notice", "站务公告", "官方事务"), ("tutorial", "教程中心", "官方事务"),
    ("talk", "闲聊讨论", "综合交流"), ("news", "游戏资讯", "综合交流"), ("help", "悬赏问答", "综合交流"),
    ("be-addon", "BE 附加包", "资源分享"), ("je-mod", "JE 模组", "资源分享"), ("texture", "材质光影", "资源分享"), ("map", "地图存档", "资源分享"), ("tool", "软件工具", "资源分享"),
    ("server", "服务器大厅", "联机广场"), ("team", "组队开黑", "联机广场"),
    ("video", "视频专区", "创作交流"), ("creation", "周边创作", "创作交流"), ("coding", "编程分享", "创作交流"),
    ("feedback", "使用反馈", "反馈站务"), ("bug", "Bug 报告", "反馈站务"), ("suggestion", "意见建议", "反馈站务"), ("pack", "整合包", "资源分享")]
RESOURCE = {"be-addon", "je-mod", "texture", "map", "tool", "pack"}


def init_features(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS boards(id TEXT PRIMARY KEY,name TEXT NOT NULL,group_name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',position INTEGER NOT NULL,enabled INTEGER NOT NULL,resource INTEGER NOT NULL,staff_only INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS system_messages(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,recipient_id TEXT REFERENCES profiles(id),actor_id TEXT NOT NULL REFERENCES profiles(id),created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS message_reads(message_id TEXT NOT NULL REFERENCES system_messages(id),profile_id TEXT NOT NULL REFERENCES profiles(id),read_at INTEGER NOT NULL,PRIMARY KEY(message_id,profile_id));
    CREATE TABLE IF NOT EXISTS review_jobs(id INTEGER PRIMARY KEY,target_type TEXT NOT NULL,target_id TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,UNIQUE(target_type,target_id,revision));
    CREATE TABLE IF NOT EXISTS review_results(id INTEGER PRIMARY KEY,target_type TEXT NOT NULL,target_id TEXT NOT NULL,revision INTEGER NOT NULL,decision TEXT NOT NULL,categories TEXT NOT NULL,reason TEXT NOT NULL,engine TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS review_due ON review_jobs(status,next_at);
    """)
    for i, (key, name, group) in enumerate(DEFAULT_BOARDS):
        db.execute("INSERT OR IGNORE INTO boards VALUES(?,?,?,'',?,1,?,?)", (key, name, group, i * 10, int(key in RESOURCE), int(key == "notice")))


def list_boards(db, include_disabled=True):
    rows = db.execute("SELECT b.*,(SELECT COUNT(*) FROM posts WHERE type=b.id) AS posts FROM boards b " + ("" if include_disabled else "WHERE enabled=1 ") + "ORDER BY b.position,b.id").fetchall()
    return [dict(row) for row in rows]


def save_board(db, data):
    key = text(data, "id", 1, 32)
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", key):
        raise ForumError(422, "invalid_board", "版块标识只能包含小写字母、数字和连字符。")
    name = text(data, "name", 1, 24); group = text(data, "group_name", 1, 24); description = text(data, "description", 0, 160)
    position = data.get("position", 0)
    if type(position) is not int or not 0 <= position <= 10000 or any(type(data.get(k)) is not bool for k in ("enabled", "resource", "staff_only")):
        raise ForumError(422, "invalid_board", "请检查版块排序和权限设置。")
    if key == "notice" and (not data["staff_only"] or data["resource"]):
        raise ForumError(422, "protected_board", "站务公告必须仅管理员可发布。")
    db.execute("INSERT INTO boards VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,group_name=excluded.group_name,description=excluded.description,position=excluded.position,enabled=excluded.enabled,resource=excluded.resource,staff_only=excluded.staff_only", (key, name, group, description, position, int(data["enabled"]), int(data["resource"]), int(data["staff_only"])))
    return dict(db.execute("SELECT * FROM boards WHERE id=?", (key,)).fetchone())


def enqueue_review(db, kind, target_id, revision, force=False):
    now = int(time.time() * 1000)
    if force:
        db.execute("INSERT INTO review_jobs(target_type,target_id,revision,next_at,created_at) VALUES(?,?,?,?,?) ON CONFLICT(target_type,target_id,revision) DO UPDATE SET status='pending',next_at=excluded.next_at,last_error=''", (kind, target_id, revision, now, now))
    else:
        db.execute("INSERT OR IGNORE INTO review_jobs(target_type,target_id,revision,next_at,created_at) VALUES(?,?,?,?,?)", (kind, target_id, revision, now, now))


def inbox(db, actor, before=None, cursor=None):
    args = [actor["id"], actor["id"]]
    condition = ""
    if cursor:
        condition = " AND (m.created_at<? OR (m.created_at=? AND m.id<?))"
        args += [cursor[0], cursor[0], cursor[1]]
    rows = db.execute("SELECT m.*,r.read_at,p.nickname AS actor_name FROM system_messages m JOIN profiles p ON p.id=m.actor_id LEFT JOIN message_reads r ON r.message_id=m.id AND r.profile_id=? WHERE (m.recipient_id IS NULL OR m.recipient_id=?)" + condition + " ORDER BY m.created_at DESC,m.id DESC LIMIT 11", args).fetchall()
    unread = db.execute("SELECT COUNT(*) FROM system_messages m WHERE (m.recipient_id IS NULL OR m.recipient_id=?) AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message_id=m.id AND r.profile_id=?)", (actor["id"], actor["id"])).fetchone()[0]
    if before is not None:
        db.execute("INSERT OR IGNORE INTO message_reads SELECT id,?,? FROM system_messages WHERE created_at<=? AND (recipient_id IS NULL OR recipient_id=?)", (actor["id"], int(time.time() * 1000), before, actor["id"]))
    from forum import Forum
    return {"data": [dict(r) for r in rows[:10]], "unread": unread, "next_cursor": Forum.encode_cursor(rows[9], "created_at") if len(rows) > 10 else None}


def send_message(db, data, actor_id):
    title = text(data, "title", 1, 80); body = text(data, "body", 1, 4000)
    recipient = data.get("recipient_id")
    if recipient is not None:
        if not isinstance(recipient, str) or not re.fullmatch(r"pr_[a-f0-9]{32}", recipient):
            raise ForumError(422, "invalid_recipient", "接收用户标识无效。")
        row = db.execute("SELECT subject FROM profiles WHERE id=?", (recipient,)).fetchone()
        if not row or not row[0].startswith("minecraft_"):
            raise ForumError(422, "invalid_recipient", "请选择已验证的 Minecraft 社区用户。")
    message_id = ident("msg_"); now = int(time.time() * 1000)
    db.execute("INSERT INTO system_messages VALUES(?,?,?,?,?,?)", (message_id, title, body, recipient, actor_id, now))
    return {"id": message_id, "title": title, "body": body, "recipient_id": recipient, "created_at": now}
