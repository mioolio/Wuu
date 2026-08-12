# Wuu Music

一个基于 Electron 构建的本地音乐管理与播放应用，集成多平台歌单导入、在线解析、音频解密、损坏文件修复、桌面歌词与歌单分享等能力。

<p align="center">
  <img src="https://img.shields.io/badge/Electron-2B2E4A?style=for-the-badge&logo=electron&logoColor=9FEAF9" alt="Electron" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" />
</p>

---

## 一、项目简介

Wuu Music（以下简称"Wuu"）是一款面向 Windows 平台的桌面端音乐管理工具。项目以"本地音乐库管理为核心、多平台扩展为补充"为设计理念，为用户提供统一的音乐收藏、播放、导入与分享体验。

### 设计动机

当前主流音乐平台存在以下问题，Wuu 试图从技术层面提供解决方案：

- **平台壁垒**：各音乐平台独占内容分散，用户需安装多个客户端才能覆盖完整曲库，个人音乐收藏难以统一管理。
- **格式封闭**：部分平台下载的音频采用私有加密格式（如汽水音乐 Soda 格式），无法在通用播放器中播放。
- **离线场景**：网络环境不稳定或无网络条件下，仍需访问已收藏的音乐内容。
- **分享限制**：平台间歌单无法互通，向他人分享音乐收藏受限于平台账号体系。

### 项目目标

构建一个以本地文件系统为持久化层的音乐管理工具，通过多平台接口扩展实现歌单导入与在线解析，并通过加密协议实现安全的歌单分享。所有用户数据存储于本地，不依赖云端服务。

---

## 二、核心功能

### 2.1 本地音乐库管理

- 基于文件系统的音乐库组织，按"歌曲名 - 艺人"目录结构存储
- 支持 AAC、MP3、WAV、FLAC、M4A、OGG 等主流音频格式
- Worker 线程文件扫描，避免阻塞主进程
- AAC ADTS 帧解析获取真实音频时长，不依赖元数据标签
- 播放进度每 2 秒持久化至本地，重启后恢复播放位置

### 2.2 多平台歌单导入

支持三个平台的官方账号登录与歌单导入，均支持多账号管理与切换：

| 平台 | 登录方式 | 实现方案 |
|------|----------|----------|
| 网易云音乐 | 二维码扫码 / Cookie 导入 | 内嵌 NeteaseCloudMusicApi 服务 |
| 酷狗音乐 | 二维码 / 手机号验证码 | 内嵌 kugoumusicapi 库 |
| 汽水音乐 | 二维码 / 一键登录 / 凭证文件 | 本地 Cookie 管理 + track_v2 API |

### 2.3 在线解析与下载

通过 `parsers/` 注册中心统一管理多平台分享链接的解析与下载流程。当前支持的平台：

汽水音乐、网易云音乐、QQ 音乐、酷我音乐、咪咕音乐、Bilibili、5sing、千千音乐、Jamendo、JOOX、Apple Music

解析流程：分享链接输入 -> 来源识别 -> 解析歌曲元数据 -> 下载音频（可选解密）+ 封面 + 歌词 -> 写入本地目录

### 2.4 音频解密

自主实现的 Soda 音频解密模块，基于 AES-CTR 加密模式与 MP4 box 结构原语，对汽水音乐下载的加密音频进行解密还原。解密过程完全在本地完成，密钥从平台接口获取后即用于本地处理，不进行任何上传或转发。

### 2.5 歌词系统

- 支持 LRC（行级时间戳）与 KRC（逐字时间戳）两种歌词格式
- KRC 逐字歌词通过 requestAnimationFrame 以 60fps 更新每个字的填充状态
- 桌面歌词窗口：独立 BrowserWindow，支持锁定穿透（click-through）、拖拽定位、位置持久化
- 歌词颜色自适应封面主色调，支持用户自定义已唱/未唱颜色
- 多级回退策略获取歌词：trackPayload 内嵌数据 -> music.douyin.com SSR 接口 -> HTML 页面解析

### 2.6 损坏文件修复

自动扫描本地音乐库，检测以下问题并提供修复：

