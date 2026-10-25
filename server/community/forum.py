"""Persistent community domain. All ownership and moderation decisions live here."""
import base64
import hashlib
import json
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit


class ForumError(Exception):
    def __init__(self, status, code, message, retry=None):
        self.status, self.code, self.message, self.retry = status, code, message, retry
        super().__init__(code)


def text(data, key, minimum=0, maximum=20000):
    value = data.get(key, "")
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum or "\x00" in value:
        raise ForumError(422, "invalid_" + key, "请检查输入内容及长度。")
    return value.strip()


def ident(prefix):
    return prefix + uuid.uuid4().hex


CATEGORIES = ("notice", "tutorial", "talk", "news", "help", "be-addon", "je-mod", "texture", "map", "tool", "server", "team", "video", "creation", "coding", "feedback", "bug", "suggestion", "pack")
RESOURCE_CATEGORIES = ("be-addon", "je-mod", "texture", "map", "tool", "pack")

SCHEMA = """
CREATE TABLE IF NOT EXISTS profiles(
 id TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'member', muted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS posts(
 id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES profiles(id), type TEXT NOT NULL,
 title TEXT NOT NULL, body TEXT NOT NULL, version TEXT NOT NULL, loader TEXT NOT NULL,
 source_url TEXT NOT NULL DEFAULT '', original_author TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'published', locked INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, activity_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS posts_created ON posts(status,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS posts_activity ON posts(status,activity_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS posts_author ON posts(author_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS comments(
 id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id), author_id TEXT NOT NULL REFERENCES profiles(id),
 parent_id TEXT REFERENCES comments(id), body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published',
 revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id,created_at,id);
CREATE TABLE IF NOT EXISTS accepted_answers(post_id TEXT PRIMARY KEY REFERENCES posts(id),comment_id TEXT UNIQUE NOT NULL REFERENCES comments(id));
CREATE TABLE IF NOT EXISTS likes(profile_id TEXT NOT NULL REFERENCES profiles(id),post_id TEXT NOT NULL REFERENCES posts(id),PRIMARY KEY(profile_id,post_id));
CREATE TABLE IF NOT EXISTS bookmarks(profile_id TEXT NOT NULL REFERENCES profiles(id),post_id TEXT NOT NULL REFERENCES posts(id),created_at INTEGER NOT NULL,PRIMARY KEY(profile_id,post_id));
CREATE TABLE IF NOT EXISTS notifications(
 id TEXT PRIMARY KEY,recipient_id TEXT NOT NULL REFERENCES profiles(id),actor_id TEXT NOT NULL REFERENCES profiles(id),
 kind TEXT NOT NULL,post_id TEXT NOT NULL REFERENCES posts(id),comment_id TEXT,created_at INTEGER NOT NULL,read_at INTEGER);
CREATE INDEX IF NOT EXISTS notifications_recipient ON notifications(recipient_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS reports(
 id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL REFERENCES profiles(id),target_type TEXT NOT NULL,target_id TEXT NOT NULL,
 reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at INTEGER NOT NULL,
 UNIQUE(reporter_id,target_type,target_id));
CREATE TABLE IF NOT EXISTS moderation_log(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency(actor_id TEXT NOT NULL,route TEXT NOT NULL,key TEXT NOT NULL,body_hash TEXT NOT NULL,response TEXT NOT NULL,status INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(actor_id,route,key));
CREATE TABLE IF NOT EXISTS rate_limits(actor_id TEXT NOT NULL,action TEXT NOT NULL,bucket INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(actor_id,action,bucket));
PRAGMA user_version=1;
"""


