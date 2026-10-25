"""Private management adapter. Only the local platform's separate admin credential enters here."""
import re
import time
import json
import hashlib
from forum import ForumError, text


class CommunityAdmin:
    def __init__(self, store, reviewer=None):
        self.store = store
        self.reviewer = reviewer

    def check_content(self, data):
        if not self.store.automatic_review or not self.reviewer:
            raise ForumError(503, "review_unavailable", "自动审核服务尚未就绪，内容未发布。")
        try:
            result = self.reviewer.review({"title": data.get("title", ""), "body": data.get("body", ""), "source_url": data.get("url", "")})
        except Exception:
            raise ForumError(503, "review_unavailable", "自动审核暂时不可用，内容未发布，请稍后重试。") from None
        if result["decision"] != "allow":
            raise ForumError(422, "content_rejected", "内容未通过自动审核：" + result["reason"])
        return {"data": {"decision": "allow", "engine": result["engine"]}}, 200

    @staticmethod
    def page(params):
        try:
            offset = int(params.get("offset", 0))
            if not 0 <= offset <= 1000000:
                raise ValueError()
            return offset
        except (TypeError, ValueError):
            raise ForumError(422, "invalid_page", "分页信息无效。") from None

    @staticmethod
    def search(params):
        query = params.get("q", "").strip()
        if len(query) > 80:
            raise ForumError(422, "invalid_query", "搜索词最多 80 个字符。")
        return "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"

    def operator(self, name, label):
        if not isinstance(name, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,40}", name):
            raise ForumError(403, "forbidden", "管理身份无效。")
        subject = "admin-console:" + name
        label = text({"label": label}, "label", 1, 24)
        with self.store.connect(True) as db:
            actor = self.store.actor(db, subject, False)
            if not actor:
                from forum import ident
                db.execute("INSERT INTO profiles(id,subject,nickname,role,created_at) VALUES(?,?,?,?,?)", (ident("pr_"), subject, label, "admin", int(time.time() * 1000)))
            else:
                db.execute("UPDATE profiles SET nickname=? WHERE subject=?", (label, subject))
        return subject

    def handle(self, method, path, params=None, data=None, operator="owner", label="TMCL 管理员"):
        params, data = params or {}, data or {}
        if path == "/check-content" and method == "POST":
            return self.check_content(data)
        if path == "/announcements" and method == "POST":
            subject = self.operator(operator, label)
            key = text(data, "request_id", 16, 100)
            return self.store.handle("POST", "/posts", data={"type": "notice", "title": data.get("title"), "body": data.get("body"), "loader": "不限", "version": ""}, subject=subject, idempotency=key, installation_admin=True)
        if method == "POST" and path in ("/boards", "/messages"):
            subject = self.operator(operator, label)
            if path == "/messages" and self.store.automatic_review:
                # Review outside the SQLite write transaction. Replays of a successful
                # send return its receipt even during a provider outage.
                with self.store.connect() as read:
                    actor = self.store.actor(read, subject)
                    old = read.execute("SELECT * FROM idempotency WHERE actor_id=? AND route='ADMIN/messages' AND key=?", (actor["id"], str(data.get("request_id", "")))).fetchone()
                    if old:
                        digest = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
                        if old["body_hash"] != digest:
                            raise ForumError(409, "idempotency_conflict", "同一提交标识的内容已改变。")
                        return json.loads(old["response"]), old["status"]
                self.check_content(data)
            with self.store.connect(True) as db:
                actor = self.store.actor(db, subject)
                if path == "/boards":
                    from features import save_board
                    item = save_board(db, data)
                    from forum import ident
                    db.execute("INSERT INTO moderation_log VALUES(?,?,?,?,?,?,?)", (ident("au_"), actor["id"], "board_update", "board", item["id"], "更新版块配置", int(time.time() * 1000)))
                    return {"data": item}, 200
                from features import send_message
                key = text(data, "request_id", 16, 100)
                if not re.fullmatch(r"[a-zA-Z0-9_-]{16,100}", key):
                    raise ForumError(422, "invalid_request_id", "提交标识无效。")
                digest = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
                old = db.execute("SELECT * FROM idempotency WHERE actor_id=? AND route='ADMIN/messages' AND key=?", (actor["id"], key)).fetchone()
                if old:
                    if old["body_hash"] != digest:
                        raise ForumError(409, "idempotency_conflict", "同一提交标识的内容已改变。")
                    return json.loads(old["response"]), old["status"]
                item = {"data": send_message(db, data, actor["id"])}
                self.store.rate(db, actor, "system-message-hour", 20, 3600)
                now = int(time.time() * 1000)
                db.execute("INSERT INTO idempotency VALUES(?,?,?,?,?,?,?)", (actor["id"], "ADMIN/messages", key, digest, json.dumps(item, ensure_ascii=False), 201, now + 7 * 86400000))
                return item, 201
        if method == "POST" and path == "/actions":
            subject = self.operator(operator, label)
            if data.get("action") == "review":
                if not self.store.automatic_review or data.get("target_type") not in ("post", "comment"):
                    raise ForumError(422, "invalid_action", "该内容不能重新审核。")
                table = "posts" if data["target_type"] == "post" else "comments"
                with self.store.connect(True) as db:
                    target = db.execute(f"SELECT * FROM {table} WHERE id=?", (data.get("target_id"),)).fetchone()
                    if not target or target["revision"] != data.get("revision"):
                        raise ForumError(409, "revision_conflict", "内容已改变，请刷新后重试。")
                    from features import enqueue_review
                    enqueue_review(db, data["target_type"], target["id"], target["revision"], True)
                return {"data": {"queued": True}}, 202
            # The forum's existing revision, ownership, rate and protected-admin checks remain authoritative.
            return self.store.handle("POST", "/moderation/actions", data=data, subject=subject, installation_admin=True)
        if method != "GET":
            raise ForumError(405, "method_not_allowed", "不支持此管理操作。")
        offset = self.page(params)
        with self.store.connect() as db:
            if path == "/overview":
                scalar = lambda sql, args=(): db.execute(sql, args).fetchone()[0]
                now = int(time.time() * 1000)
                counts = {"posts": scalar("SELECT COUNT(*) FROM posts"), "published": scalar("SELECT COUNT(*) FROM posts WHERE status='published'"), "pending": scalar("SELECT COUNT(*) FROM posts WHERE status='pending'"), "hidden": scalar("SELECT COUNT(*) FROM posts WHERE status='hidden'"), "reports": scalar("SELECT COUNT(*) FROM reports WHERE status='open'"), "members": scalar("SELECT COUNT(*) FROM profiles WHERE subject NOT LIKE 'admin-console:%'"), "muted": scalar("SELECT COUNT(*) FROM profiles WHERE muted=1"), "comments": scalar("SELECT COUNT(*) FROM comments"), "posts_today": scalar("SELECT COUNT(*) FROM posts WHERE created_at>=?", (now - 86400000,)), "handled_today": scalar("SELECT COUNT(*) FROM moderation_log WHERE created_at>=?", (now - 86400000,))}
                activity = [dict(r) for r in db.execute("SELECT strftime('%Y-%m-%d',created_at/1000,'unixepoch','+8 hours') AS day, COUNT(*) AS count FROM posts WHERE created_at>=? GROUP BY day ORDER BY day", (now - 7 * 86400000,)).fetchall()]
                return {"data": {"counts": counts, "activity": activity, "checked_at": now}}, 200
            if path == "/boards":
                from features import list_boards
                return {"data": list_boards(db)}, 200
            if path == "/messages":
                rows = db.execute("SELECT m.*,p.nickname AS actor_name,r.nickname AS recipient_name FROM system_messages m JOIN profiles p ON p.id=m.actor_id LEFT JOIN profiles r ON r.id=m.recipient_id ORDER BY m.created_at DESC,m.id DESC LIMIT 20 OFFSET ?", (offset,)).fetchall()
                return {"data": [dict(r) for r in rows], "total": db.execute("SELECT COUNT(*) FROM system_messages").fetchone()[0], "offset": offset}, 200
            if path == "/reviews":
                rows = db.execute("SELECT r.* FROM review_results r ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET ?", (offset,)).fetchall()
                queue = db.execute("SELECT j.*,CASE WHEN target_type='post' THEN (SELECT title FROM posts WHERE id=j.target_id) ELSE '回复' END AS title,CASE WHEN target_type='post' THEN target_id ELSE (SELECT post_id FROM comments WHERE id=j.target_id) END AS post_id FROM review_jobs j WHERE status IN ('pending','processing','retry') ORDER BY created_at,id LIMIT 20").fetchall()
                counts = {r["status"]: r["count"] for r in db.execute("SELECT status,COUNT(*) AS count FROM review_jobs GROUP BY status")}
                return {"data": [dict(r) for r in rows], "queue": [dict(r) for r in queue], "total": db.execute("SELECT COUNT(*) FROM review_results").fetchone()[0], "counts": counts, "automatic": self.store.automatic_review, "offset": offset}, 200
            if path == "/posts":
                where, args = ["1=1"], []
                state = params.get("status", "")
                if state:
                    if state not in ("published", "pending", "hidden"):
                        raise ForumError(422, "invalid_status", "内容状态无效。")
                    where.append("p.status=?"); args.append(state)
                if params.get("type"):
                    where.append("p.type=?"); args.append(params["type"])
                if params.get("q"):
                    where.append("p.title LIKE ? ESCAPE '\\'"); args.append(self.search(params))
                condition = " AND ".join(where)
                total = db.execute(f"SELECT COUNT(*) FROM posts p WHERE {condition}", args).fetchone()[0]
                rows = db.execute(f"SELECT p.* FROM posts p WHERE {condition} ORDER BY p.created_at DESC,p.id DESC LIMIT 20 OFFSET ?", (*args, offset)).fetchall()
                return {"data": [self.store.serialize_post(db, row) for row in rows], "total": total, "offset": offset}, 200
            detail = re.fullmatch(r"/posts/(ps_[a-f0-9]{32})", path)
            if detail:
                row = db.execute("SELECT * FROM posts WHERE id=?", (detail[1],)).fetchone()
                if not row:
                    raise ForumError(404, "not_found", "帖子不存在。")
                comments = db.execute("SELECT c.*,p.nickname AS author_name FROM comments c JOIN profiles p ON p.id=c.author_id WHERE c.post_id=? ORDER BY c.created_at,c.id LIMIT 20 OFFSET ?", (row["id"], offset)).fetchall()
                total = db.execute("SELECT COUNT(*) FROM comments WHERE post_id=?", (row["id"],)).fetchone()[0]
                return {"data": self.store.serialize_post(db, row, full=True), "comments": [dict(c) for c in comments], "comments_total": total, "offset": offset}, 200
            if path == "/users":
                where, args = ["1=1"], []
                if params.get("q"):
                    where.append("(p.nickname LIKE ? ESCAPE '\\' OR p.subject LIKE ? ESCAPE '\\')"); args.extend([self.search(params)] * 2)
                if params.get("muted") == "1":
                    where.append("p.muted=1")
                condition = " AND ".join(where)
                total = db.execute(f"SELECT COUNT(*) FROM profiles p WHERE {condition}", args).fetchone()[0]
                rows = db.execute(f"SELECT p.*,(SELECT COUNT(*) FROM posts WHERE author_id=p.id) AS posts,(SELECT COUNT(*) FROM comments WHERE author_id=p.id) AS comments FROM profiles p WHERE {condition} ORDER BY p.created_at DESC,p.id DESC LIMIT 20 OFFSET ?", (*args, offset)).fetchall()
                users = []
                for r in rows:
                    user = {k: r[k] for k in ("id", "nickname", "role", "muted", "created_at", "posts", "comments")}
                    user["minecraft_uuid"] = r["subject"][10:] if r["subject"].startswith("minecraft_") else None
                    user["console"] = r["subject"].startswith("admin-console:")
                    user["protected"] = r["role"] != "member" or r["subject"] in self.store.admin_subjects
                    users.append(user)
                return {"data": users, "total": total, "offset": offset}, 200
            if path == "/reports":
                state = params.get("status", "open")
                if state not in ("open", "resolved", "dismissed"):
                    raise ForumError(422, "invalid_status", "举报状态无效。")
                rows = db.execute("SELECT r.*,p.nickname AS reporter_name FROM reports r JOIN profiles p ON p.id=r.reporter_id WHERE r.status=? ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET ?", (state, offset)).fetchall()
                reports = []
                for row in rows:
                    item = dict(row)
                    table = "posts" if row["target_type"] == "post" else "comments"
                    target = db.execute(f"SELECT * FROM {table} WHERE id=?", (row["target_id"],)).fetchone()
                    item["target"] = {k: target[k] for k in ("id", "author_id", "revision", "status")} if target else None
                    if target:
                        item["target"].update(body=target["body"][:2000], post_id=target["id"] if table == "posts" else target["post_id"])
                    reports.append(item)
                return {"data": reports, "total": db.execute("SELECT COUNT(*) FROM reports WHERE status=?", (state,)).fetchone()[0], "offset": offset}, 200
            if path == "/audit":
                rows = db.execute("SELECT m.*,p.nickname AS actor_name FROM moderation_log m LEFT JOIN profiles p ON p.id=m.actor_id ORDER BY m.created_at DESC,m.id DESC LIMIT 20 OFFSET ?", (offset,)).fetchall()
                return {"data": [dict(r) for r in rows], "total": db.execute("SELECT COUNT(*) FROM moderation_log").fetchone()[0], "offset": offset}, 200
        raise ForumError(404, "not_found", "管理接口不存在。")
