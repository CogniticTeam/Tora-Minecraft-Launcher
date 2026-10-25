# TORA Minecraft Launcher

基于 XMCL 开源前端与运行时的跨平台 Minecraft 桌面启动器。当前使用系统字体、黑白明暗主题与统一同心圆角，保留实例管理、正版登录、模组资源安装、P2P 联机和社区论坛。Agent 已移除。

## 功能

- Minecraft 实例、版本与模组资源管理，微软设备码登录。
- Forge 与 OptiFine 兼容组合选择，以及互斥加载器检查。
- 联机、正版账号社区、管理端与版本发布服务。
- 本地快照、启动诊断、模组更新预览和更新文件校验。
- 工具箱与自定义文件下载，复用启动器的分段并发下载引擎。

## 开发与构建

当前主要在 macOS Apple Silicon 的开发环境中验证。Windows / Linux 保留源码支持，尚未完成对应平台实机验收。仓库提供源码，安装包应在构建后单独发布。

Node.js 22.16+、pnpm：

```sh
npm run setup
npm run dev
npm run build
npm run package:mac
```

开发窗口使用 `http://localhost:3000`；正式应用使用 Electron 内置页面。`npm start` 在现有构建为开发版时会自动启动所需的界面服务。不要同时运行共享游戏数据目录的两份应用。

## 配置与凭据

本仓库不提供生产 API Key、服务器密码、数据库、用户令牌或发布签名私钥。请在本机或部署服务器上单独配置，勿将真实凭据写入源码或提交到 Git。

提交前可运行 `python3 scripts/check-public-source.py` 检查 Git 暂存区。另可使用 Gitleaks 执行 `gitleaks dir . --redact`；`.gitleaksignore` 只记录已核对的测试数据、公开标识和格式化代码误报。

微软应用 Client ID 和用于验证更新签名的公钥属于公开配置，可以随源码分发。CurseForge 需要另外申请第三方 API 权限；未配置有效密钥时相关入口保持禁用并显示说明。

## 在线服务

- 自有 API、设备会话、社区与 WebSocket 信令：`https://154.8.230.216`，运行于用户中国服务器。
- 自有 STUN：`154.8.230.216:3478`（UDP），只做地址发现；没有匿名 TURN 中继。
- 账号和会话使用 SQLite 持久化，DPoP 防重放与社区 ES256 签名保持兼容；论坛正文沿用原 Python 数据库。两个数据库分别自动备份。
- 旧 `launcher-api`、`launcher-signal`、`community-api.cogniticteam.com` 域名保留兼容转发；新客户端直连服务器。旧版 WebSocket 入口提示更新。
- Agent 与旧 AI 网关已停用。Minecraft Together、新闻轮播、云备份、对象存储及付费套餐入口不再提供。
- 微软设备码、Xbox Live / XSTS、Minecraft 正版校验以及 Modrinth / CurseForge 等第三方内容继续使用其官方服务；没有搬运它们的服务和游戏文件。

部署、备份和恢复见 [独立服务说明](server/standalone/README.md)。

## 关于与赞助

贡献者：绪山同学（头像使用提供的 Producer's avatar.jpg）。赞助仅保留 [爱发电](https://afdian.com/a/zhenxun111)。服务器提供商展示为 Cloudflare 与腾讯云。

## 许可证与源码

TORA 新增和修改的自有代码采用 **AGPL-3.0-only**，见 [LICENSE](LICENSE)。完整源码位于 [CogniticTeam/Tora-Minecraft-Launcher](https://github.com/CogniticTeam/Tora-Minecraft-Launcher)，也可通过应用“设置 → 关于 → 获取完整源码”访问。

上游 [Voxelum/x-minecraft-launcher](https://github.com/Voxelum/x-minecraft-launcher) 基线提交 `b64e90f69bda9c4c049af27c63c488489784c72c`；原始 MIT 许可保留在 xmcl/LICENSE，并随应用分发。服务协议库来源、第三方许可与修改范围见 THIRD_PARTY_NOTICES.md 和 NOTICE。VersePc2、HMCL、PCL、PCL-CE 为体验研究参考，未复制其 GPL / 自定义许可实现。

TORA 不是 Minecraft 官方产品，未经 Mojang 或 Microsoft 批准，也与其无关联。

## 管理端与陶瓦联机

管理端包含用户、服务状态、版本发布、社区管理与公告功能。生产管理凭据须在服务器私密配置中提供。启动器左侧提供“联机”入口，原生直连不可用时支持 TMCL 中国服务器中继。部署方法见 [独立服务说明](server/standalone/README.md)。
