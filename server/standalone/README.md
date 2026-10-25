# TORA 独立服务器

Node.js 24 + SQLite（WAL、FULL synchronous）运行账号、DPoP 会话、联机房间、社区网关与公共配置。论坛正文保存在原有 Python 社区数据库中。Agent 已移除，AI 路由返回 410。

## 构建与测试

在 `server` 目录执行 `npm ci`，然后 `npm run test:standalone`。生成的 `standalone/dist/platform.mjs` 可在安装 Node.js 24 的 Linux 上直接运行，无需复制 node_modules。根目录的 `npm run setup`、`npm run build` 和 `npm run package:mac` 构建桌面端；前端使用系统字体。

## 运行

参考 `tora-platform.service`。账号签名密钥、社区 ES256 私钥和兼容代理密钥放入 root 私有 JSON，由 systemd LoadCredential 提供给非特权进程。不要把密钥放进源码或客户端。数据库在 `/var/lib/tora-platform/platform.sqlite3`。Node 只监听回环 8770，Caddy 负责经过公开 CA 验证的 HTTPS IP 入口。社区 Python 只监听回环 8765。

需设置 `TORA_SESSION_SECRET`、`TORA_MULTIPLAYER_TICKET_SECRET`、`TORA_COMMUNITY_SIGNING_JWK`、`TORA_INTERNAL_PROXY_TOKEN`、`COMMUNITY_GATEWAY_TOKEN`。可选 OAuth 服务使用既有 `TORA_*_CLIENT_ID/SECRET`；微软公共应用 ID 不属于密钥。社区票据的逻辑 issuer 保留旧账号域名以保持验证兼容，不代表服务仍运行在该域名所在的 Worker。

旧域名 Worker 仅保留受随机密钥保护的 HTTPS 兼容转发。新客户端直连服务器。旧版 WebSocket 入口返回 426 提示更新；新版直接连接 `wss://154.8.230.216`。微软、Mojang、Modrinth 和游戏文件提供方仍由各自官方服务提供。STUN 使用同机 coturn（UDP 3478），只做地址发现，不开放匿名 TURN 中继。

## 备份与恢复

`backup.py` 通过 SQLite backup API 产生独立、完整性验证通过的快照，保留 7 份日备份和 4 份周备份。配套 systemd timer 每天执行。论坛沿用自己的独立备份。恢复前先停止 Node，备份当前数据库及密钥，恢复完整快照，删除旧 WAL/SHM 后检查权限与 `PRAGMA integrity_check`，再启动。账号签名密钥必须与数据库配套恢复。

初次 CF 迁移时冻结旧写入、导出最终快照后使用 `import.mjs`；导入只能执行一次。迁移出口及临时密钥已从在线 Worker 撤除。禁止重新启用旧账号主库同时接受写入。

## 许可证与源码

TORA 自有修改采用 AGPL-3.0-only；上游和第三方许可保留，见根 LICENSE、NOTICE、THIRD_PARTY_NOTICES.md 和 xmcl/LICENSE。`/source` 提供对应版本源码包；由 `scripts/package-source.py` 从允许的工程目录生成，不包括凭据、数据库、用户文件、日志和备份。