- 解密失败（仅有 `.enc.m4a` 文件，无可用音频）
- 音频文件缺失或体积过小
- 歌词精度不足（时间戳行数低于阈值）
- 文件名异常（从 FLAC VORBIS_COMMENT 或 ID3 标签读取真实信息重命名）

修复方式：音频问题通过 trackId 重新下载；歌词问题从 KRC 原始数据重新生成。

### 2.7 歌单分享

基于本地 HTTP 服务器与自定义 `wuu://` 协议实现加密歌单分享：

- 本地 HTTP 服务器（默认端口 30967，可配置 1-65535）
- IP 白名单访问控制（支持通配符匹配）
- 频率限制（每 IP 每分钟最大请求数）
- 访问日志记录（最多保留 500 条）
- AES-256-GCM 加密地址与端口，密钥与链接分离传输
- 密钥可导出为本地 `.crt` 文件，支持物理隔离传输

### 2.8 免费听音乐专区

集成 `music-dl` 本地 Web 服务（监听 127.0.0.1:17324），提供多平台音乐搜索、试听、下载、歌词获取与换源能力。该功能设有免责声明，用户需明确接受后方可使用。

服务管理特性：

- 子进程以 `windowsHide: true` 模式启动，无可见窗口
- 过滤 GIN 请求日志，仅保留关键事件与严重错误
- 应用退出时自动终止子进程，避免残留

---

## 三、技术架构

### 3.1 技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 运行时 | Electron 33 + Node.js 18+ | 跨平台桌面应用框架 |
| 主进程 | JavaScript (CommonJS) | 业务逻辑、IPC 处理、文件系统操作 |
| 渲染层 | HTML / CSS / JavaScript | 当前为原生实现，计划逐步迁移至 Vue 3 |
| 移动端 | Vue 3 + Vite 5 | 移动端 Web UI，非原生应用 |
| 构建 | electron-builder 25 | Windows NSIS 安装包打包 |
| 加密 | AES-CTR / AES-256-GCM | 音频解密与歌单分享加密 |
| 数据库 | sql.js (SQLite WASM) | 设置数据持久化 |

### 3.2 主进程模块装配

入口文件 `main.js` 仅负责协议注册、菜单移除、模块装配与应用生命周期管理。所有业务逻辑拆分至独立功能目录，采用 `require 即自动注册 IPC handlers` 的装配方式，实现模块间解耦。

```
main.js
  ├── core/         基础层：日志 / 共享状态 / 配置存储 / 网络工具
  ├── audio/        音频层：扫描 / 时长解析 / 文件校验
  ├── soda/         音频解密：AES-CTR + MP4 box 原语
  ├── cover/        封面色彩提取
  ├── window/       窗口管理：主窗口 + 桌面歌词窗口
  ├── download/     在线解析下载
  ├── repair/       损坏歌曲扫描与修复
  ├── free-music/   免费听音乐专区（music-dl 服务管理）
  ├── kugou/        酷狗音乐歌单导入
  ├── qishui/       汽水音乐服务
  ├── netease/      网易云音乐歌单导入（内嵌 NeteaseCloudMusicApi）
  ├── server/       本地 HTTP 服务器（歌单分享）
  ├── playlist/     歌单导出导入（wuu:// 协议）
  └── parsers/      多平台解析器注册中心
```

### 3.3 自定义协议

#### music:// 协议

自定义文件流协议，通过 Node.js `fs` 模块读取本地文件并返回流式响应。设计目的：

- 绕过 Chromium `file:///` 协议的 MAX_PATH 260 字符路径长度限制
- 支持 HTTP Range 请求，实现音频缓冲与任意位置跳转
- MIME 类型根据文件扩展名自动映射

#### wuu:// 协议

歌单分享专用加密协议，v1 版本格式：

```
wuu://<base64url(JSON{v, f, b, j, jc, r, dt, d, p})>
```

| 字段 | 含义 |
|------|------|
| v | 协议版本 |
| f | 分支型号（produce / exploitation / test） |
| b | 版本数据 |
| j | 兼容性类型 |
| jc | 兼容版本列表 |
| r | 保留数据 |
| dt | 地址类型（dIP / ddomain） |
| d | 加密地址数据（AES-256-GCM + XOR 偏移） |
| p | 加密端口（格式头 + 字母混淆，无数字） |

