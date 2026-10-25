# 第三方来源与许可

当前版本完整复用 Voxelum/x-minecraft-launcher 的前端与运行时源码，基线提交 `b64e90f69bda9c4c049af27c63c488489784c72c`（0.72.0）。TORA 包含品牌、界面、社区、独立账号服务和发行配置等修改。TORA 新增与修改的自有代码按 AGPL-3.0-only 发布；这不改变上游及依赖各自的原许可证。它不是 XMCL 官方发行版，不代表获得原作者背书。

来源：https://github.com/Voxelum/x-minecraft-launcher

该上游使用 MIT 许可证，原始 LICENSE 原样保存在 `xmcl/LICENSE`。下方完整保留原许可：

```text
MIT License

Copyright (c) 2023 ci010 (cijhn@hotmail.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```

## 其他项目

VersePc2、HMCL、PCL、PCL-CE 作为功能与体验参考，未将其 GPL 或自定义许可代码拷入本版本。Minecraft、Microsoft、Fabric、Forge、NeoForge、Modrinth 等名称、图标及资源归其各自权利人所有。TORA 自有标识位于 `xmcl/xmcl-keystone-ui/src/assets/tora.svg`。

## 依赖

默认游戏背景复用上游已附带的 Minecraft 官方版本宣传图。未匹配到版本时使用 Minecraft 26.3 官方资源索引 34 中的 `minecraft/textures/gui/title/background/panorama_3.png`，SHA-1 为 `4e260704b88f2cd57fbc05abcd1a4264df733f91`，来源为 Mojang 资源 CDN。相关图像权利归 Mojang / Microsoft 所有，不属于 TORA 原创素材。

本版本的第三方依赖以 `xmcl/pnpm-lock.yaml` 为准，并保留各包随附的许可证。Electron/Chromium、Vue、Vuetify、UnoCSS、Roboto/Material 字体及上游核心库不因产品更名而变成 TORA 原创内容。构建发行包应同时保留对应许可文件。

旧独立实现的依赖版本和许可清单已完整保存在项目旁的“风格借鉴旧版-20261023”备份中，不再作为当前版本的依赖说明。

## 后端协议库

自有服务复用了 [Voxelum/xmcl-web-api](https://github.com/Voxelum/xmcl-web-api) 的账号、会话、DPoP、OAuth 和联机协议模块，固定提交 `4552e248230a14215d93dc7e5433b792794be530`。上游 README 声明 MIT；其原始 README 许可声明保留在 server/README.md。TORA 部署入口、持久化适配和 DeepSeek 访问控制位于 server/tora/，改动说明见 server/README-TORA.md。

## Terracotta / 陶瓦联机

TMCL uses the unmodified Terracotta 0.4.2 binaries through their loopback HTTP IPC interface. Terracotta is created by Burning_TNT and contributors and builds on EasyTier. Source and official releases: https://github.com/burningtnt/Terracotta/tree/v0.4.2 . License: AGPL-3.0-or-later with the upstream IPC/binary-distribution exception, reproduced in `server/third-party/terracotta/UPSTREAM-README.md`; the full license is in `server/third-party/terracotta/LICENSE`. The launcher visibly attributes Terracotta and EasyTier on the multiplayer page. Release archive and executable SHA-256 digests are pinned in `artifacts.json`. The VersePc2 integration was consulted as an architectural reference; TMCL's TypeScript controller and Vue page are independently implemented.

The EasyTier executable extracted without modification from the official Terracotta bundle is licensed under LGPL-3.0 (full text: `server/third-party/terracotta/LICENSE-EasyTier`). Upstream fork/source: https://github.com/burningtnt/EasyTier , bundled version `2.5.0-terracotta.2`, reported commit `66c82d0a`. It runs as a separate process; TMCL does not link its library.
