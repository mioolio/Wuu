# Wuu Music

一个基于 Electron 构建的本地音乐管理与播放应用，集成多平台歌单导入、在线解析、音频解密、Web Audio 音效系统、损坏文件自动修复、桌面歌词与加密歌单分享等能力。

<p align="center">
  <img src="https://img.shields.io/badge/Electron-2B2E4A?style=for-the-badge&logo=electron&logoColor=9FEAF9" alt="Electron" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Web_Audio_API-FB7299?style=for-the-badge&logo=webaudio&logoColor=white" alt="Web Audio API" />
  <img src="https://img.shields.io/badge/Vue_3-42B883?style=for-the-badge&logo=vue.js&logoColor=white" alt="Vue 3" />
  <img src="https://img.shields.io/badge/Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" />
</p>

<p align="center">
  <a href="#七安装与运行">安装与运行</a> · <a href="#三技术架构">技术架构</a> · <a href="#二核心功能">功能总览</a> · <a href="#五ipc-api-参考">API 参考</a> · <a href="#十二法律与免责声明">免责声明</a>
</p>

---

## 一、项目简介

Wuu Music（以下简称"Wuu"）是一款面向 Windows 平台的桌面端音乐管理工具。项目以"本地音乐库管理为核心、多平台扩展为补充"为设计理念，为用户提供统一的音乐收藏、播放、导入与分享体验。

### 设计动机

当前主流音乐平台存在以下问题，Wuu 旨在从技术层面提供解决方案：

- **平台壁垒**：各音乐平台独占内容分散，用户需安装多个客户端才能覆盖完整曲库，个人音乐收藏难以统一管理。
- **格式封闭**：部分平台下载的音频采用私有加密格式（如汽水音乐 Soda 格式），无法在通用播放器中播放。
- **离线场景**：网络环境不稳定或无网络条件下，仍需访问已收藏的音乐内容。
- **分享限制**：平台间歌单无法互通，向他人分享音乐收藏受限于平台账号体系。
- **音效单一**：多数本地播放器仅提供基础播放功能，缺乏专业级音效调节能力。
- **损坏处理**：音频文件损坏后播放器卡死，缺乏自动跳过与修复机制。

### 项目目标

构建一个以本地文件系统为持久化层的音乐管理工具，通过多平台接口扩展实现歌单导入与在线解析，并通过加密协议实现安全的歌单分享。所有用户数据存储于本地，不依赖云端服务。

---

## 二、核心功能

### 2.1 本地音乐库管理

- 基于文件系统的音乐库组织，按"歌曲名 - 艺人"格式的目录结构存储
- 支持 AAC、MP3、WAV、FLAC、M4A、OGG 等主流音频格式
- Worker 线程文件扫描，通过 Node.js `worker_threads` 实现，避免阻塞 Electron 主进程
- AAC ADTS 帧解析获取真实音频时长，不依赖可能不可靠的元数据标签
- 播放进度每 2 秒持久化至本地，重启后恢复播放位置

### 2.2 Web Audio 音效系统

基于浏览器原生 Web Audio API 构建的专业级音效处理链，无需第三方音频库即可实现实时音频处理：

**效果链路**：

```
mediaSource → highpass → 10段peaking EQ → lowshelf → highshelf
            → M/S立体声加宽 → StereoPanner(环绕声像) → Convolver(混响)
            → dry/wet混合 → gainNode → destination
```

**9 个内置预设**：

| 预设 | 实现原理 |
|------|----------|
| 关闭 | 全链路透明（HP 20Hz / 增益 0dB / 宽度 1 / 湿度 0），无染色直通 |
| 超重低音 | lowshelf +7dB @ 90Hz + 31/62Hz peaking 增益 |
| 清澈人声 | highpass 110Hz 去闷 + 中高频 2-4kHz 增益 + 立体声宽度 1.1 |
| 360度环绕 | M/S 加宽至 2.2 + LFO 0.08Hz 声像摆动 + 微量混响 |
| 3D音效 | 高频 shelf +2dB + 宽度 1.7 + 0.12 摆动深度 + 板式混响 |
| HIFI现场 | 程序生成 1.9s 指数衰减 IR 的板式混响（湿度 0.18）+ 宽度 1.3 |
| 动感电音 | lowshelf +5dB + 高频 8-16kHz 大幅增益 |
| 摇滚音效 | 中频下凹 + 高低频提升 + 宽度 1.15 |
| 复古唱片 | highpass 120Hz + 高频急剧衰减（16kHz -9dB）+ 低频共鸣 |

**自定义 EQ**：

- 10 段 peaking 滤波器，中心频率：31 / 62 / 125 / 250 / 500 / 1k / 2k / 4k / 8k / 16k Hz
- 每段 -12 ~ +12 dB 可调，实时 `setTargetAtTime` 平滑过渡防爆音
- 支持命名保存多个自定义方案，持久化到 `userdata.json` 的 `audioFx` 字段

### 2.3 多平台歌单导入

支持三个平台的官方账号登录与歌单导入，均支持多账号管理与切换：

| 平台 | 登录方式 | 实现方案 |
|------|----------|----------|
| 网易云音乐 | 二维码扫码 / Cookie 导入 | 内嵌 NeteaseCloudMusicApi 开源服务 |
| 酷狗音乐 | 二维码 / 手机号验证码 | 内嵌 kugoumusicapi 开源库 |
| 汽水音乐 | 二维码 / 一键登录 / 凭证文件 | 本地 Cookie 管理 + track_v2 API（含 CSRF 令牌与完整 Cookie 传递） |