安全设计：密钥与链接分离传输。接收方通过 `wuu://` 链接获取加密后的地址与端口信息，需配合独立获取的访问密钥（accessKey）才能通过 `http://<host>:<port>/playlist/<id>?k=<accessKey>` 拉取歌单数据。

### 3.4 IPC 通信架构

渲染层通过 `preload.js` 的 `contextBridge` 与主进程通信，无法直接访问 Node.js API。暴露的 API 命名空间如下：

| 命名空间 | 职责 |
|----------|------|
| `musicAPI` | 本地歌曲管理、歌词读取、用户数据、封面色彩 |
| `windowAPI` | 窗口最小化、最大化、关闭、退出 |
| `desktopLyric` | 桌面歌词显示、锁定、位置管理 |
| `parseAPI` | 分享链接解析与下载 |
| `repairAPI` | 损坏歌曲扫描与修复 |
| `freeMusicAPI` | 免费听音乐专区（搜索、试听、下载） |
| `kugouAPI` | 酷狗音乐登录与歌单导入 |
| `qishuiAPI` | 汽水音乐登录与歌单导入 |
| `neteaseAPI` | 网易云音乐登录与歌单导入 |
| `playlistAPI` | 歌单分享、服务器管理、密钥导出导入 |

### 3.5 渲染层架构

当前桌面端渲染层基于原生 HTML/CSS/JavaScript 实现，按功能模块拆分：

```
renderer/
  ├── index.html             主界面入口
  ├── style.css              全局样式
  └── modules/
      ├── state.js           前端状态管理
      ├── dom.js             DOM 引用与操作
      ├── events.js          事件绑定
      ├── init.js            初始化流程
      ├── player-core.js     播放器核心逻辑
      ├── management.js      歌曲管理
      ├── settings.js        设置面板
      └── utils.js           工具函数
```

### 3.6 移动端架构

移动端基于 Vue 3 + Vite 5 实现，当前为 Web 应用形态，通过浏览器访问，未打包为原生移动应用。

```
mobile_UI/
  ├── src/
  │   ├── App.vue            根组件
  │   ├── main.js            应用入口
  │   ├── api.js             API 请求封装
  │   ├── components/
  │   │   ├── BottomNav.vue  底部导航
  │   │   ├── LyricsView.vue 歌词视图
  │   │   ├── Player.vue     播放器组件
  │   │   └── SongList.vue   歌曲列表
  │   ├── composables/
  │   │   └── usePlayer.js   播放器组合式函数
  │   └── styles/
  │       └── main.css       全局样式
  ├── vite.config.js         Vite 配置
  └── package.json
```

---

## 四、目录结构