class Forum:
    def __init__(self, path, admin_subjects=(), review_new=True, automatic_review=False):
        self.path = str(path)
        self.admin_subjects = frozenset(admin_subjects)
        self.review_new = review_new
        self.automatic_review = automatic_review
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(SCHEMA)
            from features import init_features
            init_features(db)
            if self.automatic_review:
                from features import enqueue_review
                for table, kind in (("posts", "post"), ("comments", "comment")):
                    for row in db.execute(f"SELECT id,revision FROM {table} WHERE status='pending'").fetchall():
                        enqueue_review(db, kind, row["id"], row["revision"])

    def category(self, key):
        with self.connect() as db:
            row = db.execute("SELECT * FROM boards WHERE id=? AND enabled=1", (key,)).fetchone()
        if not row:
            raise ForumError(422, "invalid_type", "该版块暂不可发布，请重新选择。")
        return dict(row)

    @contextmanager
    def connect(self, write=False):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=5000")
        db.execute("PRAGMA synchronous=FULL")
        try:
            if write:
                db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def actor(self, db, subject, required=True):
        actor = db.execute("SELECT * FROM profiles WHERE subject=?", (subject,)).fetchone() if subject else None
        if required and not actor:
            raise ForumError(409, "profile_required", "请先建立社区档案。")
        if actor:
            actor = dict(actor)
            if subject in self.admin_subjects:
                actor["role"] = "admin"
        return actor

    def sync_minecraft_profile(self, subject, nickname):
        with self.connect(True) as db:
            actor = self.actor(db, subject, required=False)
            if actor:
                if actor["nickname"] != nickname:
                    db.execute("UPDATE profiles SET nickname=? WHERE id=?", (nickname, actor["id"]))
            else:
                db.execute("INSERT INTO profiles(id,subject,nickname,role,created_at) VALUES(?,?,?,?,?)", (ident("pr_"), subject, nickname, "admin" if subject in self.admin_subjects else "member", int(time.time()*1000)))

    @staticmethod
    def public_profile(actor):
        return {k: actor[k] for k in ("id", "nickname", "role", "muted", "created_at")}

    @staticmethod
    def require_staff(actor):
        if actor["role"] not in ("admin", "moderator"):
            raise ForumError(403, "forbidden", "此操作需要版主权限。")

    @staticmethod
    def can_write(actor):
        if actor["muted"]:
            raise ForumError(403, "muted", "当前社区档案已被禁言。")

    def rate(self, db, actor, action, maximum, seconds=60):
        now = int(time.time())
        bucket = now // seconds
        db.execute("INSERT INTO rate_limits VALUES(?,?,?,1) ON CONFLICT(actor_id,action,bucket) DO UPDATE SET count=count+1", (actor["id"], action, bucket))
        count = db.execute("SELECT count FROM rate_limits WHERE actor_id=? AND action=? AND bucket=?", (actor["id"], action, bucket)).fetchone()[0]
        if count > maximum:
            raise ForumError(429, "rate_limited", "操作较频繁，请稍后重试。", seconds - now % seconds)
        db.execute("DELETE FROM rate_limits WHERE bucket < ? AND action=?", (bucket - 2, action))

    def post(self, db, post_id, actor=None, public=False):
        row = db.execute("SELECT * FROM posts WHERE id=?", (post_id,)).fetchone()
        if not row:
            raise ForumError(404, "not_found", "找不到这篇帖子。")
        if row["status"] != "published":
            allowed = actor and (row["author_id"] == actor["id"] or actor["role"] in ("admin", "moderator"))
            if public or not allowed:
                raise ForumError(404, "not_found", "内容暂不可见，可能正在审核。")
        return row

    def serialize_post(self, db, row, actor=None, full=False):
        p = dict(row)
        author = db.execute("SELECT id,nickname,role FROM profiles WHERE id=?", (p["author_id"],)).fetchone()
        p["author"] = dict(author)
        p["mine"] = bool(actor and actor["id"] == p["author_id"])
        p["likes"] = db.execute("SELECT COUNT(*) FROM likes WHERE post_id=?", (p["id"],)).fetchone()[0]
        p["comments"] = db.execute("SELECT COUNT(*) FROM comments WHERE post_id=? AND status='published'", (p["id"],)).fetchone()[0]
        p["liked"] = bool(actor and db.execute("SELECT 1 FROM likes WHERE post_id=? AND profile_id=?", (p["id"], actor["id"])).fetchone())
        p["bookmarked"] = bool(actor and db.execute("SELECT 1 FROM bookmarks WHERE post_id=? AND profile_id=?", (p["id"], actor["id"])).fetchone())
        answer = db.execute("SELECT a.comment_id FROM accepted_answers a JOIN comments c ON c.id=a.comment_id WHERE a.post_id=? AND c.status='published'", (p["id"],)).fetchone()
        p["accepted_comment_id"] = answer[0] if answer else None
        p["summary"] = re.sub(r"\s+", " ", re.sub(r"[#*`\[\]]", "", p["body"]))[:150]
        if not full:
            del p["body"]
        return p

    def queue_post(self, db, row, actor):
        post = self.serialize_post(db, row, actor)
        return {key: post[key] for key in ("id", "title", "author", "author_id", "status", "locked", "revision", "created_at", "type")}

    def notify(self, db, recipient, actor, kind, post_id, comment_id=None):
        if recipient != actor["id"]:
            db.execute("INSERT INTO notifications VALUES(?,?,?,?,?,?,?,NULL)", (ident("nt_"), recipient, actor["id"], kind, post_id, comment_id, int(time.time() * 1000),))

    @staticmethod
    def cursor(value):
        if not value:
            return None
        try:
            if len(value) > 240:
                raise ValueError()
            result = json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))
            if not isinstance(result, list) or len(result) != 2 or not isinstance(result[0], int) or not isinstance(result[1], str):
                raise ValueError()
            return result
        except Exception:
            raise ForumError(422, "invalid_cursor", "分页信息无效，请刷新列表。") from None

    @staticmethod
    def encode_cursor(row, column):
        return base64.urlsafe_b64encode(json.dumps([row[column], row["id"]]).encode()).decode().rstrip("=")

    def list_posts(self, db, actor, params):
        where, args = [], []
        mine = params.get("mine") == "1"
        saved = params.get("saved") == "1"
        if mine or saved:
            if not actor:
                raise ForumError(401, "authentication_required", "请先建立社区档案。")
        if mine:
            where.append("p.author_id=?")
            args.append(actor["id"])
        else:
            where.append("p.status='published'")
        if saved:
            where.append("EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id=p.id AND b.profile_id=?)")
            args.append(actor["id"])
        category = params.get("type", "")
        if category:
            if not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", category) or not db.execute("SELECT 1 FROM boards WHERE id=?", (category,)).fetchone():
                raise ForumError(422, "invalid_type", "帖子类型无效。")
            where.append("p.type=?")
            args.append(category)
        q = params.get("q", "").strip()
        if len(q) > 80:
            raise ForumError(422, "invalid_query", "搜索词过长。")
        if q:
            where.append("p.title LIKE ? ESCAPE '\\'")
            args.append("%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        for field in ("version", "loader"):
            value = params.get(field, "")
            if len(value) > 40:
                raise ForumError(422, "invalid_filter", "筛选条件无效。")
            if value:
                where.append(f"(p.{field}=? OR p.{field} IN ('','不限'))")
                args.append(value)
        column = "activity_at" if params.get("sort") == "reply" else "created_at"
        cursor = self.cursor(params.get("cursor"))
        if cursor:
            where.append(f"(p.{column}<? OR (p.{column}=? AND p.id<?))")
            args.extend([cursor[0], cursor[0], cursor[1]])
        try:
            limit = min(20, max(1, int(params.get("limit", 20))))
        except (ValueError, TypeError):
            raise ForumError(422, "invalid_limit", "分页数量无效。") from None
        rows = db.execute(f"SELECT p.* FROM posts p WHERE {' AND '.join(where)} ORDER BY p.{column} DESC,p.id DESC LIMIT ?", (*args, limit + 1)).fetchall()
        return {"data": [self.serialize_post(db, row, actor) for row in rows[:limit]], "next_cursor": self.encode_cursor(rows[limit-1], column) if len(rows) > limit else None, "category_counts": {row["type"]: row["count"] for row in db.execute("SELECT type,COUNT(*) AS count FROM posts WHERE status='published' GROUP BY type").fetchall()}}

    def post_input(self, data):
        category = text(data, "type", 1, 32)
        board = self.category(category)
        resource = bool(board["resource"])
        result = {"type": category, "title": text(data, "title", 1, 80), "body": text(data, "body", 10), "version": text(data, "version", 1 if resource or category == "help" else 0, 40), "loader": text(data, "loader", 1, 40), "source_url": text(data, "source_url", 0, 2048), "original_author": text(data, "original_author", 1 if resource else 0, 80)}
        if result["loader"] not in ("不限", "原版", "Fabric", "Forge", "NeoForge", "Quilt"):
            raise ForumError(422, "invalid_loader", "请选择有效的加载器。")
        if not resource:
            # Switching editor type must not publish metadata from now-hidden pack fields.
            result["source_url"], result["original_author"] = "", ""
        if result["source_url"] or category in RESOURCE_CATEGORIES:
            try:
                url = urlsplit(result["source_url"])
                if url.scheme != "https" or not url.hostname or url.username or url.password:
                    raise ValueError()
            except ValueError:
                raise ForumError(422, "invalid_source_url", "请填写不包含凭据的 HTTPS 来源链接。") from None
        return result

    def handle(self, method, path, params=None, data=None, subject=None, idempotency=None, installation_admin=False, automatic_decision=False):
        params, data = params or {}, data or {}
        write = method not in ("GET", "HEAD")
        now = int(time.time() * 1000)
        with self.connect(write) as db:
            actor = self.actor(db, subject, required=False)
            if actor and installation_admin:
                actor["role"] = "admin"
            if method == "GET" and path == "/categories":
                from features import list_boards
                return {"data": list_boards(db)}, 200
            if method == "GET" and path == "/me":
                return {"data": self.public_profile(actor) if actor else None}, 200
            if method == "PUT" and path == "/me":
                if not subject:
                    raise ForumError(401, "authentication_required", "请恢复启动器账号会话后重试。")
                nickname = text(data, "nickname", 2, 24)
                if re.search(r"[\x00-\x1f\x7f<>]", nickname) or (re.search(r"官方|管理员|moderator|admin", nickname, re.I) and subject not in self.admin_subjects):
                    raise ForumError(422, "invalid_nickname", "请使用普通昵称，避免管理身份名称。")
                if actor:
                    self.can_write(actor)
                    self.rate(db, actor, "profile-hour", 5, 3600)
                    db.execute("UPDATE profiles SET nickname=? WHERE id=?", (nickname, actor["id"]))
                else:
                    db.execute("INSERT INTO profiles(id,subject,nickname,role,created_at) VALUES(?,?,?,?,?)", (ident("pr_"), subject, nickname, "admin" if subject in self.admin_subjects else "member", now))
                return {"data": self.public_profile(self.actor(db, subject))}, 200
            if method == "GET" and path == "/posts":
                return self.list_posts(db, actor, params), 200
            detail = re.fullmatch(r"/posts/(ps_[a-f0-9]{32})", path)
            if method == "GET" and detail:
                return {"data": self.serialize_post(db, self.post(db, detail[1], actor), actor, True)}, 200
            comments = re.fullmatch(r"/posts/(ps_[a-f0-9]{32})/comments", path)
            if method == "GET" and comments:
                self.post(db, comments[1], actor)
                cursor = self.cursor(params.get("cursor"))
                args = [comments[1]]
                condition = ""
                if cursor:
                    condition = " AND (c.created_at>? OR (c.created_at=? AND c.id>?))"
                    args += [cursor[0], cursor[0], cursor[1]]
                rows = db.execute("SELECT c.*,p.nickname AS author_name,p.role AS author_role FROM comments c JOIN profiles p ON p.id=c.author_id WHERE c.post_id=?" + condition + " ORDER BY c.created_at,c.id LIMIT 21", args).fetchall()
                output = []
                for row in rows[:20]:
                    item = dict(row)
                    item["mine"] = bool(actor and actor["id"] == item["author_id"])
                    if item["status"] != "published" and not (actor and (actor["role"] in ("admin", "moderator") or actor["id"] == item["author_id"])):
                        item["body"] = "此回复已被隐藏。"
                    output.append(item)
                return {"data": output, "next_cursor": self.encode_cursor(rows[19], "created_at") if len(rows) > 20 else None}, 200
            if not subject:
                raise ForumError(401, "authentication_required", "此操作需要社区身份。")
            if not actor:
                raise ForumError(409, "profile_required", "请先建立社区档案。")
            if method == "GET" and path == "/notifications":
                from features import inbox
                messages = inbox(db, actor, cursor=self.cursor(params.get("messages_cursor")))
                cursor = self.cursor(params.get("cursor"))
                condition, args = "", [actor["id"]]
                if cursor:
                    condition = " AND (n.created_at<? OR (n.created_at=? AND n.id<?))"
                    args.extend([cursor[0], cursor[0], cursor[1]])
                rows = db.execute("SELECT n.*,a.nickname AS actor_name,CASE WHEN p.status='published' THEN p.title ELSE '内容暂不可见' END AS title FROM notifications n JOIN profiles a ON a.id=n.actor_id JOIN posts p ON p.id=n.post_id WHERE n.recipient_id=?" + condition + " ORDER BY n.created_at DESC,n.id DESC LIMIT 41", args).fetchall()
                count = db.execute("SELECT COUNT(*) FROM notifications WHERE recipient_id=? AND read_at IS NULL", (actor["id"],)).fetchone()[0]
                return {"data": [dict(row) for row in rows[:40]], "system_messages": messages["data"], "system_messages_cursor": messages["next_cursor"], "unread": count + messages["unread"], "read_before": now, "next_cursor": self.encode_cursor(rows[39], "created_at") if len(rows) > 40 else None}, 200
            if method == "GET" and path == "/moderation/reports":
                self.require_staff(actor)
                rows = db.execute("SELECT r.*,a.nickname AS reporter_name FROM reports r JOIN profiles a ON a.id=r.reporter_id WHERE r.status='open' ORDER BY r.created_at LIMIT 10").fetchall()
                pending = db.execute("SELECT * FROM posts WHERE status='pending' ORDER BY created_at LIMIT 10").fetchall()
                result = []
                for row in rows:
                    report = dict(row)
                    table = "posts" if row["target_type"] == "post" else "comments"
                    target = db.execute(f"SELECT * FROM {table} WHERE id=?", (row["target_id"],)).fetchone()
                    report["target"] = {k: target[k] for k in ("id", "author_id", "revision", "status")} if target else None
                    if target:
                        report["target"].update(body=target["body"][:800], post_id=target["id"] if table == "posts" else target["post_id"])
                    result.append(report)
                managed = db.execute("SELECT * FROM posts WHERE status='hidden' OR locked=1 ORDER BY updated_at DESC LIMIT 10").fetchall()
                hidden_comments = db.execute("SELECT * FROM comments WHERE status='hidden' ORDER BY created_at DESC LIMIT 10").fetchall()
                return {"data": result, "pending": [self.queue_post(db, row, actor) for row in pending], "managed": [self.queue_post(db, row, actor) for row in managed], "hidden_comments": [dict(row) for row in hidden_comments], "muted": [self.public_profile(dict(row)) for row in db.execute("SELECT * FROM profiles WHERE muted=1 LIMIT 10").fetchall()]}, 200
            if not write:
                raise ForumError(404, "not_found", "接口不存在。")
            self.can_write(actor)
            route_key = method + path
            needs_key = method == "POST" and (path == "/posts" or bool(comments))
            body_hash = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            if needs_key:
                if not idempotency or not re.fullmatch(r"[a-zA-Z0-9_-]{16,100}", idempotency):
                    raise ForumError(422, "idempotency_required", "提交缺少防重复标识，请重新打开编辑器。")
                old = db.execute("SELECT * FROM idempotency WHERE actor_id=? AND route=? AND key=?", (actor["id"], route_key, idempotency)).fetchone()
                if old:
                    if old["body_hash"] != body_hash:
                        raise ForumError(409, "idempotency_conflict", "这次提交的内容已改变，请重新提交。")
                    return json.loads(old["response"]), old["status"]
            response, status = None, 200
            if method == "POST" and path == "/posts":
                self.rate(db, actor, "post-minute", 3)
                self.rate(db, actor, "post-hour", 12, 3600)
                values = self.post_input(data)
                if self.category(values["type"])["staff_only"]:
                    self.require_staff(actor)
                reviewed = db.execute("SELECT 1 FROM posts WHERE author_id=? AND status='published' LIMIT 1", (actor["id"],)).fetchone()
                state = "pending" if self.automatic_review or (self.review_new and actor["role"] == "member" and not reviewed) else "published"
                post_id = ident("ps_")
                db.execute("INSERT INTO posts(id,author_id,type,title,body,version,loader,source_url,original_author,status,created_at,updated_at,activity_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", (post_id, actor["id"], *values.values(), state, now, now, now))
                if self.automatic_review:
                    from features import enqueue_review
                    enqueue_review(db, "post", post_id, 1)
                response, status = {"data": self.serialize_post(db, self.post(db, post_id, actor), actor, True)}, 202 if state == "pending" else 201
            elif method == "PATCH" and detail:
                post = self.post(db, detail[1], actor)
                if post["author_id"] != actor["id"] or post["status"] == "hidden" or post["locked"]:
                    raise ForumError(403, "forbidden", "不能编辑此帖子。")
                if type(data.get("revision")) is not int or data["revision"] != post["revision"]:
                    raise ForumError(409, "revision_conflict", "帖子已更新，请保留本地修改并重新加载比较。")
                self.rate(db, actor, "edit-minute", 10)
                values = self.post_input(data)
                if self.category(values["type"])["staff_only"]:
                    self.require_staff(actor)
                # Editing any published post returns ordinary members to review, preventing approval bypass.
                state = "pending" if self.automatic_review or (self.review_new and actor["role"] == "member") else post["status"]
                db.execute("UPDATE posts SET type=?,title=?,body=?,version=?,loader=?,source_url=?,original_author=?,status=?,updated_at=?,revision=revision+1 WHERE id=?", (*values.values(), state, now, post["id"]))
                if self.automatic_review:
                    from features import enqueue_review
                    enqueue_review(db, "post", post["id"], post["revision"] + 1)
                if values["type"] != "help":
                    db.execute("DELETE FROM accepted_answers WHERE post_id=?", (post["id"],))
                response = {"data": self.serialize_post(db, self.post(db, post["id"], actor), actor, True)}
            elif method == "POST" and comments:
                post = self.post(db, comments[1], actor, public=True)
                if post["locked"]:
                    raise ForumError(403, "post_locked", "这篇帖子已锁定，暂时不能回复。")
                self.rate(db, actor, "comment-minute", 10)
                self.rate(db, actor, "comment-hour", 60, 3600)
                body = text(data, "body", 1, 2000)
                parent_id = data.get("parent_id")
                parent = None
                if parent_id:
                    if not isinstance(parent_id, str):
                        raise ForumError(422, "invalid_parent", "回复目标无效。")
                    parent = db.execute("SELECT * FROM comments WHERE id=? AND post_id=? AND status='published'", (parent_id, post["id"])).fetchone()
                    if not parent:
                        raise ForumError(422, "invalid_parent", "回复目标无效。")
                    parent_id = parent["parent_id"] or parent["id"]
                comment_id = ident("cm_")
                db.execute("INSERT INTO comments(id,post_id,author_id,parent_id,body,status,created_at) VALUES(?,?,?,?,?,?,?)", (comment_id, post["id"], actor["id"], parent_id, body, "pending" if self.automatic_review else "published", now))
                db.execute("UPDATE posts SET activity_at=? WHERE id=?", (now, post["id"]))
                if self.automatic_review:
                    from features import enqueue_review
                    enqueue_review(db, "comment", comment_id, 1)
                else:
                    for recipient in {post["author_id"], parent["author_id"] if parent else post["author_id"]}:
                        self.notify(db, recipient, actor, "reply", post["id"], comment_id)
                response, status = {"data": {"id": comment_id}}, 202 if self.automatic_review else 201
            elif re.fullmatch(r"/posts/ps_[a-f0-9]{32}/(like|bookmark)", path) and method in ("PUT", "DELETE"):
                _, _, post_id, kind = path.split("/")
                self.post(db, post_id, actor, public=True)
                self.rate(db, actor, "interaction-minute", 60)
                table = "likes" if kind == "like" else "bookmarks"
                if method == "PUT":
                    columns = (actor["id"], post_id) if table == "likes" else (actor["id"], post_id, now)
                    db.execute(f"INSERT OR IGNORE INTO {table} VALUES({','.join('?' for _ in columns)})", columns)
                else:
                    db.execute(f"DELETE FROM {table} WHERE profile_id=? AND post_id=?", (actor["id"], post_id))
                response = {"data": self.serialize_post(db, self.post(db, post_id, actor), actor, True)}
            elif method == "PATCH" and re.fullmatch(r"/comments/cm_[a-f0-9]{32}", path):
                target = db.execute("SELECT * FROM comments WHERE id=?", (path.split("/")[2],)).fetchone()
                if not target or target["author_id"] != actor["id"] or target["status"] != "published":
                    raise ForumError(403, "forbidden", "只能编辑自己的可见回复。")
                parent_post = self.post(db, target["post_id"], actor, public=True)
                if parent_post["locked"]:
                    raise ForumError(403, "post_locked", "帖子已锁定，暂时不能编辑回复。")
                if type(data.get("revision")) is not int or data["revision"] != target["revision"]:
                    raise ForumError(409, "revision_conflict", "回复已更新，请保留本地修改并重新加载。")
                self.rate(db, actor, "edit-minute", 10)
                body = text(data, "body", 1, 2000)
                if body != target["body"]:
                    db.execute("UPDATE comments SET body=?,status=?,revision=revision+1 WHERE id=?", (body, "pending" if self.automatic_review else "published", target["id"]))
                    if self.automatic_review:
                        from features import enqueue_review
                        enqueue_review(db, "comment", target["id"], target["revision"] + 1)
                    db.execute("DELETE FROM accepted_answers WHERE comment_id=?", (target["id"],))
                    self.notify(db, parent_post["author_id"], actor, "edited", parent_post["id"], target["id"])
                response = {"data": {"id": target["id"]}}
            elif re.fullmatch(r"/posts/ps_[a-f0-9]{32}/accepted-answer", path) and method in ("PUT", "DELETE"):
                post = self.post(db, path.split("/")[2], actor, public=True)
                if post["author_id"] != actor["id"] or post["type"] != "help":
                    raise ForumError(403, "forbidden", "只有求助作者可以采纳回复。")
                self.rate(db, actor, "accept-minute", 10)
                if method == "DELETE":
                    db.execute("DELETE FROM accepted_answers WHERE post_id=?", (post["id"],))
                else:
                    target = db.execute("SELECT * FROM comments WHERE id=? AND post_id=? AND status='published'", (text(data, "comment_id", 1, 60), post["id"])).fetchone()
                    if not target or target["author_id"] == actor["id"]:
                        raise ForumError(422, "invalid_answer", "请选择其他玩家在此帖中的有效回复。")
                    old = db.execute("SELECT comment_id FROM accepted_answers WHERE post_id=?", (post["id"],)).fetchone()
                    db.execute("INSERT INTO accepted_answers VALUES(?,?) ON CONFLICT(post_id) DO UPDATE SET comment_id=excluded.comment_id", (post["id"], target["id"]))
                    if not old or old[0] != target["id"]:
                        self.notify(db, target["author_id"], actor, "accepted", post["id"], target["id"])
                response = {"data": self.serialize_post(db, self.post(db, post["id"], actor), actor, True)}
            elif method == "PUT" and path == "/notifications/read":
                before = data.get("before")
                if type(before) is not int or before < 0 or before > now:
                    raise ForumError(422, "invalid_before", "通知时间范围无效。")
                db.execute("UPDATE notifications SET read_at=? WHERE recipient_id=? AND created_at<=? AND read_at IS NULL", (now, actor["id"], before))
                from features import inbox
                inbox(db, actor, before)
                response = {"data": {"read": True}}
            elif method == "POST" and path == "/reports":
                self.rate(db, actor, "report-minute", 5)
                target_type = text(data, "target_type", 1, 12)
                target_id = text(data, "target_id", 1, 60)
                reason = text(data, "reason", 2, 500)
                if target_type == "post":
                    self.post(db, target_id, actor, public=True)
                elif target_type == "comment":
                    target = db.execute("SELECT * FROM comments WHERE id=? AND status='published'", (target_id,)).fetchone()
                    if not target:
                        raise ForumError(404, "not_found", "回复不存在。")
                    self.post(db, target["post_id"], actor, public=True)
                else:
                    raise ForumError(422, "invalid_target", "举报目标无效。")
                db.execute("INSERT OR IGNORE INTO reports VALUES(?,?,?,?,?,'open',?)", (ident("rp_"), actor["id"], target_type, target_id, reason, now))
                if self.automatic_review:
                    from features import enqueue_review
                    table = "posts" if target_type == "post" else "comments"
                    target = db.execute(f"SELECT revision FROM {table} WHERE id=?", (target_id,)).fetchone()
                    enqueue_review(db, target_type, target_id, target["revision"], force=True)
                response = {"data": {"submitted": True}}
            elif method == "POST" and path == "/moderation/actions":
                self.require_staff(actor)
                self.rate(db, actor, "moderation-minute", 60)
                action = text(data, "action", 1, 20)
                if self.automatic_review and action in ("approve", "restore") and not automatic_decision:
                    raise ForumError(403, "automatic_review_required", "内容由系统和 AI 自动审核，不能人工放行。")
                target_id = text(data, "target_id", 1, 60)
                target_type = text(data, "target_type", 1, 12)
                reason = text(data, "reason", 2, 500)
                if action == "dismiss" and target_type == "report":
                    changed = db.execute("UPDATE reports SET status='dismissed' WHERE id=? AND status='open'", (target_id,)).rowcount
                    if not changed:
                        raise ForumError(409, "already_handled", "举报已处理或不存在。")
                elif action in ("mute", "unmute") and target_type == "profile":
                    if actor["role"] != "admin" or target_id == actor["id"]:
                        raise ForumError(403, "forbidden", "只有管理员可以管理其他用户的发言权限。")
                    target = db.execute("SELECT * FROM profiles WHERE id=?", (target_id,)).fetchone()
                    if not target or target["role"] != "member" or target["subject"] in self.admin_subjects:
                        raise ForumError(403, "forbidden", "不能修改此档案的权限。")
                    db.execute("UPDATE profiles SET muted=? WHERE id=?", (int(action == "mute"), target_id))
                elif target_type in ("post", "comment"):
                    table = "posts" if target_type == "post" else "comments"
                    target = db.execute(f"SELECT * FROM {table} WHERE id=?", (target_id,)).fetchone()
                    if not target:
                        raise ForumError(404, "not_found", "内容不存在。")
                    if type(data.get("revision")) is not int or data["revision"] != target["revision"]:
                        raise ForumError(409, "revision_conflict", "内容已改变，请刷新后再处理。")
                    if action in ("approve", "hide", "restore"):
                        state = "hidden" if action == "hide" else "published"
                        db.execute(f"UPDATE {table} SET status=?,revision=revision+1 WHERE id=?", (state, target_id))
                        post_id = target_id if target_type == "post" else target["post_id"]
                        self.notify(db, target["author_id"], actor, "hidden" if state == "hidden" else "approved", post_id, target_id if target_type == "comment" else None)
                        db.execute("UPDATE reports SET status='resolved' WHERE target_type=? AND target_id=? AND status='open'", (target_type, target_id))
                    elif action in ("lock", "unlock") and target_type == "post":
                        db.execute("UPDATE posts SET locked=?,revision=revision+1 WHERE id=?", (int(action == "lock"), target_id))
                    else:
                        raise ForumError(422, "invalid_action", "管理操作无效。")
                else:
                    raise ForumError(422, "invalid_action", "管理操作无效。")
                db.execute("INSERT INTO moderation_log VALUES(?,?,?,?,?,?,?)", (ident("au_"), actor["id"], action, target_type, target_id, reason, now))
                response = {"data": {"handled": True}}
            else:
                raise ForumError(404, "not_found", "接口不存在。")
            if needs_key:
                db.execute("INSERT INTO idempotency VALUES(?,?,?,?,?,?,?)", (actor["id"], route_key, idempotency, body_hash, json.dumps(response, ensure_ascii=False), status, now + 7 * 86400000))
                db.execute("DELETE FROM idempotency WHERE expires_at<?", (now,))
            return response, status
