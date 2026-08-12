# Wuu Music

> 一个基于 Electron 构建的简洁现代化本地音乐播放器，集成多平台歌单导入、在线解析、损坏歌曲修复、桌面歌词与歌单分享等能力。

<p align="center">
  <img src="https://img.shields.io/badge/Electron-2B2E4A?style=for-the-badge&logo=electron&logoColor=9FEAF9" alt="Electron" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" />
</p>

---

## 📖 项目简介

**Wuu Music**（以下简称"Wuu"）是一款为音乐爱好者打造的本地音乐管理与播放工具。我们相信音乐属于个人，也相信技术可以让音乐体验更自由。

Wuu 以"**本地音乐管理 + 多源扩展**"为核心设计理念，旨在解决当下音乐生态的几个痛点：

- **版权分裂**：多平台订阅费用高、独占内容分散，个人音乐库难以统一管理
- **格式受限**：下载的加密音频（如汽水 Soda 格式）无法在其他播放器中播放
- **离线需求**：网络不稳定或特殊环境下仍想播放音乐
- **分享不便**：想与朋友分享歌单却受限于平台壁垒

### ✨ 我们的目标

构建一个**以本地音乐库为核心、多平台扩展为补充**的音乐生态工具，让用户真正拥有自己的音乐收藏，并能便捷地导入、播放、分享。

---

## 🎯 核心特性

| 类别 | 功能 |
|------|------|
| **音乐管理** | 本地音乐库扫描与播放，支持 AAC / MP3 / WAV / FLAC / M4A 等格式 |
| **多平台歌单** | 网易云音乐、酷狗音乐、汽水音乐官方账号登录与歌单导入 |
| **在线解析** | 汽水、网易云、QQ、酷我、咪咕、Bilibili、5sing、千千、Jamendo、JOOX、Apple Music 等平台分享链接解析下载 |
| **音频解密** | Soda 音频解密（AES-CTR + MP4 box 原语），解锁加密音频 |
| **歌词系统** | 逐字歌词解析、桌面歌词窗口（支持锁定穿透、拖拽、位置持久化） |
| **视觉体验** | 封面主色调自动提取，播放器自适应配色 |
| **损坏修复** | 自动检测解密失败、音频缺失、歌词精度不足等问题并提供修复 |
| **免费听音乐** | 集成 `music-dl` 本地 Web 服务，提供搜索、试听、下载、歌词、换源 |
| **歌单分享** | 基于 `wuu://` 协议的加密歌单分享，支持本地 HTTP 服务器分发 |

### 🖥️ 桌面歌词特性

- 显示/隐藏切换，独立于主窗口
- 锁定/解锁模式（锁定后鼠标穿透）
- 拖拽改变位置，自动持久化
- 颜色自适应封面主色调

### 🔒 歌单分享特性

- 本地 HTTP 服务器（默认端口 30967）
- IP 白名单（支持通配符）
- 频率限制（每 IP 每分钟最大请求数）
- AES-256-GCM 加密地址与端口
- 密钥与链接分离传输

---

## 🏗️ 技术架构

### 技术栈

- **运行时**：Electron + Node.js
- **渲染层**：HTML/CSS/JavaScript（**计划逐步迁移至 Vue 3**）
- **构建工具**：electron-builder
- **音频解密**：自研 Soda 解密模块（AES-CTR + MP4 box 原语）

### 主进程模块装配

入口 `main.js` 仅负责协议注册、菜单移除、模块装配与应用生命周期，所有业务逻辑拆分至各功能目录。

```
main.js
  ├── core/         基础层：日志 / 共享状态 / 配置存储 / 网络工具
  ├── audio/        音频层：扫描 / 时长解析 / 文件校验
  ├── soda/         音频解密：AES-CTR + MP4 box 原语
  ├── cover/        封面色彩提取
  ├── window/       窗口管理：主窗口 + 桌面歌词窗口
  ├── download/     在线解析下载
  ├── repair/       损坏歌曲扫描与修复
  ├── free-music/   免费听音乐专区（music-dl.exe 服务管理）
  ├── kugou/        酷狗音乐歌单导入
  ├── qishui/       汽水音乐服务
  ├── netease/      网易云音乐歌单导入（内嵌 NeteaseCloudMusicApi）
  ├── server/       本地 HTTP 服务器（歌单分享）
  ├── playlist/     歌单导出导入（wuu:// 协议）
  └── parsers/      多平台解析器注册中心
```

### 自定义协议

#### `music://` 协议

通过 Node.js `fs` 读取文件流，绕过 Chromium `file:///` 的 MAX_PATH 260 限制，支持 Range 请求以实现音频缓冲与跳转。MIME 类型根据扩展名自动映射。

#### `wuu://` 协议

歌单分享专用的自定义协议，v1 版本格式：

```
wuu://<base64url(JSON{v, f, b, j, jc, r, dt, d, p})>
```

| 字段 | 含义 |
|------|------|
| v | 协议版本 |
| f | 分支型号（produce/exploitation/test） |
| b | 版本数据 |
| j | 兼容性类型 |
| jc | 兼容版本列表 |
| r | 保留数据 |
| dt | 地址类型（dIP / ddomain） |
| d | 加密地址数据（AES-256-GCM + XOR 偏移） |
| p | 加密端口（格式头 + 字母混淆，无数字） |