```
SQET/
├── main.js                       主进程入口
├── preload.js                    上下文桥接（IPC API 暴露）
├── package.json                  项目元数据与构建配置
├── music-dl.exe                  免费听音乐专区 Web 服务
├── core/                         基础层
│   ├── logger.js                 日志（过滤 GIN 噪音）
│   ├── state.js                  共享状态
│   ├── storage.js                配置目录持久化
│   └── network.js                网络工具
├── audio/                        音频层
│   ├── scanner.js                文件扫描
│   ├── duration.js               AAC ADTS 帧时长解析
│   └── verify.js                 文件完整性校验
├── soda/                         Soda 音频解密
│   └── decrypt.js                AES-CTR + MP4 box 原语
├── cover/
│   └── color.js                  封面主色调提取
├── window/                       窗口管理
│   ├── main-window.js            主窗口
│   └── desktop-lyric.js          桌面歌词窗口
├── download/
│   └── index.js                  在线解析下载
├── repair/
│   └── index.js                  损坏歌曲扫描与修复
├── free-music/                   免费听音乐专区
│   ├── service.js                music-dl 服务管理
│   └── ipc.js                    IPC 处理
├── kugou/                        酷狗音乐
│   ├── config.js                 多账号配置
│   ├── auth.js                   登录刷新
│   └── ipc.js                    IPC 处理
├── qishui/                       汽水音乐
│   ├── utils.js                  工具函数与歌词获取
│   ├── config.js                 配置
│   └── ipc.js                    IPC 处理
├── netease/                      网易云音乐
│   ├── config.js                 配置
│   └── ipc.js                    IPC 处理
├── server/
│   ├── index.js                  本地 HTTP 服务器
│   └── scanner-worker.js         文件扫描 Worker 线程
├── playlist/
│   └── share.js                  wuu:// 协议与分享管理
├── parsers/                      多平台解析器
│   ├── base.js                   基类
│   ├── index.js                  注册中心
│   ├── algorithms/               算法（歌词格式、来源识别）
│   ├── auth/                     鉴权（Cookie 管理）
│   ├── platforms/                各平台解析实现
│   └── qishui-decrypt/           汽水音乐解密
│       ├── track-download.js     音频下载与解密
│       ├── track-decryptor.js    解密器实现
│       ├── decrypt-utils.js      解密工具函数
│       └── qishui-auth.js        认证配置
├── renderer/                     渲染层
│   ├── index.html                主界面
│   └── modules/                  前端模块
├── mobile_UI/                    移动端 Web UI（Vue 3 + Vite）
│   ├── src/
│   ├── package.json
│   └── vite.config.js
├── scripts/
│   ├── dev.js                    开发模式启动脚本
│   └── patch-kugoumusicapi.js    依赖补丁脚本
└── tools/
    └── netease-api/              内嵌 NeteaseCloudMusicApi
```

---

## 五、安装与运行

### 5.1 环境要求

- Node.js >= 18
- npm >= 9
- Windows 10/11（当前版本主要面向 Windows 平台）

### 5.2 安装依赖

```bash
npm install
```

安装完成后会自动执行 `scripts/patch-kugoumusicapi.js` 对酷狗音乐 API 依赖进行补丁处理。

### 5.3 开发模式

```bash
# 仅启动桌面端
npm start

# 同时启动桌面端与移动端（Vite 热更新）
npm run dev:all
```

开发模式下，移动端 UI 在 `http://localhost:5174/` 启动 Vite dev server，支持文件修改热更新。桌面端代码修改需重启 Electron 进程。

### 5.4 构建打包

```bash
npm run build
```

使用 electron-builder 构建 Windows NSIS 安装包，输出目录为 `dist/`。构建配置详见 `package.json` 中的 `build` 字段。

### 5.5 移动端单独构建

```bash
npm run build:mobile
```

将移动端 Vue 项目构建为静态文件，输出至 `mobile_UI/dist/`。

---

## 六、项目状态与路线规划

### 6.1 当前状态

| 模块 | 状态 | 说明 |
|------|------|------|
| 本地音乐管理 | 稳定 | 核心功能已完成，支持多格式扫描与播放 |
| 桌面端渲染层 | 稳定 | 基于原生 HTML/CSS/JavaScript 实现，计划逐步重构为 Vue 3 |
| 音频解密 | 稳定 | Soda 格式（AES-CTR）解密已实现 |
| 多平台歌单导入 | 稳定 | 网易云、酷狗、汽水三平台支持 |
| 在线解析下载 | 维护中 | 依赖第三方平台接口，需持续跟进接口变更 |
| 歌词系统 | 稳定 | 逐字歌词解析，多级回退获取策略 |
| 移动端 Web UI | 开发中 | Vue 3 + Vite 实现，为网页应用移植，未发布原生应用 |
| 整体性能 | 待优化 | 大规模歌单渲染、启动速度等模块存在优化空间 |

### 6.2 路线规划

**短期目标：**

- 渲染层框架迁移：将桌面端原生 HTML 渲染层逐步重构为 Vue 3 组件化架构，提升可维护性与组件复用性
- 性能优化：大规模歌单渲染采用虚拟滚动与分页加载；歌曲扫描引入增量扫描机制；音频缓冲与预加载策略优化
- 移动端完善：补充功能模块，优化移动端交互体验

**中长期目标：**

- 原生移动应用：基于 Tauri 或 React Native 构建真正的跨平台原生移动应用
- 云同步能力：支持歌单与收藏的端到端加密云端同步
- 插件系统：支持第三方解析器以插件形式动态加载，无需修改核心代码
- 更多平台支持：持续跟进新音乐平台的解析与导入能力

