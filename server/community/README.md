# TORA 社区服务 · 0.2.0

2026-10-24：真实论坛首版已部署。公网入口为 `https://community-api.cogniticteam.com`；客户端入口为启动器左侧“社区”。不是将设计原型作为网站发布。

## 当前能力

- 交流、求助、教程、整合包来源分享；标题搜索、版本 / 加载器筛选、分页。
- 社区档案、发帖和编辑、两层回复、回复编辑、点赞、收藏、求助采纳。
- 回复 / 采纳 / 审核通知与已读状态、举报、审核队列、隐藏恢复、锁定解锁、管理员禁言与解禁。
- 新用户首帖与普通用户的帖子修改需审核；作者可查看自己的待审核内容。
- 受限 Markdown 不执行 HTML，不加载帖子远程图片；外链确认后打开，内部应用地址禁止由论坛跳转。
- 草稿按启动器身份、帖子与新建 / 编辑分别保存在本机。提交失败保留输入；新建和回复有幂等键。
- 不托管整合包、图片、视频，不包含私信或聊天常连。当前头像使用昵称首字占位。

## 部署与认证

- 服务器：154.8.230.216，OpenCloudOS 9.6 / Python 3.11，4GB 规格；SQLite WAL。
- Caddy：2.11.7，公开 HTTPS；业务只监听 `127.0.0.1:8765`。
- Worker：`tora-launcher-community`，精确限制社区路径与 HTTP 方法，不代理 AI、游戏登录、下载或其他服务。
- 现有 TORA 账号服务新增 `POST /v1/account/community-ticket`。需有效会话、DPoP 证明及未撤销的会话记录；返回有效期 5 分钟、独立 ES256 密钥签名、`aud=tora-community` 的社区票据。
- 社区源站只保存签名公钥，不接收微软令牌、密码或通用启动器会话。角色和资源归属由服务端数据库判定，不信任昵称或客户端 role 字段。
- 私钥仅配置在账号 Worker Secret `TORA_COMMUNITY_SIGNING_JWK`，不包含在仓库和安装包内。回源令牌仍分别保存在 Worker Secret 与服务器 root / 0600 的 `gateway.env`。
- 管理员以最终发行版中核对的 TORA 账号标识为准。开发版与发行版具有独立安装身份；开发验收档案保留为普通成员，不按相同昵称自动合并。身份核对来自真实认证界面及私有验收记录，不依据昵称或可能陈旧的本机安装标识文件授予权限。
- 已签发的票据最长存活 5 分钟；社区禁言在每次写入时生效。不能把 5 分钟票据描述为可即时全局撤销的通用会话。

源站域名 `community-origin.cogniticteam.com` 的 A 记录仍为灰云 DNS，指向此服务器。部署时发现该域名从外部的 TLS 握手被重置，服务器内访问正常。因此实际回源使用 [Workers TCP/TLS](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) 直连固定 IP 的 443，并验证服务器已有的公开 CA IP 证书；不是明文回源，也没有关闭证书校验。实现见 `../tora/communityOriginTransport.ts`，有界 HTTP 响应解析见 `communityOriginHttp.ts`。Caddy 自动续期 IP 证书。以后变更公网 IP 时，必须同步修改传输层固定 IP、Caddy IP 站点 / 证书与 DNS，重新实测 TLS；不能只改 A 记录。

## 文件与资源上限

```text
/opt/tora-community/
  app.py                  FastAPI 适配层
  forum.py                权限、事务、数据模型与业务逻辑
  backup.py               SQLite 一致性备份
  requirements.lock       本次运行环境的固定依赖版本
  venv/                   独立 Python 环境
  bin/caddy
/etc/tora-community/
  Caddyfile
  gateway.env             root 0600，回源令牌
  forum.env               root 0600，写开关与管理员配置
  ticket-public.jwk       签名公钥
/var/lib/tora-community/community.sqlite3
/var/backups/tora-community/{daily,weekly}/
```