汽水音乐导入支持 VIP 用户按指定音质下载（含无损/Hi-Res），通过客户端同款签名请求（见 [4.3 签名请求机制](#43-汽水音乐签名请求机制)）获取完整音质直链。

### 2.4 在线解析与下载

通过 `parsers/` 注册中心统一管理多平台分享链接的解析与下载流程。当前支持的平台：

汽水音乐、网易云音乐、QQ 音乐、酷我音乐、咪咕音乐、Bilibili、5sing、千千音乐、Jamendo、JOOX、Apple Music

解析流程：分享链接输入 → 来源自动识别 → 解析歌曲元数据 → 下载音频（可选 AES-CTR 解密）+ 封面 + 歌词 → 写入本地目录

### 2.5 音频解密

自主实现的 Soda 音频解密模块，基于 AES-CTR 加密模式与 MP4 ISO Base Media File Format box 结构原语，对汽水音乐下载的加密音频进行解密还原。

**解密流程**：

1. 从平台接口获取 `playAuth` 字段，提取加密密钥
2. 解析 MP4 box 结构：定位 `moov/trak/mdia/minf/stbl/stsz/senc/mdat`
3. 按 `senc`（Sample Encryption Box）中的样本偏移逐样本 AES-CTR 解密
4. 修正 `stsd`（Sample Description Box）与加密 metadata box，还原为标准 MP4

解密过程完全在本地完成，密钥从平台接口获取后即用于本地处理，不进行任何上传或转发。

### 2.6 歌词系统

- 支持 LRC（行级时间戳）与 KRC（逐字时间戳）两种歌词格式
- KRC 逐字歌词通过 `requestAnimationFrame` 以 60fps 更新每个字的填充状态（已唱完/正在唱/未开始）
- 桌面歌词窗口：独立 BrowserWindow，支持锁定穿透（click-through）、拖拽定位、位置持久化
- 锁定状态下悬停控制按钮区临时恢复交互，离开后恢复穿透
- 歌词颜色自适应封面主色调，支持用户自定义已唱/未唱颜色
- 长歌词跑马灯滚动（可配置速度/阈值/停留时间），回退到字号缩放
- 多级回退策略获取歌词：trackPayload 内嵌数据 → music.douyin.com SSR 接口 → HTML 页面解析

### 2.7 损坏文件修复与播放失败处理

**自动扫描**：扫描本地音乐库，检测以下问题并提供修复：

- 解密失败（仅有 `.enc.m4a` 文件，无可用音频）
- 音频文件缺失或体积过小
- 歌词精度不足（时间戳行数低于阈值）
- 文件名异常（从 FLAC VORBIS_COMMENT 或 ID3 标签读取真实信息重命名）

**修复方式**：

- 音频问题 → 通过 trackId 重新调用 track_v2 API 获取新 URL + playAuth，重新下载并解密
- 歌词问题 → 从 `lyrics_krc.json` 重新生成逐字 raw 文本；无 krc.json 时弹出手动修复对话框（用户输入分享链接重新解析）
- 名称异常 → 从 FLAC VORBIS_COMMENT 读取 TITLE/ARTIST/ALBUM，重命名文件夹 + 音频文件 + lrc + 更新 info.json

**播放失败自动处理**：

- 播放器监听 `audio.error` 事件（MEDIA_ERR_NETWORK / DECODE / SRC_NOT_SUPPORTED）
- 自动跳转下一首歌曲，连续失败 ≥5 次或超过列表长度时停止（防全坏列表死循环）
- 失败歌曲自动上报至 `config/play_failed.json`，修复中心扫描时合并显示为"播放失败"条目
- 文件级校验（verifyAudioFile）检不出的解码损坏，靠此播放时上报机制补充
- 修复成功或删除歌曲后自动清除对应的播放失败记录
- 修复失败与"无法修复"的条目提供删除按钮（用户可选择删除或保留）

### 2.8 歌单分享

基于本地 HTTP 服务器与自定义 `wuu://` 协议实现加密歌单分享：

- 本地 HTTP 服务器（默认端口 30967，可配置 1-65535）
- IP 白名单访问控制（支持通配符匹配，如 `192.168.*.*`）
- 频率限制（每 IP 每分钟最大请求数，0 = 不限制，本机始终放行）
- 访问日志记录（最多保留 500 条，含下载/访问歌单/获取封面/获取歌词/拒绝/超限分类）
- AES-256-GCM 加密地址与端口，密钥与链接分离传输
- 密钥可导出为本地 `.crt` 文件，支持物理隔离传输

**HTTP 路由**：

| 路由 | 方法 | 说明 | 访问计数 |
|------|------|------|----------|
| `/playlist/:id?k=<accessKey>` | GET | 获取歌单 JSON（明文，但需正确 accessKey） | 递增 usedCount |
| `/stream/:id/:songIndex?k=<accessKey>` | GET | 流式返回音频，支持 Range 请求 | 不递增 |
| `/cover/:id/:songIndex?k=<accessKey>` | GET | 返回封面图片 | 不递增 |
| `/lyric/:id/:songIndex?k=<accessKey>` | GET | 返回歌词文本 | 不递增 |

访问计数说明：`/stream`、`/cover`、`/lyric` 属于同一访问会话内的子请求，不单独递增 `usedCount`，仅 `/playlist` 路由每次访问算 1 次。

### 2.9 免费听音乐专区

集成 `music-dl` 本地 Web 服务（监听 127.0.0.1:17324），提供多平台音乐搜索、试听、下载、歌词获取与换源能力。该功能设有免责声明，用户需明确接受后方可使用。

服务管理特性：

- 子进程以 `windowsHide: true` 模式启动，无可见窗口
- 过滤 GIN 请求日志，仅保留关键事件与严重错误
- 应用退出时自动终止子进程，避免残留
- 试听缓存复用：保存到本地歌库时，若试听已下载解密到临时文件，直接复用免二次下载

### 2.10 移动端同步与 MediaSession

移动端 Web UI 基于 Vue 3 + Vite 5 实现，通过浏览器访问桌面端 HTTP 服务同步播放状态：

- 播放状态同步：歌曲、进度、播放状态实时同步（节流 3 秒）
- MediaSession API：安卓锁屏/通知栏/状态栏显示封面 + 歌名 + 上一首/下一首控制
- 声明支持的操作：play、pause、previoustrack、nexttrack、seekto、stop
- `updateMediaPositionState()` 支持系统进度条拖动同步
- 播放/暂停/停止时立即更新 MediaSession 状态，timeupdate 期间持续更新位置

---

## 三、技术架构

### 3.1 技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 运行时 | Electron 33 + Node.js 18+ | 跨平台桌面应用框架 |
| 主进程 | JavaScript (CommonJS) | 业务逻辑、IPC 处理、文件系统操作 |
| 渲染层 | HTML / CSS / JavaScript | 当前为原生实现，计划逐步迁移至 Vue 3 |
| 移动端 | Vue 3 + Vite 5 | 移动端 Web UI，非原生移动应用 |
| 音频处理 | Web Audio API | 原生 BiquadFilter / Convolver / StereoPanner / GainNode |
| 构建 | electron-builder 25 | Windows NSIS 安装包打包 |
| 加密 | AES-CTR / AES-256-GCM | 音频解密与歌单分享加密 |
| 数据持久化 | JSON 文件（原子写） | userdata.json / play_failed.json / duration_cache.json |

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
  ├── repair/       损坏歌曲扫描与修复 + 播放失败记录
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

- 绕过 Chromium `file:///` 协议在 Windows 平台的 MAX_PATH 260 字符路径长度限制
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
| p | 加密端口（格式头 + 字母混淆，端口号不以明文数字呈现） |

安全设计：密钥与链接分离传输。接收方通过 `wuu://` 链接获取加密后的地址与端口信息，需配合独立获取的访问密钥（accessKey）才能通过 `http://<host>:<port>/playlist/<id>?k=<accessKey>` 拉取歌单数据。

### 3.4 渲染层架构

当前桌面端渲染层基于原生 HTML/CSS/JavaScript 实现，按功能模块拆分：

```
renderer/
  ├── index.html             主界面入口
  ├── style.css              全局样式（@import 各功能样式表）
  ├── styles/
  │   ├── player.css          播放栏与控制按钮
  │   ├── audio-fx.css        音效弹窗与 EQ 滑块
  │   ├── repair.css          修复中心列表与状态
  │   └── ...
  └── modules/
      ├── state.js            前端状态管理（含 appSettings 默认值）
      ├── dom.js              DOM 引用与操作
      ├── events.js           事件绑定
      ├── init.js             初始化流程（加载 userdata 合并设置）
      ├── player-core.js      播放器核心（WebAudio 增益链 + 音效链接入点）
      ├── audio-fx.js         音效系统（9 预设 + 10 段 EQ + 方案保存）
      ├── management.js       歌曲管理
      ├── settings.js         设置面板
      ├── repair.js            修复中心 UI（扫描/修复/删除）
      └── utils.js            工具函数
```

### 3.5 移动端架构

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
  │   │   └── usePlayer.js   播放器组合式函数（含 MediaSession 集成）
  │   └── styles/
  │       └── main.css       全局样式
  ├── vite.config.js         Vite 配置
  └── package.json
```

---

## 四、核心技术实现

### 4.1 Web Audio 音效链

音效系统在 `renderer/modules/audio-fx.js` 中实现，通过 `buildFxChain()` 在播放器首次 `play()` 时将效果链插入 `mediaSource` 与 `gainNode` 之间。

**关键技术点**：

- **M/S 立体声加宽**：使用 `ChannelSplitter` + `ChannelMerger` 将立体声拆分为 Mid（L+R）与 Side（L−R）通道，通过控制 Side 通道增益实现声场宽度调节。宽度 = 1 时输出与输入完全一致，无染色。
- **环绕声像摆动**：`StereoPanner` 节点配合低频 LFO（`OscillatorNode`，0.05-0.08Hz）实现声像缓慢左右摆动，模拟 360 度环绕效果。
- **程序生成混响 IR**：`_makeImpulse()` 函数生成 1.9 秒指数衰减的立体声噪声 Impulse Response，无需外部音频文件，Convolver 节点加载后实现板式混响效果。
- **平滑参数过渡**：所有参数切换使用 `setTargetAtTime(value, currentTime, 0.03)` 实现 30ms 指数过渡，避免预设切换时的爆音。
- **构建失败回退**：效果链构建异常时自动回退为 `mediaSource` 直连 `gainNode`，不影响基础播放。

### 4.2 播放失败修复链

播放失败从检测到修复的完整链路：

```
audio.error 事件 (code=2/3/4)
  → player-core.js: playFailCount++ (连续失败保护)
  → IPC report-play-failed → repair/index.js → config/play_failed.json
  → 自动跳下一首 (pickNextIdx)
  → 用户进入修复中心 → scan-damaged-songs
    → 文件级校验 (verifyAudioFile) + play_failed.json 合并
    → 显示"播放失败"条目
    → 修复 (trackId 重新下载) 或 删除 (deleteSongFolder)
    → removePlayFailed 清除记录
```

**play_failed.json 管理函数**（位于 `core/storage.js`）：

| 函数 | 说明 |
|------|------|
| `readPlayFailed()` | 读取播放失败记录列表 |
| `writePlayFailed(list)` | 写入播放失败记录列表 |
| `removePlayFailed(folder)` | 按文件夹名移除记录 |
| `removePlayFailedByAudioPath(audioPath)` | 按音频路径推导文件夹名并移除 |

### 4.3 汽水音乐签名请求机制

为解决汽水音乐 API 风控导致的会员歌曲无法获取问题，通过逆向工程提取了客户端的签名逻辑：

**实现路径**（`parsers/qishui-decrypt/bdms-signer.js`）：

1. **bdms.node 加载**：从 `parsers/qishui-decrypt/native/` 加载汽水音乐客户端的原生签名模块（含 `metasecml.dll` 依赖），支持 asar / asar.unpacked 路径回退
2. **设备 ID 持久化**：首次生成 device_id 并存储到 `config/qishui_device.json`，后续复用
3. **签名生成**：调用 `bdms.generateHttpSignatureHeaders()` 生成客户端同款签名头，包括 `X-Helios`、`X-Medusa` 等字段
4. **签名请求**：`track-download.js` 中的 `fetchTrackPayloadSigned()` 使用签名头发送 track_v2 请求，标记 `__signed=true` 供音质匹配逻辑使用
5. **音质匹配**：签名响应优先精确匹配用户指定音质，无匹配时选用最高码率
6. **安全回退**：签名请求失败时回退到 SSR / 后端链获取基础试听片段

> **说明**：签名模块（`bdms.node`、`metasecml.dll`）为汽水音乐客户端专有二进制文件，已通过 `.gitignore` 排除，不纳入版本控制。逆向研究脚本与抓包记录同样排除。

### 4.4 桌面歌词锁定态交互

桌面歌词窗口在锁定（鼠标穿透）状态下，控制按钮区域仍可点击：

- 渲染进程监听控制栏 `mouseenter`/`mouseleave` 事件
- 悬停时通过 IPC `lyric-set-interactive` 临时调用 `setIgnoreMouseEvents(false)` 恢复交互
- 离开时恢复 `setIgnoreMouseEvents(true, { forward: true })` 并保持 mousemove 转发以持续检测悬停
- 窗口设置 `skipTaskbar: true`，任务栏不显示歌词窗口图标，避免悬停时弹出双窗口选择

### 4.5 封面色彩提取算法

`cover/color.js` 实现的封面主色调提取：

1. 读取封面图片像素数据（JPG 使用 jpeg-js 解码避免色彩空间问题）
2. 将 RGBA 像素按 HSL 色相分为 13 个桶（每个桶覆盖约 27.7 度色相范围）
3. 计算每个桶的相对权重（像素数量 × 亮度因子）
4. 降序排列，取权重最高的桶作为主色调
5. 排除低占比颜色干扰（如封面角落 0.52% 覆盖率的红色签名）

### 4.6 AAC ADTS 帧时长解析

`audio/duration.js` 实现的真实时长解析：

1. 识别 AAC 帧头同步字（0xFFF），统计帧数
2. 从帧头推导采样率索引
3. 时长 = `frameCount × 1024 / sampleRate`
4. 小文件（<10MB）完整遍历，大文件分段采样（每 1MB 读取一段）
5. 当 `audio.duration` 与帧解析时长偏差 >30 秒时信任帧解析值（Chromium 估算可能严重虚高）

### 4.7 试听缓存复用

`qishui/ipc.js` 的 import-song IPC 在下载前检查临时缓存：

1. 扫描 `os.tmpdir()` 下的 `qishui-preview-<trackId>.{m4a,flac,mp3,mp4}` 文件
2. 命中且文件 >1024 字节时直接读取为 buffer，跳过网络下载
3. 根据 extension 自动设置 Content-Type
4. 未命中时回退到正常下载流程

### 4.8 原子写与损坏备份

`core/storage.js` 的 userdata 写入采用原子操作：

1. 先写入 `.tmp` 临时文件
2. `fs.renameSync` 原子替换目标文件（同分区下保证不出现半写状态）
3. 写入时立即失效读取缓存（`_udCache = null`）
4. 解析失败时自动备份损坏文件为 `userdata.json.corrupt-<timestamp>`，避免下次写入覆盖原始数据

---

## 五、IPC API 参考

渲染层通过 `preload.js` 的 `contextBridge` 与主进程通信，无法直接访问 Node.js API。

### 5.1 musicAPI — 本地音乐管理

| 方法 | 说明 |
|------|------|
| `getSongs()` | 获取本地歌曲列表（扫描 output/ 目录） |
| `getLyrics(lrcPath)` | 读取歌词文件 |
| `getUserData()` | 读取 userdata.json |
| `saveUserData(data)` | 异步保存用户数据 |
| `saveUserDataSync(data)` | 同步保存（用于 beforeunload 等关键场景） |
| `extractCoverColor(filePath)` | 提取本地封面主色调 |
| `extractCoverColorFromURL(url)` | 从 URL 提取封面主色调 |
| `deleteSongFolder(audioPath)` | 删除歌曲文件夹（含音频/封面/歌词） |

### 5.2 desktopLyric — 桌面歌词

| 方法 | 说明 |
|------|------|
| `toggle(show)` | 显示/隐藏桌面歌词窗口 |
| `lock(locked)` | 锁定/解锁（锁定后鼠标穿透） |
| `setInteractive(on)` | 锁定态临时恢复/恢复穿透（悬停按钮时） |
| `send(payload)` | 发送歌词数据与当前时间 |
| `setPosition(pos)` | 设置窗口位置（null = 居中） |
| `onBoundsSaved(cb)` | 监听窗口位置已保存事件 |
| `onClosed(cb)` | 监听 X 按钮关闭事件 |

### 5.3 repairAPI — 修复中心

| 方法 | 说明 |
|------|------|
| `scan()` | 扫描损坏歌曲（文件级校验 + play_failed.json 合并） |
| `repair(item)` | 修复单首歌曲（音频/歌词/名称/版权） |
| `repairLyricsManual(folder, shareLink)` | 手动修复歌词（用户提供分享链接） |
| `reportPlayFailed(info)` | 上报播放失败（audioPath, songName, artist） |

### 5.4 parseAPI — 在线解析

| 方法 | 说明 |
|------|------|
| `parse(shareText)` | 解析分享链接 |
| `parseStream(texts)` | 批量解析（流式进度推送） |
| `parseKugouJsonStream(jsonText)` | 酷狗 JSON 批量解析 |
| `checkExists(info)` | 检查歌曲是否已存在 |
| `download(info, overwrite)` | 下载解析结果 |
| `onParseProgress(cb)` | 监听解析进度事件 |

### 5.5 playlistAPI — 歌单分享

| 方法 | 说明 |
|------|------|
| `exportPlaylist(name, songs, expireAt, maxUses, ...)` | 导出分享歌单 |
| `listSharedPlaylists()` | 列出已分享歌单 |
| `deleteSharedPlaylist(id)` | 销毁分享歌单 |
| `getSharedPlaylist(id)` | 查询分享详情 |
| `exportCrt(key, shareLink, name)` | 导出密钥到 .crt 文件 |
| `importCrt()` | 从 .crt 文件导入 |
| `parseLink(link, key, remoteHost)` | 解析 wuu:// 链接 |
| `downloadSong(song, overwrite)` | 下载远程歌单歌曲 |
| `startServer(port, bindIP, ...)` | 启动 HTTP 服务器 |
| `stopServer()` | 停止服务器 |
| `getAccessLogs()` | 获取访问日志 |
| `clearAccessLogs()` | 清空访问日志 |

### 5.6 平台导入 API

三个平台的 API 结构对齐，均支持：登录态查询、二维码登录、多账号管理、歌单列表、曲目获取、单首导入、试听预览、下载进度事件。

| 平台 | 命名空间 | 特色方法 |
|------|----------|----------|
| 网易云音乐 | `neteaseAPI` | `qrKey/qrCreate/qrCheck`、`cookieLogin` |
| 酷狗音乐 | `kugouAPI` | `captchaSent/loginCellphone`（手机号验证码） |
| 汽水音乐 | `qishuiAPI` | `oneclickLogin`、`fileLogin`（凭证文件） |

### 5.7 freeMusicAPI — 免费听音乐

| 方法 | 说明 |
|------|------|
| `checkDisclaimer()` | 检查免责声明是否已接受 |
| `acceptDisclaimer()` | 接受免责声明 |
| `status()` | 检查 music-dl 服务状态 |
| `search(keyword, sources, page, type)` | 搜索歌曲/歌单 |
| `streamUrl(song)` | 获取流式播放 URL |
| `switchSource(song)` | 换源（多源并行搜索 + 可播放性验证） |
| `lyric(song)` | 获取歌词 |
| `saveToLibrary(song, lrcText)` | 保存到本地歌库 |

### 5.8 其他 API

| 命名空间 | 职责 |
|----------|------|
| `windowAPI` | 窗口最小化、最大化、关闭、退出 |
| `stateAPI` | 桌面端播放状态推送（供移动端查询） |
| `lyricReceiver` | 桌面歌词窗口接收更新 |

---

## 六、数据来源说明

### 6.1 音乐内容来源

| 来源 | 获取方式 | 说明 |
|------|----------|------|
| 汽水音乐 | track_v2 API（含签名请求） | 会员歌曲需 bdms 签名头，回退链获取试听片段 |
| 网易云音乐 | 内嵌 NeteaseCloudMusicApi | 开源 API 服务，本地运行 |
| 酷狗音乐 | 内嵌 kugoumusicapi | 开源 API 库，本地运行 |
| 多平台分享链接 | parsers/ 注册中心 | 支持汽水/网易云/QQ/酷我/咪咕/B站/5sing等 |
| 免费听音乐 | music-dl 本地服务 | 第三方引擎，仅监听 127.0.0.1 |

### 6.2 歌词数据来源

歌词获取采用多级回退策略：

1. **trackPayload 内嵌**：解析分享链接时 track_v2 响应中可能直接包含歌词数据
2. **music.douyin.com SSR 接口**：汽水音乐的 SSR 接口返回 `audioWithLyricsOption` 字段，提取器处理新版根级结构
3. **HTML 页面解析**：从分享链接的 HTML 页面中解析歌词数据
4. **KRC 逐字格式**：优先使用 KRC 格式（`lyrics_krc.json`），支持逐字时间戳

### 6.3 封面数据来源

- 分享链接解析时从 API 响应获取封面 URL
- 本地歌曲从 `output/<folder>/cover.{jpg,jpeg,png,webp}` 读取
- 试听模式下 `coverUnify` 开启时封面统一锁定，换源不更新封面

---

## 七、安装与运行

### 7.1 环境要求

- Node.js >= 18
- npm >= 9
- Windows 10 及以上版本（当前版本主要面向 Windows 平台）

### 7.2 安装依赖

```bash
npm install
```

安装完成后会自动执行 `scripts/patch-kugoumusicapi.js` 对酷狗音乐 API 依赖进行补丁处理。

### 7.3 开发模式

```bash
# 仅启动桌面端
npm start

# 同时启动桌面端与移动端（Vite 热更新）
npm run dev:all
```

开发模式下，移动端 UI 在 `http://localhost:5174/` 启动 Vite dev server，支持文件修改热更新。桌面端代码修改需重启 Electron 进程。

`dev:all` 脚本（`scripts/dev.js`）会同时启动 Electron 后端和 Vite 前端热更新服务器，无需频繁构建。

### 7.4 构建打包

```bash
npm run build
```

使用 electron-builder 构建 Windows NSIS 安装包，输出目录为 `dist/`。构建配置详见 `package.json` 中的 `build` 字段。

**asarUnpack 配置**：`parsers/qishui-decrypt/native/**` 需要解包到 `app.asar.unpacked`，因为 Node.js 无法从 asar 内加载原生 `.node` 模块。

### 7.5 移动端单独构建

```bash
npm run build:mobile
```

将移动端 Vue 项目构建为静态文件，输出至 `mobile_UI/dist/`。

### 7.6 构建脚本一览

| 脚本 | 说明 |
|------|------|
| `npm start` | 启动 Electron 桌面端 |
| `npm run dev` | 仅启动移动端 Vite dev server |
| `npm run dev:all` | 同时启动桌面端 + 移动端（推荐开发使用） |
| `npm run build` | 构建 Windows NSIS 安装包 |
| `npm run build:dir` | 构建免安装目录版（调试用） |
| `npm run build:mobile` | 构建移动端静态文件 |
| `npm run build:full` | 构建移动端 + 启动桌面端 |

---

## 八、目录结构

```
SQET/
├── main.js                       主进程入口
├── preload.js                    上下文桥接（IPC API 暴露）
├── package.json                  项目元数据与构建配置
├── music-dl.exe                  免费听音乐专区 Web 服务
├── core/                         基础层
│   ├── logger.js                 日志（过滤 GIN 噪音）
│   ├── state.js                  共享状态
│   ├── storage.js                配置目录持久化（userdata / play_failed / duration_cache）
│   └── network.js                网络工具（sanitizeFileName 等）
├── audio/                        音频层
│   ├── scanner.js                文件扫描（worker_threads）
│   ├── duration.js               AAC ADTS 帧时长解析 + FLAC VORBIS_COMMENT 读取
│   └── verify.js                 文件完整性校验
├── soda/                         Soda 音频解密
│   └── decrypt.js                AES-CTR + MP4 box 原语
├── cover/
│   └── color.js                  封面主色调提取（13 桶 HSL 分色）
├── window/                       窗口管理
│   ├── main-window.js            主窗口
│   └── desktop-lyric.js          桌面歌词窗口（skipTaskbar + 锁定态交互）
├── download/
│   └── index.js                  在线解析下载
├── repair/
│   └── index.js                  损坏歌曲扫描与修复 + 播放失败记录管理
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
│   └── ipc.js                    IPC 处理（含试听缓存复用）
├── netease/                      网易云音乐
│   ├── config.js                 配置
│   └── ipc.js                    IPC 处理
├── server/
│   ├── index.js                  本地 HTTP 服务器（歌单分享 + accessKey 校验）
│   └── scanner-worker.js         文件扫描 Worker 线程
├── playlist/
│   └── share.js                  wuu:// 协议编码/解码与分享管理
├── parsers/                      多平台解析器
│   ├── base.js                   基类
│   ├── index.js                  注册中心
│   ├── algorithms/               算法（歌词格式、来源识别）
│   ├── auth/                     鉴权（Cookie 管理）
│   ├── platforms/                各平台解析实现
│   └── qishui-decrypt/           汽水音乐解密
│       ├── track-download.js     音频下载与解密（含签名请求）
│       ├── bdms-signer.js        客户端签名模块加载与签名生成
│       ├── track-decryptor.js    解密器实现
│       ├── decrypt-utils.js      解密工具函数
│       └── qishui-auth.js        认证配置
├── renderer/                     渲染层
│   ├── index.html                主界面
│   ├── style.css                 全局样式入口
│   ├── styles/                   各功能样式表
│   ├── fragments/                HTML 片段（footer/modals/settings 等）
│   └── modules/                  前端模块（含 audio-fx.js 音效系统）
├── mobile_UI/                    移动端 Web UI（Vue 3 + Vite）
│   ├── src/
│   ├── package.json
│   └── vite.config.js
├── scripts/
│   ├── dev.js                    开发模式启动脚本（dev:all）
│   └── patch-kugoumusicapi.js    依赖补丁脚本
└── tools/
    └── netease-api/              内嵌 NeteaseCloudMusicApi
```

---

## 九、项目状态与路线规划

### 9.1 当前状态

| 模块 | 状态 | 说明 |
|------|------|------|
| 本地音乐管理 | 稳定 | 核心功能已完成，支持多格式扫描与播放 |
| Web Audio 音效 | 稳定 | 9 预设 + 10 段自定义 EQ + 方案保存 |
| 桌面端渲染层 | 稳定 | 基于原生 HTML/CSS/JavaScript 实现，计划逐步重构为 Vue 3 |
| 音频解密 | 稳定 | Soda 格式（AES-CTR）解密已实现 |
| 播放失败处理 | 稳定 | 自动跳转 + 上报修复中心 + 删除/修复闭环 |
| 桌面歌词 | 稳定 | 锁定态交互 + skipTaskbar + 跑马灯 |
| 多平台歌单导入 | 稳定 | 网易云、酷狗、汽水三平台支持 |
| 在线解析下载 | 维护中 | 依赖第三方平台接口，需持续跟进接口变更 |
| 歌词系统 | 稳定 | 逐字歌词解析，多级回退获取策略 |
| 歌单分享 | 稳定 | wuu:// 加密协议 + HTTP 服务器 + 访问控制 |
| 移动端 Web UI | 开发中 | Vue 3 + Vite 实现，为网页应用移植，未发布原生应用 |
| 整体性能 | 待优化 | 大规模歌单渲染、启动速度等模块存在优化空间 |

### 9.2 路线规划

**短期目标：**

- 渲染层框架迁移：将桌面端原生 HTML 渲染层逐步重构为 Vue 3 组件化架构，提升可维护性与组件复用性
- 性能优化：大规模歌单渲染采用虚拟滚动与分页加载；歌曲扫描引入增量扫描机制；音频缓冲与预加载策略优化
- 移动端完善：补充功能模块，优化移动端交互体验

**中长期目标：**

- TypeScript 迁移：考虑使用 TypeScript 优化类型安全与开发体验（注：TypeScript 不优化运行时性能，主要提升可维护性）
- 数据存储优化：当歌库规模增长到 JSON 性能瓶颈时，考虑迁移到 SQLite（sql.js 已集成）
- 原生移动应用：基于 Tauri 或 React Native 构建真正的跨平台原生移动应用
- 云同步能力：支持歌单与收藏的端到端加密云端同步
- 插件系统：支持第三方解析器以插件形式动态加载，无需修改核心代码
- 更多平台支持：持续跟进新音乐平台的解析与导入能力

---

## 十、关于移动端

当前仓库中 `mobile_UI/` 目录包含的是基于 Vue 3 + Vite 构建的移动端 Web UI，可通过浏览器访问。

需要说明的是：

- 当前移动端为网页应用移植，并非原生移动应用
- 未发布至 App Store、Google Play 等应用商店
- 可作为 PWA（渐进式 Web 应用）安装至移动设备主屏
- 集成 MediaSession API，安卓锁屏/通知栏可显示媒体控制
- 播放状态与桌面端实时同步（歌曲、进度、播放状态）
- 未来计划基于 Tauri 或 React Native 构建真正的原生移动应用

---

## 十一、核心资产

### 11.1 自研技术模块

| 模块 | 技术描述 |
|------|----------|
| Web Audio 音效链 | 基于 BiquadFilter（highpass/peaking/lowshelf/highshelf）+ ChannelSplitter/Merger（M/S 加宽）+ StereoPanner + OscillatorNode（LFO）+ Convolver（程序生成 IR）构建的完整效果链 |
| Soda 音频解密 | 基于 AES-CTR 加密模式与 MP4 ISO Base Media File Format box 结构原语自主实现的解密算法，支持从加密的 M4A 容器中还原原始音频流 |
| music:// 协议 | 基于 Electron protocol.registerStreamProtocol 实现的自定义文件流协议，绕过 Chromium file:/// 协议的 MAX_PATH 260 限制，支持 HTTP Range 请求 |
| wuu:// 协议 | 歌单分享加密协议，采用 AES-256-GCM 对地址与端口进行加密，辅以 XOR 偏移与字母混淆，密钥与链接分离传输 |
| 封面色彩提取 | 从封面图片像素数据中按 HSL 色相分 13 桶提取主色调，排除低占比颜色干扰，用于播放器界面自适应配色 |
| 桌面歌词窗口 | 基于 BrowserWindow 的独立透明窗口，通过 setIgnoreMouseEvents 实现锁定状态下的鼠标穿透，悬停按钮区临时恢复交互，窗口位置持久化至配置文件 |
| 播放失败修复链 | 播放器解码失败自动跳转 + IPC 上报 + play_failed.json 持久化 + 修复中心扫描合并 + 修复/删除自动清除记录的完整闭环 |
| Worker 扫描线程 | 基于 Node.js worker_threads 的文件扫描线程，避免大规模文件系统操作阻塞 Electron 主进程 |
| 签名请求机制 | 通过加载客户端原生签名模块生成 X-Helios/X-Medusa 签名头，恢复会员音质获取能力 |

### 11.2 集成开源项目

| 项目 | 用途 | 许可证 |
|------|------|--------|
| [Electron](https://github.com/electron/electron) | 跨平台桌面应用运行时框架 | MIT |
| [Vue 3](https://github.com/vuejs/core) | 渐进式 JavaScript 框架（移动端 UI） | MIT |
| [Vite](https://github.com/vitejs/vite) | 前端构建工具（移动端） | MIT |
| [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) | 网易云音乐 API 服务 | MIT |
| [kugoumusicapi](https://github.com/MacroJson/kugoumusicapi) | 酷狗音乐 API 库 | MIT |
| [jpeg-js](https://github.com/eugeneware/jpeg-js) | JPEG 图像解码（封面处理） | BSD-3-Clause |
| [sql.js](https://github.com/sql-js/sql.js) | SQLite WASM 编译版（设置持久化） | MIT |
| [music-dl](https://github.com/guaguaguaxia/music-dl) | 多平台音乐搜索与下载引擎 | MIT |

---

## 十二、法律与免责声明

> 请仔细阅读以下内容。使用本软件即表示您同意本免责声明的全部条款。

### 12.1 合规使用

本软件及其源代码采用 Apache License 2.0 开源许可发布，允许在符合许可证条款的前提下进行商业性再利用与分发。但软件的实际使用（包括但不限于通过本软件访问第三方音乐平台服务）应仅限于个人学习、研究和技术交流目的，不得用于任何违反相关法律法规或第三方服务协议的商业用途。请严格遵守您所在国家或地区以及相关音乐平台的法律法规、用户协议与服务条款。因使用本软件产生的任何法律责任由使用者自行承担。

### 12.2 版权归属

软件中涉及的所有音乐、歌词、封面、视频及其他数字内容，其著作权及相关权益均归原始权利人所有。软件不对任何内容主张版权，也不存储、缓存或分发任何受版权保护的内容。用户通过本软件访问的第三方服务，其内容与版权状态由对应平台负责。

### 12.3 第三方服务

软件集成了多个第三方平台的服务接口与开源项目（包括但不限于网易云音乐、酷狗音乐、汽水音乐、QQ 音乐、酷我音乐、咪咕音乐、Bilibili、5sing、千千音乐、Jamendo、JOOX、Apple Music，以及 NeteaseCloudMusicApi、kugoumusicapi、music-dl 等开源项目）。软件与上述第三方无任何合作关系、关联关系或授权关系，不对第三方服务的可用性、稳定性、内容合法性承担责任。如第三方服务条款禁止此类访问方式，请停止使用相关功能。

### 12.4 解密与逆向

软件中的 Soda 音频解密、汽水音乐解密等模块仅用于学习加密算法与音频格式研究，不得用于绕过数字版权管理（DRM）或规避技术保护措施。若相关行为违反您所在地区的法律（例如《中华人民共和国著作权法》、美国 DMCA 等适用法律法规），请勿使用相关功能。

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

本项目基于 Apache License 2.0 开源，详见仓库根目录 LICENSE 文件。

---

## 十四、协同开发

欢迎任何形式的贡献。以下为参与方式说明：

### 14.1 贡献方式

- **问题反馈**：遇到 Bug 或功能异常，请提交 Issue 并附上复现步骤、操作系统版本与应用日志
- **功能建议**：有新功能需求或改进建议，欢迎提交 Issue 进行讨论
- **代码贡献**：提交 Pull Request，请确保代码风格与现有代码一致
- **文档完善**：帮助改进文档内容与使用说明
- **平台适配**：协助跟进新音乐平台的接口变更与解析适配

### 14.2 开发流程

1. Fork 本仓库至个人账号
2. 基于 main 分支创建特性分支：`git checkout -b feature/your-feature`
3. 提交更改，遵循 Conventional Commits 规范：`git commit -m "feat: 简要描述"`
4. 推送至远程分支：`git push origin feature/your-feature`
5. 提交 Pull Request 并描述变更内容与动机

### 14.3 代码规范

- 遵循现有文件的代码风格与命名习惯
- 新增功能需添加必要的代码注释
- 不引入非必要的第三方依赖
- 对关键逻辑路径进行适当的错误处理

---

## 十五、作者

本项目由 Wuu Music Team 维护。

---

## 附录：配置与数据文件

| 路径 | 说明 |
|------|------|
| `config/userdata.json` | 用户数据（喜欢列表、不推荐列表、歌单、播放统计、播放进度、应用设置含音效配置） |
| `config/play_failed.json` | 播放失败记录（修复中心扫描合并用） |
| `config/duration_cache.json` | 音频时长缓存（避免重复解析 AAC ADTS 帧） |
| `config/free_music.json` | 免费听音乐专区数据（含免责声明接受状态） |
| `config/kugou_config.json` | 酷狗音乐多账号配置 |
| `config/qishui_config.json` | 汽水音乐多账号配置 |
| `config/qishui_device.json` | 汽水音乐签名设备 ID 持久化 |
| `config/shared/` | 已分享的歌单数据（含 accessKey） |
| `output/` | 下载的歌曲目录（按"歌曲名 - 艺人"结构组织） |
| `data/settings.db` | 设置数据库（SQLite） |