---

## 七、关于移动端

当前仓库中 `mobile_UI/` 目录包含的是基于 Vue 3 + Vite 构建的移动端 Web UI，可通过浏览器访问。

需要说明的是：

- 当前移动端为网页应用移植，并非原生移动应用
- 未发布至 App Store、Google Play 等应用商店
- 可作为 PWA（渐进式 Web 应用）安装至移动设备主屏
- 未来计划基于 Tauri 或 React Native 构建真正的原生移动应用

---

## 八、核心资产

### 8.1 自研技术模块

| 模块 | 技术描述 |
|------|----------|
| Soda 音频解密 | 基于 AES-CTR 加密模式与 MP4 ISO Base Media File Format box 结构原语自主实现的解密算法，支持从加密的 M4A 容器中还原原始音频流 |
| music:// 协议 | 基于 Electron protocol.registerStreamProtocol 实现的自定义文件流协议，绕过 Chromium file:/// 协议的 MAX_PATH 260 限制，支持 HTTP Range 请求 |
| wuu:// 协议 | 歌单分享加密协议，采用 AES-256-GCM 对地址与端口进行加密，辅以 XOR 偏移与字母混淆，密钥与链接分离传输 |
| 封面色彩提取 | 从封面图片像素数据中提取主色调，排除低占比颜色干扰，用于播放器界面自适应配色 |
| 桌面歌词窗口 | 基于 BrowserWindow 的独立透明窗口，通过 setIgnoreMouseEvents 实现锁定状态下的鼠标穿透，窗口位置持久化至配置文件 |
| Worker 扫描线程 | 基于 Node.js worker_threads 的文件扫描线程，避免大规模文件系统操作阻塞 Electron 主进程 |

### 8.2 集成开源项目