- `tora-community.service`：独立低权限账号；CPU 上限 1 核，内存高水位 512 MiB / 硬上限 1 GiB；并发 64，单进程；异常后重启、开机启动。
- `tora-community-web.service`：独立 HTTPS 账号，既有内存上限 160 MiB，证书在 `/var/lib/tora-community-web`。
- 请求体上限 96 KiB，回源响应上限 256 KiB。列表每页≤20，评论每页20，通知每页40，管理队列每类最多10条；处理后刷新下一批。
- 网关读请求 120 次 / IP / 分钟，写请求 30 次 / IP / 分钟，另有服务端账号级限流。429 返回 Retry-After。
- 宝塔、SSH 和其他启动器服务保持原有用途；未更改机器防火墙或关闭 TLS 验证。

## 维护与备份

SSH ED25519 指纹：`SHA256:kGdUv44zgltnIH67b8Ub/1IxGHI6AqdyUd8zajSQ6xo`。密码不写入仓库和脚本。

```sh
systemctl status tora-community tora-community-web
journalctl -u tora-community -u tora-community-web --since '10 minutes ago'
systemctl restart tora-community
systemctl list-timers tora-community-backup.timer
systemctl start tora-community-backup.service
```

日备份定时器已启用：新加坡时间每日 03:15，随机延迟≤15分钟，错过后补跑。保留最近7份日备份与4份周备份。使用 SQLite backup API，目标切换为 DELETE 日志模式并关闭连接后再原子更名，备份不依赖旧临时文件名下的 WAL。每份备份检查 integrity_check。

这是服务器本地备份；没有配置 R2 / S3 或持续异机备份。恢复时先关闭写入、停止业务服务，额外备份当前数据库及 WAL，再使用选定的一致性备份；校验完整性与记录数量后恢复启动。不要仅复制运行中的主 DB 文件覆盖数据，也不要为回滚代码删除数据库。

快速维护开关：将 `/etc/tora-community/forum.env` 中 `COMMUNITY_WRITES_ENABLED=0` 后重启业务服务；浏览可继续，写操作明确返回维护状态。管理员 subject 与签名公钥不从 HTTP 界面修改。更换签名密钥需双公钥过渡或维护窗口，避免同时使所有未过期票据失效。

更改应用代码、服务文件或 Caddy 配置前，备份到服务器 root 专用目录。此次上线前备份为 `/root/tora-community-backups/20261024-094823/`；客户端和本地源码备份为项目 `备份/社区正式上线前-20261024-094756/`。本次临时帖子清理前的一致性快照另存于 root 备份目录；日常恢复请选清理后的日备份。

## 验证

Python 需要 3.10+，服务器使用3.11。生产安装使用 `requirements.lock`；本地测试额外安装 `httpx==0.28.1`。

```sh
python -m unittest discover -s server/community -p 'test_*.py'
cd server
npm run test:tora
npm run typecheck:tora
```

完整结果见项目 `docs/社区上线验收-20261024.md` 和 `docs/社区负载验收-20261024.json`。

- 20项 Python、24项 Worker / 认证 / TLS 解析、12项前端接口与内容安全测试通过。
- 真实 Electron 中验证档案、草稿恢复、提交待审核、刷新持久化、作者编辑与版主隐藏；测试内容始终未公开，随后精确清理，保留真实社区档案。
- 独立测试库跑通回复、采纳、点赞、收藏、举报、审核、隐藏恢复、锁帖和通知，不把模拟用户写入正式库。
- 10分钟、20个读工作线程与5个写工作线程：12,000次读 / 600次写均200；读 p95 16.89ms、写 p95 44.85ms。测试为独立测试库的本机 HTTP，2篇帖子 / 1条回复，明确不包含公网 TLS 延迟，也不代表任意规模的在线人数。
- 测试数据库服务峰值约46.7 MiB，未重启，Swap使用0。服务重启和备份恢复已测；没有特意重启整台机器以免打断既有面板。
