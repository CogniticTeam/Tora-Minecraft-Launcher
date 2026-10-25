"""Bounded HTTP adapter. Caddy terminates TLS; the origin only accepts its gateway."""
import base64
import hmac
import json
import os
import re
import sqlite3
import time
import uuid
import urllib.request
import urllib.error
from urllib.parse import unquote
from pathlib import Path
from contextlib import asynccontextmanager

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from forum import Forum, ForumError
from admin_console import CommunityAdmin

STARTED = time.monotonic()


def unbase64(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def verify_ticket(token, public_jwk, now=None, claims_result=False):
    try:
        if not isinstance(token, str) or len(token) > 4096:
            raise ValueError()
        head, payload, signature = token.split(".")
        header, claims = json.loads(unbase64(head)), json.loads(unbase64(payload))
        now = int(time.time()) if now is None else now
        if header.get("alg") != "ES256" or header.get("typ") != "JWT" or header.get("kid") != "tora-community-v1":
            raise ValueError()
        if claims.get("aud") != "tora-community" or claims.get("iss") != "https://launcher-api.cogniticteam.com":
            raise ValueError()
        issued, expires = claims.get("iat"), claims.get("exp")
        if type(issued) is not int or type(expires) is not int or not issued <= now + 30 or not now < expires or not 0 < expires - issued <= 300:
            raise ValueError()
        if not isinstance(claims.get("sub"), str) or not 1 <= len(claims["sub"]) <= 200 or not isinstance(claims.get("jti"), str):
            raise ValueError()
        scopes = claims.get("scope")
        if not isinstance(scopes, list) or not all(s in scopes for s in ("community:read", "community:write")):
            raise ValueError()
        if public_jwk.get("kty") != "EC" or public_jwk.get("crv") != "P-256":
            raise ValueError()
        key = ec.EllipticCurvePublicNumbers(int.from_bytes(unbase64(public_jwk["x"]), "big"), int.from_bytes(unbase64(public_jwk["y"]), "big"), ec.SECP256R1()).public_key()
        raw = unbase64(signature)
        if len(raw) != 64:
            raise ValueError()
        key.verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")), f"{head}.{payload}".encode(), ec.ECDSA(hashes.SHA256()))
        minecraft = claims.get("minecraft")
        if minecraft is not None:
            if not isinstance(minecraft, dict) or not re.fullmatch(r"[a-f0-9]{32}", str(minecraft.get("id", ""))) or not re.fullmatch(r"[A-Za-z0-9_]{3,16}", str(minecraft.get("name", ""))) or claims["sub"] != "minecraft_" + minecraft["id"]:
                raise ValueError()
        return claims if claims_result else claims["sub"]
    except Exception:
        raise ForumError(401, "invalid_community_ticket", "社区会话已失效，请重试。") from None


def create_app(database, gateway_token, public_jwk, admins=(), writes=False, review_new=True, verify_token="", profile_fetcher=None, admin_token="", automatic_review=False, reviewer=None):
    if not gateway_token or len(gateway_token) < 32:
        raise RuntimeError("Community gateway token must be configured")
    store = Forum(database, admins, review_new, automatic_review)
    worker = None
    if automatic_review and reviewer:
        from moderation import ReviewWorker
        worker = ReviewWorker(store, reviewer)
    @asynccontextmanager
    async def lifespan(app):
        if worker:
            worker.start()
        try:
            yield
        finally:
            if worker:
                await run_in_threadpool(worker.stop)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.store = store
    app.state.review_worker = worker
    console = CommunityAdmin(store, reviewer)

    @app.middleware("http")
    async def boundary(request: Request, call_next):
        request_id = uuid.uuid4().hex
        try:
            if request.url.path.startswith("/internal/admin/") and len(admin_token) < 32:
                raise ForumError(404, "not_found", "接口不存在。")
            expected = "Bearer " + (verify_token if request.url.path == "/internal/minecraft/profile" else gateway_token)
            if request.url.path.startswith("/internal/admin/"):
                expected = "Bearer " + admin_token
            if request.url.path == "/internal/minecraft/profile" and not verify_token:
                raise ForumError(503, "verification_not_configured", "正版校验服务暂不可用。")
            if not hmac.compare_digest(request.headers.get("authorization", "").encode(), expected.encode()):
                raise ForumError(401, "unauthorized", "请求未通过社区网关验证。")
            response = await call_next(request)
        except ForumError as error:
            response = JSONResponse({"error": {"code": error.code, "message": error.message}, "request_id": request_id}, status_code=error.status)
            if error.retry:
                response.headers["Retry-After"] = str(error.retry)
        except sqlite3.OperationalError:
            response = JSONResponse({"error": {"code": "database_busy", "message": "社区暂时繁忙，请稍后重试。"}, "request_id": request_id}, status_code=503, headers={"Retry-After": "2"})
        except Exception as error:
            print(json.dumps({"event": "community_request_failed", "type": type(error).__name__, "request_id": request_id}), flush=True)
            response = JSONResponse({"error": {"code": "service_error", "message": "社区暂时无法完成请求。"}, "request_id": request_id}, status_code=500)
        response.headers.update({"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Request-ID": request_id})
        return response

    @app.post("/internal/minecraft/profile")
    async def minecraft_profile(request: Request):
        # This endpoint accepts a separate issuer-only secret. Never log or store game tokens.
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 12288:
                raise ForumError(413, "body_too_large", "校验请求过大。")
        try:
            token = json.loads(data).get("accessToken")
            if not isinstance(token, str) or not 20 <= len(token) <= 8192 or not re.fullmatch(r"[A-Za-z0-9._~-]+", token):
                raise ValueError()
        except (ValueError, AttributeError, UnicodeError):
            raise ForumError(401, "minecraft_login_required", "请重新登录微软正版账号。") from None
        def verify():
            try:
                if profile_fetcher:
                    profile = profile_fetcher(token)
                else:
                    req = urllib.request.Request("https://api.minecraftservices.com/minecraft/profile", headers={"Authorization": "Bearer " + token})
                    with urllib.request.urlopen(req, timeout=8) as response:
                        raw = response.read(65537)
                        if len(raw) > 65536:
                            raise ValueError()
                        profile = json.loads(raw)
                if not re.fullmatch(r"[a-f0-9]{32}", str(profile.get("id", "")), re.I) or not re.fullmatch(r"[A-Za-z0-9_]{3,16}", str(profile.get("name", ""))):
                    raise ValueError()
                return {"id": profile["id"].lower(), "name": profile["name"]}
            except urllib.error.HTTPError as error:
                if error.code in (401, 403, 404):
                    raise ForumError(401, "minecraft_login_required", "请重新登录微软正版账号。") from None
                raise ForumError(503, "minecraft_verification_unavailable", "正版校验服务暂时不可用。") from None
            except (OSError, ValueError, AttributeError):
                raise ForumError(503, "minecraft_verification_unavailable", "正版校验服务暂时不可用。") from None
        return await run_in_threadpool(verify)

    @app.api_route("/internal/admin/{path:path}", methods=["GET", "POST"])
    async def admin(request: Request, path: str):
        if len(request.url.query) > 2048:
            raise ForumError(422, "invalid_query", "查询条件过长。")
        data = {}
        if request.method == "POST":
            if not writes:
                raise ForumError(503, "community_read_only", "社区写入正在维护，请稍后重试。")
            if request.headers.get("content-type", "").split(";")[0] != "application/json":
                raise ForumError(415, "json_required", "请求需要 JSON 内容。")
            raw = bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw) > 98304:
                    raise ForumError(413, "body_too_large", "请求内容过大。")
            try:
                data = json.loads(raw or b"{}")
                if not isinstance(data, dict):
                    raise ValueError()
            except (ValueError, UnicodeError):
                raise ForumError(422, "invalid_json", "提交内容格式无效。") from None
        body, status = await run_in_threadpool(console.handle, request.method, "/" + path, dict(request.query_params), data, request.headers.get("x-admin-operator", ""), unquote(request.headers.get("x-admin-label", "TMCL")))
        return JSONResponse(body, status_code=status)

    @app.api_route("/health", methods=["GET", "HEAD"])
    async def health(request: Request):
        def check():
            with store.connect() as db:
                db.execute("SELECT 1").fetchone()
        await run_in_threadpool(check)
        body = {"service": "tora-community", "version": "0.2.0", "backend": "dedicated-server", "status": "ok", "uptime_seconds": int(time.monotonic() - STARTED)}
        return Response(status_code=200) if request.method == "HEAD" else body

    @app.get("/v1/community")
    async def capabilities():
        return {"service": "tora-community", "version": "0.3.0", "backend": "dedicated-server", "status": "ready" if writes else "coming_soon", "automatic_review": automatic_review, "features": {name: writes for name in ("posts", "comments", "likes", "bookmarks", "notifications", "moderation")}}

    @app.api_route("/v1/community/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
    async def community(request: Request, path: str):
        if len(request.url.query) > 2048:
            raise ForumError(422, "invalid_query", "查询条件过长。")
        write = request.method not in ("GET", "HEAD")
        if write and not writes:
            raise ForumError(503, "community_read_only", "社区写入正在维护，请稍后重试。")
        token = request.headers.get("x-community-authorization", "")
        subject, claims = None, {}
        if token:
            if not token.startswith("Bearer "):
                raise ForumError(401, "invalid_community_ticket", "社区会话无效。")
            claims = await run_in_threadpool(verify_ticket, token[7:], public_jwk, None, True)
            subject = claims["sub"]
        if not subject and (write or path in ("me", "notifications", "moderation/reports") or request.query_params.get("mine") or request.query_params.get("saved")):
            raise ForumError(401, "authentication_required", "请先恢复启动器会话。")
        minecraft = claims.get("minecraft")
        content_write = write and (path == "posts" or path.startswith("posts/") or path.startswith("comments/"))
        if content_write and not minecraft:
            raise ForumError(403, "minecraft_login_required", "请先登录拥有 Minecraft Java 版的微软正版账号，再参与发帖和回复。")
        if minecraft:
            await run_in_threadpool(store.sync_minecraft_profile, subject, minecraft["name"])
        data = {}
        if write:
            if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
                raise ForumError(415, "json_required", "请求需要 JSON 内容。")
            chunks, length = [], 0
            async for chunk in request.stream():
                length += len(chunk)
                if length > 98304:
                    raise ForumError(413, "body_too_large", "内容超过允许的大小。")
                chunks.append(chunk)
            try:
                data = json.loads(b"".join(chunks) or b"{}")
                if not isinstance(data, dict):
                    raise ValueError()
            except (ValueError, UnicodeError):
                raise ForumError(422, "invalid_json", "提交内容格式无效。") from None
        if minecraft and path == "me" and request.method == "PUT":
            data["nickname"] = minecraft["name"]
        body, status = await run_in_threadpool(store.handle, "GET" if request.method == "HEAD" else request.method, "/" + path, dict(request.query_params), data, subject, request.headers.get("idempotency-key"), bool(minecraft and claims.get("launcher_sub") in store.admin_subjects))
        return Response(status_code=status) if request.method == "HEAD" else JSONResponse(body, status_code=status)

    return app


def production():
    public = json.loads(Path(os.environ["COMMUNITY_PUBLIC_JWK_FILE"]).read_text())
    automatic = os.environ.get("COMMUNITY_AUTO_REVIEW") == "1"
    reviewer = None
    if automatic:
        from moderation import DeepSeekReview
        key = Path(os.environ["COMMUNITY_REVIEW_KEY_FILE"]).read_text().strip() if os.environ.get("COMMUNITY_REVIEW_KEY_FILE") else ""
        reviewer = DeepSeekReview(key, os.environ.get("COMMUNITY_REVIEW_MODEL", "deepseek-flash"))
    return create_app(os.environ.get("COMMUNITY_DATABASE", "/var/lib/tora-community/community.sqlite3"), os.environ["COMMUNITY_GATEWAY_TOKEN"], public,
                      os.environ.get("COMMUNITY_ADMIN_SUBJECTS", "").split(","), os.environ.get("COMMUNITY_WRITES_ENABLED") == "1", verify_token=os.environ.get("COMMUNITY_MINECRAFT_VERIFY_TOKEN", ""), admin_token=os.environ.get("COMMUNITY_ADMIN_TOKEN", ""), automatic_review=automatic, reviewer=reviewer)