| 项目 | 用途 | 许可证 |
|------|------|--------|
| [Electron](https://github.com/electron/electron) | 跨平台桌面应用运行时框架 | MIT |
| [Vue 3](https://github.com/vuejs/core) | 渐进式 JavaScript 框架（移动端 UI） | MIT |
| [Vite](https://github.com/vitejs/vite) | 前端构建工具（移动端） | MIT |
| [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) | 网易云音乐 API 服务 | MIT |
| [jpeg-js](https://github.com/eugeneware/jpeg-js) | JPEG 图像解码（封面处理） | BSD-3-Clause |
| [sql.js](https://github.com/sql-js/sql.js) | SQLite WASM 编译版（设置持久化） | MIT |

---

## 九、协同开发

欢迎任何形式的贡献。以下为参与方式说明：

### 9.1 贡献方式

- **问题反馈**：遇到 Bug 或功能异常，请提交 Issue 并附上复现步骤、操作系统版本与应用日志
- **功能建议**：有新功能需求或改进建议，欢迎提交 Issue 进行讨论
- **代码贡献**：提交 Pull Request，请确保代码风格与现有代码一致
- **文档完善**：帮助改进文档内容与使用说明
- **平台适配**：协助跟进新音乐平台的接口变更与解析适配

### 9.2 开发流程

1. Fork 本仓库至个人账号
2. 基于 main 分支创建特性分支：`git checkout -b feature/your-feature`
3. 提交更改，遵循 Conventional Commits 规范：`git commit -m "feat: 简要描述"`
4. 推送至远程分支：`git push origin feature/your-feature`
5. 提交 Pull Request 并描述变更内容与动机

### 9.3 代码规范

- 遵循现有文件的代码风格与命名习惯
- 新增功能需添加必要的代码注释
- 不引入非必要的第三方依赖
- 对关键逻辑路径进行适当的错误处理

---

## 十、安全说明

- 所有 IPC 通信通过 `contextBridge` 隔离，渲染层无法直接访问 Node.js API
- 歌单分享服务器支持 IP 白名单、频率限制与访问日志，可控制访问范围
- 分享链接使用 AES-256-GCM 加密地址与端口，密钥与链接分离传输
- 免费听音乐的 music-dl 服务仅监听本地 127.0.0.1，不对外暴露
- 用户凭据（Cookie、sessionid 等）仅存储于本地配置文件，不上传至任何服务

---

## 十一、配置与数据

| 路径 | 说明 |
|------|------|
| `config/userdata.json` | 用户数据（喜欢列表、不推荐列表、歌单、播放统计、播放进度、应用设置） |
| `config/duration_cache.json` | 音频时长缓存（避免重复解析 AAC ADTS 帧） |
| `config/free_music.json` | 免费听音乐专区数据 |
| `config/kugou_config.json` | 酷狗音乐多账号配置 |
| `config/qishui_config.json` | 汽水音乐多账号配置 |
| `config/shared/` | 已分享的歌单数据 |
| `output/` | 下载的歌曲目录（按"歌曲名 - 艺人"结构组织） |
| `data/settings.db` | 设置数据库（SQLite） |

---

## 十二、法律与免责声明

> 请仔细阅读以下内容。使用本软件即表示您同意本免责声明的全部条款。

### 12.1 合规使用

本软件仅供学习、研究和技术交流使用，不得用于任何商业用途。请严格遵守您所在国家或地区以及相关音乐平台的法律法规、用户协议与服务条款。因使用本软件产生的任何法律责任由使用者自行承担。

### 12.2 版权归属

软件中涉及的所有音乐、歌词、封面、视频及其他数字内容，其著作权及相关权益均归原始权利人所有。软件不对任何内容主张版权，也不存储、缓存或分发任何受版权保护的内容。用户通过本软件访问的第三方服务，其内容与版权状态由对应平台负责。

### 12.3 第三方服务

软件集成了多个第三方平台的服务接口与开源项目（包括但不限于网易云音乐、酷狗音乐、汽水音乐、QQ 音乐、酷我音乐、咪咕音乐、Bilibili、5sing、千千音乐、Jamendo、JOOX、Apple Music，以及 NeteaseCloudMusicApi、music-dl 等开源项目）。软件与上述第三方无任何合作关系，不对第三方服务的可用性、稳定性、内容合法性承担责任。如第三方服务条款禁止此类访问方式，请停止使用相关功能。

### 12.4 解密与逆向

软件中的 Soda 音频解密、汽水音乐解密等模块仅用于学习加密算法与音频格式研究，不得用于绕过数字版权管理（DRM）或规避技术保护措施。若相关行为违反您所在地区的法律（例如《中华人民共和国著作权法》《数字千年版权法》等），请勿使用相关功能。

### 12.5 账号安全

使用扫码登录、Cookie 导入、凭证文件登录等功能时，用户凭据仅存储于本地配置文件，软件不会上传或共享任何账号信息。请用户自行评估在第三方平台输入账号信息的风险，因账号使用不当导致的损失由用户自行承担。

### 12.6 网络服务

歌单分享功能启动后会开放本地 HTTP 服务端口，请用户根据自身网络环境合理配置绑定 IP、白名单与频率限制，避免未授权访问。软件不对因配置不当导致的数据泄露、未授权访问或其他网络安全问题承担责任。

### 12.7 免责范围

在适用法律允许的最大范围内，软件作者不对因使用或无法使用本软件而产生的任何直接、间接、附带、特殊或后果性损害（包括但不限于数据丢失、利润损失、业务中断）承担责任。

### 12.8 使用风险

本软件按"现状"提供，不提供任何明示或暗示的担保。用户使用本软件即表示已阅读并理解本免责声明的全部内容，并自愿承担使用风险。

| 风险场景 | 说明 |
|----------|------|
| 法律责任 | 因使用本软件产生的法律责任由使用者自行承担 |
| 账号封禁 | 使用非官方接口可能导致账号被限制或封禁 |
| 数据丢失 | 软件不对数据丢失承担责任，建议定期备份 |
| 服务中断 | 第三方服务可能随时调整，不保证可用性 |
| 功能失效 | 平台接口变更可能导致功能失效，不承诺持续可用 |

如您不同意本免责声明的任何条款，请立即停止使用本软件并删除所有相关文件。

---

## 十三、许可证

本项目基于 MIT License 开源，详见仓库根目录 LICENSE 文件。