密钥与链接分开发送，远程拉取时通过 `http://<host>:<port>/playlist/<id>?k=<accessKey>` 获取歌单数据。

### IPC 通信

渲染层通过 `preload.js` 暴露以下 API 命名空间：

| 命名空间 | 职责 |
|----------|------|
| `musicAPI` | 本地歌曲、歌词、用户数据、封面色彩 |
| `windowAPI` | 窗口最小化、最大化、关闭、退出 |
| `desktopLyric` | 桌面歌词显示、锁定、位置 |
| `parseAPI` | 分享链接解析与下载 |
| `repairAPI` | 损坏歌曲扫描与修复 |
| `freeMusicAPI` | 免费听音乐专区（搜索、试听、下载） |
| `kugouAPI` | 酷狗音乐登录与歌单导入 |
| `qishuiAPI` | 汽水音乐登录与歌单导入 |
| `neteaseAPI` | 网易云音乐登录与歌单导入 |
| `playlistAPI` | 歌单分享、服务器管理、密钥导出导入 |

---

## 📁 目录结构

```
SQET/
├── main.js                    主进程入口
├── preload.js                 上下文桥接（IPC API 暴露）
├── package.json               项目元数据与构建配置
├── music-dl.exe               免费听音乐专区 Web 服务
├── core/                      基础层
│   ├── logger.js              日志（过滤 GIN 噪音）
│   ├── state.js               共享状态
│   ├── storage.js             配置目录持久化
│   └── network.js             网络工具
├── audio/                     音频层
│   ├── scanner.js             扫描
│   ├── duration.js            时长解析
│   └── verify.js              文件校验
├── soda/                      Soda 音频解密
│   └── decrypt.js             AES-CTR + MP4 box 原语
├── cover/
│   └── color.js               封面色彩提取
├── window/                    窗口管理
│   ├── main-window.js         主窗口
│   └── desktop-lyric.js       桌面歌词窗口
├── download/
│   └── index.js               在线解析下载
├── repair/
│   └── index.js               损坏歌曲扫描与修复
├── free-music/                免费听音乐专区
│   ├── service.js             music-dl.exe 服务管理
│   └── ipc.js                 IPC 处理
├── kugou/                     酷狗音乐
│   ├── config.js              多账号配置
│   ├── auth.js                登录刷新
│   └── ipc.js                 IPC 处理
├── qishui/                    汽水音乐
│   ├── utils.js               工具函数
│   ├── config.js              配置
│   └── ipc.js                 IPC 处理
├── netease/                   网易云音乐
│   ├── config.js              配置
│   └── ipc.js                 IPC 处理
├── server/
│   ├── index.js               本地 HTTP 服务器
│   └── scanner-worker.js      文件扫描 Worker 线程
├── playlist/
│   └── share.js               wuu:// 协议与分享管理
├── parsers/                   多平台解析器
│   ├── base.js                基类
│   ├── index.js               注册中心
│   ├── algorithms/            算法（歌词格式、来源识别）
│   ├── auth/                  鉴权（Cookie 管理）
│   ├── platforms/             各平台解析实现
│   └── qishui-decrypt/        汽水音乐解密
├── renderer/                  渲染层
│   ├── index.html             主界面
│   └── modules/               前端模块
├── mobile_UI/                 移动端 UI（Vue 3 + Vite）
│   ├── src/
│   ├── package.json
│   └── vite.config.js
├── scripts/
│   └── dev.js                 开发模式启动脚本（Electron + Vite）
└── tools/
    └── netease-api/           内嵌 NeteaseCloudMusicApi
```

---

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 18
- **操作系统**：Windows（当前版本主要面向 Windows）

### 安装依赖

```bash
npm install
```

安装完成后会自动执行 `scripts/patch-kugoumusicapi.js` 对酷狗音乐 API 依赖进行补丁处理。

### 开发运行

```bash
# 桌面端
npm start

# 开发模式（桌面端 + 移动端热更新）
npm run dev:all
```

开发模式下，移动端 UI 会在 `http://localhost:5174/` 启动 Vite dev server，支持热更新。

### 构建打包

```bash
npm run build
```

构建配置使用 `electron-builder`，目标为 Windows NSIS 安装包，输出目录为 `dist/`。

---

## 📊 项目状态

### 当前状态

| 模块 | 状态 | 说明 |
|------|------|------|
| 本地音乐管理 | ✅ 稳定 | 核心功能已完成，支持多格式扫描与播放 |
| 桌面端 UI | ✅ 稳定 | HTML/CSS/JavaScript 实现，**计划逐步重构为 Vue 3** |
| 音频解密 | ✅ 稳定 | Soda 格式解密已实现 |
| 多平台歌单 | ✅ 稳定 | 网易云/酷狗/汽水三平台支持 |
| 在线解析 | ⚠️ 维护中 | 依赖第三方平台接口，需持续跟进更新 |
| 歌词系统 | ✅ 稳定 | 逐字歌词解析，支持 SSR 回退 |
| 移动端 UI | 🔧 开发中 | Vue 3 + Vite 实现，**仅为网页应用移植，未发布原生 APP** |
| 性能优化 | 🔨 待优化 | 部分模块仍有优化空间 |

