# TORA 启动器自有服务

2026-10-24 已从 Cloudflare 计算/存储迁移到用户中国服务器。当前入口为 `https://154.8.230.216`，通过公开 CA 签发的 IP 证书提供 HTTPS；账号、DPoP、配置、联机信令与社区网关运行于 Node.js 24 / SQLite，论坛正文仍在原 Python / SQLite 服务。自建 coturn 仅开放 STUN（UDP 3478），未开放匿名 TURN。

旧 Cloudflare Worker 现在只提供兼容 HTTPS 转发，旧 WebSocket 入口返回 426 提示升级。旧账号 Durable Object 保留冻结快照，不再作为可写主库。迁移导出了 14 个账号、15 个会话，签名私钥和设备绑定保持不变；临时导出端点与迁移密钥已撤除。Node 的账号库与原论坛库均有独立自动备份。

Agent 功能已移除，旧 AI Worker 返回 410；没有继续调用模型提供商。云备份、R2 / S3 上传下载、云主机套餐、充值、订阅、安装包托管和付费 TURN 均未重新启用。微软 / Mojang / Xbox、Modrinth、CurseForge 及游戏文件源仍使用官方服务。

## 开发与运维

```sh
npm ci
npm run typecheck:tora
npm run test:tora
npm run test:standalone
```

部署方式、私有配置、systemd 单元和备份恢复说明见 [standalone/README.md](standalone/README.md)。不要把密钥、账号快照、数据库或用户访问令牌写入源码、客户端、日志和聊天。旧域名兼容转发使用独立随机代理密钥；设备会话与社区签名材料只由独立服务器使用。

社区的发帖与回复需要经过服务端验证的 Minecraft Java 版微软正版账号。设备身份不等于正版游戏账号；游戏访问令牌不会暴露给渲染进程。

## 来源与许可

协议库基于 [Voxelum/xmcl-web-api](https://github.com/Voxelum/xmcl-web-api)，提交 `4552e248230a14215d93dc7e5433b792794be530`。上游 README 声明 MIT，其许可与来源保留在 server/README.md。TORA 自有部署、持久化适配与界面修改采用 AGPL-3.0-only，见根 LICENSE / NOTICE / THIRD_PARTY_NOTICES.md。此服务不是 XMCL 官方发行。