### 未来计划

- [ ] **前端框架迁移**：将 HTML 原生渲染层逐步重构为 Vue 3，提升可维护性与组件复用性
- [ ] **性能优化**：
  - 大规模歌单渲染优化（虚拟滚动、分页加载）
  - 歌曲扫描性能优化（Worker 线程、增量扫描）
  - 音频缓冲与预加载策略
- [ ] **原生移动端**：基于 Tauri / Capacitor 或 React Native 构建真正的跨平台移动应用
- [ ] **更多平台支持**：持续跟进新音乐平台的解析与导入
- [ ] **云同步**：支持歌单与收藏的云端同步
- [ ] **插件系统**：支持第三方解析器作为插件动态加载

---

## 📱 关于移动端

当前仓库中的 `mobile_UI/` 目录包含的是**移动端 Web UI**（基于 Vue 3 + Vite），可以通过浏览器访问。

**请注意**：
- ❌ **这不是原生移动端 APP**，只是网页应用的移植
- ❌ 未发布到 App Store / Google Play 等应用商店
- ✅ 可作为 PWA（渐进式 Web 应用）安装到手机主屏
- ✅ 未来计划基于 Tauri 或 React Native 构建真正的原生移动应用

---

## 🔧 核心资产

### 自研技术

| 模块 | 描述 |
|------|------|
| Soda 音频解密 | 自主实现的 AES-CTR + MP4 box 原语解密算法 |
| `music://` 协议 | 自定义文件流协议，绕过系统路径限制，支持 Range 请求 |
| `wuu://` 协议 | 加密歌单分享协议，AES-256-GCM + XOR 混淆 |
| 封面色彩提取 | 从封面图片提取主色调，自适应播放器配色 |
| 桌面歌词窗口 | 独立窗口实现，支持鼠标穿透、位置持久化 |
| Worker 扫描线程 | 多线程文件扫描，避免阻塞主进程 |

### 集成开源项目

| 项目 | 用途 |
|------|------|
| [Electron](https://github.com/electron/electron) | 跨平台桌面应用框架 |
| [Vue 3](https://github.com/vuejs/core) | 渐进式 JavaScript 框架（移动端 UI） |
| [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) | 网易云音乐 API |
| music-dl | 免费听音乐 Web 服务 |

---

## 🤝 协同开发

欢迎任何形式的贡献！我们欢迎：

- 🐛 **Bug 报告**：遇到问题请提交 Issue，并附上复现步骤和日志
- 💡 **功能建议**：有新想法或需求，欢迎讨论
- 🔧 **代码贡献**：提交 Pull Request，贡献你的代码
- 📖 **文档改进**：帮助完善文档和使用说明
- 🌐 **多平台支持**：帮助跟进新音乐平台的解析

### 开发流程

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: 添加惊人的新功能'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

### 贡献规范

- 代码风格遵循现有文件的格式与习惯
- 新功能请添加必要的注释
- 确保不引入不必要的依赖
- 测试覆盖关键路径

---

## ⚖️ 法律与免责声明

> **请仔细阅读以下内容。使用本软件即表示您同意本免责声明的全部条款。**

### 1. 合规使用

本软件仅供**学习、研究和技术交流**使用，不得用于任何商业用途。请严格遵守您所在国家或地区以及相关音乐平台的法律法规、用户协议与服务条款。

### 2. 版权归属

软件中涉及的所有音乐、歌词、封面、视频及其他数字内容，其著作权及相关权益均归**原始权利人**所有。软件不对任何内容主张版权，也**不存储、缓存或分发**任何受版权保护的内容。

### 3. 第三方服务

软件集成了多个第三方平台的服务接口与开源项目，软件与上述第三方**无任何合作关系**，不对第三方服务的可用性、稳定性、内容合法性承担责任。

### 4. 解密与逆向

软件中的音频解密模块仅用于**学习加密算法与音频格式研究**，不得用于绕过数字版权管理（DRM）或规避技术保护措施。

### 5. 账号安全

用户凭据**仅存储于本地配置文件**，软件不会上传或共享任何账号信息。请用户自行评估风险。

### 6. 使用风险

本软件按"**现状**"提供，不提供任何明示或暗示的担保。在适用法律允许的最大范围内，软件作者不对因使用本软件产生的任何直接、间接、附带、特殊或后果性损害承担责任。

### 7. 免责范围

| 风险场景 | 说明 |
|----------|------|
| 法律责任 | 因使用本软件产生的法律责任由使用者自行承担 |
| 账号封禁 | 使用非官方接口可能导致账号被限制或封禁 |
| 数据丢失 | 软件不对数据丢失承担责任，建议定期备份 |
| 服务中断 | 第三方服务可能随时调整，不保证可用性 |
| 功能失效 | 平台变更可能导致功能失效，不承诺持续可用 |

---

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。

---

<p align="center">
  Made with ❤️ by Wuu Music Team
</p>
