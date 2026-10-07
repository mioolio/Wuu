# Wuu Music

一个基于 Electron 构建的本地音乐管理与播放应用，集成多平台歌单导入、在线解析、音频解密、Web Audio 音效系统、损坏文件自动修复、桌面歌词与加密歌单分享等能力。

<p align="center">
  <img src="https://img.shields.io/badge/Electron-2B2E4A?style=for-the-badge&logo=electron&logoColor=9FEAF9" alt="Electron" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/React_19-149ECA?style=for-the-badge&logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
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

桌面默认界面使用 React 19 + TypeScript + Vite + Zustand，设置中的 `interfaceMode` 可切换到 `renderer/` 经典界面；两套桌面资源均随安装包分发。手机端使用 Vue 3。主进程、IPC 接口与本地歌曲目录保持兼容；迁移范围、Git 备份及恢复方式见 [React 桌面迁移说明](docs/REACT_MIGRATION.md)。

具体模块、调用链、文件格式、音频算法、HTTP / WebSocket 协议和实现边界见 [技术架构与实现详解](docs/TECHNICAL_ARCHITECTURE.md)。该文档以仓库源码为依据，适合开发、排障和审查技术实现。

桌面 UI 采用炭黑、暖白与浅绿色的统一视觉体系，重新编排推荐首页、分组导航、音乐列表和沉浸式播放器。视觉规范和窗口验证方式见 [桌面设计说明](docs/UI_DESIGN.md)。

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
- 桌面 `get-songs` IPC 使用同步基础目录扫描，先返回可播放列表，再逐首补齐时长和流派；HTTP 歌库扫描由 `worker_threads` 执行并缓存 10 分钟
- AAC ADTS 小文件完整遍历，大文件按前 / 中 / 后采样估算；FLAC 从 STREAMINFO 读取总采样数，MP3 按 MPEG 帧累加样本数
- 播放进度每 2 秒持久化至本地，重启后恢复播放位置

### 2.2 Web Audio 音效系统

基于浏览器原生 Web Audio API 构建的专业级音效处理链，无需第三方音频库即可实现实时音频处理：

**效果链路**：

```
mediaSource → stereoInput(单声道上混) → highpass → 10段peaking EQ
            → lowshelf(90Hz) → highshelf(12kHz) → M/S立体声加宽
            → StereoPanner ┬→ gainNode → destination
                          └→ Convolver(混响) → wetGain → gainNode
```

**9 个内置预设**：

| 预设 | 实现原理 |
|------|----------|
| 关闭 | HP 20Hz / EQ 与 shelf 增益 0dB / 宽度 1 / 湿度 0；滤波与空间节点仍保持连接 |
| 超重低音 | lowshelf +7dB @ 90Hz + 31/62Hz peaking 增益 |
| 清澈人声 | highpass 120Hz + 2/4kHz EQ 各 +3dB + 立体声宽度 1.1 |
| 360度环绕 | M/S 宽度 2 + LFO 0.08Hz、深度 0.28 + 混响湿度 0.08 |
| 3D音效 | 高频 shelf +2dB + 宽度 1.7 + LFO 0.05Hz、深度 0.12 + 混响湿度 0.12 |
| HIFI现场 | 程序生成 1.9s 噪声 IR，振幅按 `(1-i/length)^2.6` 衰减；湿度 0.18、宽度 1.3 |
| 动感电音 | lowshelf +5dB + 高频 8-16kHz 大幅增益 |
| 摇滚音效 | 中频下凹 + 高低频提升 + 宽度 1.15 |
| 复古唱片 | highpass 120Hz + 高频 shelf -3dB + 16kHz EQ -8dB + 低架 +2dB |

**自定义 EQ**：

- 10 段 peaking 滤波器，中心频率：31 / 62 / 125 / 250 / 500 / 1k / 2k / 4k / 8k / 16k Hz
- 每段增益 -12 ~ +12 dB、中心频率 20 ~ 20000Hz、Q 值 0.1 ~ 6 可调；实时 `setTargetAtTime` 平滑过渡
- 可调高通、低 / 高架增益、立体声宽度、LFO 深度 / 速率与混响湿度；具体预设参数见 `desktop_UI/src/services/audioFx.ts`
- 支持命名保存多个自定义方案，持久化到 `userdata.json` 的 `settings.audioFx` 字段

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
- KRC 逐字歌词通过 `requestAnimationFrame` 按浏览器显示帧更新每个字的填充状态（帧率取决于设备与窗口状态）
- 桌面歌词窗口：独立 BrowserWindow，支持锁定穿透（click-through）、拖拽定位、位置持久化
- 悬浮窗只显示歌词；锁定与开关由软件底栏和歌词设置控制，下一句连续上移到当前句位置
- 播放倍速在新版「设置 → 播放」调整，支持 0.5×–2×，保存偏好并同步歌词；旧版共用倍速设置
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

- 播放器监听持久媒体元素的 `error` 事件（MEDIA_ERR_NETWORK / DECODE / SRC_NOT_SUPPORTED）
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
- AES-256-GCM 加密 `{id, k, h}`（歌单 ID、访问令牌、主机），端口字段独立字母混淆；密钥与链接分离传输
- 密钥可导出为本地 `.crt` 文件；其内容是自定义 `WUU KEY` 文本封装，不是 X.509 证书

**HTTP 路由**：

| 路由 | 方法 | 说明 | 访问计数 |
|------|------|------|----------|
| `/playlist/:id?k=<accessKey>` | GET | 获取歌单 JSON（明文，但需正确 accessKey） | 递增 usedCount |
| `/stream/:id/:songIndex?k=<accessKey>` | GET | 流式返回音频，支持 Range 请求 | 不递增 |
| `/cover/:id/:songIndex?k=<accessKey>` | GET | 返回封面图片 | 不递增 |
| `/lyric/:id/:songIndex?k=<accessKey>` | GET | 返回歌词文本 | 不递增 |

访问计数说明：`/stream`、`/cover`、`/lyric` 属于同一访问会话内的子请求，不单独递增 `usedCount`，仅 `/playlist` 路由每次访问算 1 次。

### 2.9 免费听音乐专区

集成 `music-dl` 本地 Web 服务（IPC 通过 `127.0.0.1:17324` 访问，实际监听地址由二进制实现决定），提供多平台音乐搜索、试听、下载、歌词获取与换源能力。该功能设有免责声明，用户需明确接受后方可使用。

服务管理特性：

- 子进程以 `windowsHide: true` 模式启动，无可见窗口
- 过滤 GIN 请求日志，仅保留关键事件与严重错误
- 应用退出时自动终止子进程，避免残留
- 试听缓存复用：保存到本地歌库时，若试听已下载解密到临时文件，直接复用免二次下载

### 2.10 移动端同步与 MediaSession

移动端 Web UI 基于 Vue 3 + Vite 5 实现，通过浏览器访问桌面端 HTTP 服务读取歌库、收藏、歌词及播放状态：

- 手机采用纸白 / 石墨黑两套主题，默认跟随系统，设置 → 外观可单独选择并保存；系统配色变化即时生效
- 圆角方形封面、独立主播放控制、播放 / 音乐库 / 歌单 / 设置导航；浏览其他页面时保留迷你播放器
- 封面左滑进入歌词，歌词右滑返回，顶部不放重复切换按钮；进度滑杆支持触摸和键盘，歌词字号与高级音效集中在设置
- 首次进入读取桌面歌曲、进度和播放状态，音频元数据就绪后定位，播放由用户手势触发；不是持续轮询镜像
- 手机进度每 3 秒检查一次，位置变化至少 5 秒时上报，播放结束补报最终位置
- MediaSession API：安卓锁屏/通知栏/状态栏显示封面 + 歌名 + 上一首/下一首控制
- 声明支持的操作：play、pause、previoustrack、nexttrack、seekto、stop
- `updateMediaPositionState()` 支持系统进度条拖动同步
- 播放/暂停/停止时立即更新 MediaSession 状态，timeupdate 期间持续更新位置

手机端还提供独立 Web Audio 音效链（`mobile_UI/src/composables/useAudioFx.js`）：10 段 EQ、9 个预设、M/S 节点、可选 StereoPanner / LFO 与 1.2 秒噪声混响 IR。自定义 EQ 的增益 / 频率 / Q 及空间参数保存到浏览器 `localStorage` 的 `audio-fx-custom`，预设选择保存为 `audio-fx-preset`；通过 `/api/audio-fx-presets` 读取桌面命名方案供选择，两端当前预设各自独立。AudioContext 在播放事件中恢复，以适应移动浏览器的用户手势限制。

### 2.11 移动端一起听

在手机「设置 → 一起听」开启「与电脑一起听」，跟随电脑当前歌曲、进度和倍速；手机与电脑均可播放、暂停、切歌和调节进度。默认关闭，退出或关闭后不暂停电脑，手机恢复独立播放。电脑需要在「设置 → 网络服务」开启手机访问。浏览器限制自动播放时，手机显示「加入播放」按钮；断线重连后重新读取电脑状态。

`server/index.js` 的单个房间以实际桌面播放器为主持：手机通过 `/ws/together` 传操作，主进程验证歌曲与当前主窗口身份后经 IPC 控制新版或经典版播放器；桌面实际状态完成后再发布给手机。音频由各端经 HTTP 独立读取与播放，同步控制和时间位置。具体消息格式及访问边界见 [技术架构与实现详解](docs/TECHNICAL_ARCHITECTURE.md)。

### 2.12 新曲发现与试听保存

首页 `HomeDiscovery.tsx` 每批展示 4 首来自网易云公开歌单的候选歌曲，由 `netease-discover` IPC 获取。`services/discovery.ts` 对曲名和艺人执行 Unicode NFKC、大小写与标点归一化，并按平台曲目 ID 或“曲名 + 艺人交集”排除本地已有歌曲；未知艺人的本地歌曲按曲名排除。会话保存最多 2000 首候选历史，候选池有效期 5 分钟，每次请求最多尝试 4 个候选批次，默认超时预算 16 秒。

试听通过网易云标准音质 preview 接口懒加载当前批次队列。保存前重新检查音频可用性与歌库去重；仅试听片段或需重新登录的结果不进入完整歌曲导入，成功后刷新本地歌库。该候选来源和去重算法不推断全网曲库覆盖或个性化推荐模型。

### 2.13 聆听记录、曲风标签与统计

- `services/listeningHistory.ts` 将累计播放次数 / 聆听秒数和按本地日历日期索引的 `recentDays` 写入用户数据；近期记录保留 90 天，跨午夜的实际聆听区间拆分到相应日期，旧累计值继续兼容
- `audio/genres.js` 使用 `music-metadata.parseFile({skipCovers:true,duration:false})` 读取内嵌曲风；内存缓存以文件路径、修改时间和大小校验，经 `song-metadata-update` 后台补齐桌面列表
- `genreOverrides` 按音频路径保存用户手动曲风标签，优先于内嵌标签；可清空手动标签或恢复音频标签
- 统计页显示累计时长、播放次数、收藏数和歌库数量；歌曲排行可按次数 / 时长排序，每次展示 50 首并继续加载
- 近 7 / 30 天曲风分布按已记录的聆听时长计算，多标签歌曲平均分配时长，“未标注”计入分母，显示标签覆盖率。`statsSnapshot.ts` 与 `useStatsSnapshot.ts` 将统计页面更新限定到可见期间及相关状态变化

### 2.14 歌库组织与播放控制

桌面歌库支持歌名 / 艺人 / 专辑文本搜索、按艺人折叠分组和组合艺人拆分，多收藏歌单创建 / 重命名 / 删除、喜欢与不推荐记录，以及单首 / 批量分享。`LibraryView.tsx` 使用 `useDeferredValue` 延后筛选，结合固定行高虚拟列表控制大歌库 DOM 数量。

持久播放器支持顺序、单曲循环与随机队列、按播放历史前进 / 后退、在线试听队列、进度恢复、音量和 500ms 渐出暂停。桌面随机队列按当前会话的播放范围逐轮覆盖，重选当前歌曲不丢掉未播项，播放次数不参与随机权重。设置还包括现代 / 经典界面切换、歌词字号与色彩、窗口 / 托盘行为、网络服务绑定 IP / 端口 / 白名单 / 频率限制等；具体字段与跨界面加载路径见 [技术架构与实现详解](docs/TECHNICAL_ARCHITECTURE.md)。

---

## 三、技术架构

### 3.1 技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 运行时 | Electron 33 | 桌面应用运行时；开发与构建使用 Node.js 20.19+ 或 22.12+ |
| 主进程 | JavaScript (CommonJS) | 业务逻辑、IPC 处理、文件系统操作 |
| 桌面界面 | React 19 + TypeScript 5.9 + Vite 7；经典 HTML / JS 界面 | 默认 `desktop_UI/dist`，`interfaceMode=classic` 加载 `renderer/`；两者打包 |
| 桌面状态管理 | Zustand 5 | 歌曲、收藏、设置、播放状态与本地数据持久化 |
| 移动端 | Vue 3 + Vite 5 | 移动端 Web UI，非原生移动应用 |
| 音频处理 | Web Audio API | 原生 BiquadFilter / Convolver / StereoPanner / GainNode |
| 构建与验证 | Vite + electron-builder 25 + Vitest + Playwright | 两端静态资源、Windows NSIS 安装包、单元测试与 Electron smoke 测试 |
| 加密 | AES-CTR / AES-256-GCM | 音频解密与歌单分享加密 |
| 数据持久化 | JSON 文件与内存缓存 | userdata.json 采用临时文件替换；时长 / 失败记录独立 JSON，流派缓存为内存 Map |
| 实时通信 | Node.js `ws` + 浏览器 WebSocket | 手机端一起听操作广播、房间快照、host 校准 |
| 外部 Cookie 数据库读取 | sql.js（SQLite WASM） | 读取汽水客户端 Cookies；不用于用户设置持久化 |

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

`main.js` 在 `app.whenReady()` 前注册 `music` 的 `stream / supportFetchAPI / bypassCSP / corsEnabled` 特权，再通过 `protocol.handle('music', handler)` 返回 `Response(Buffer)`。文件读取走 Node.js `fs.promises`。实现目的和行为：

- 绕过 Chromium `file:///` 协议在 Windows 平台的 MAX_PATH 260 字符路径长度限制
- 无 Range 时异步读取整个文件；单段 `bytes=start-end` 请求只读取所需区间，返回 206、`Content-Range` 与 `Accept-Ranges`，越界返回 416
- MIME 类型根据文件扩展名自动映射
- 当前 Range 正则处理单段区间；后缀范围 `bytes=-N` 未按末尾 N 字节实现，多段范围未实现 multipart，因此不能视为完整 RFC Range 实现。全文件响应占用与文件大小相关的内存

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
| d | `{id,k,h}` 的 AES-256-GCM 密文封装 `{iv,ct,tag}`，密文额外与 IV 循环 XOR |
| p | 端口混淆（格式头 + 十六进制字母映射），未加密且不受 GCM tag 认证 |

实现边界：AES 密钥由 `SHA-256(用户密钥)` 派生，使用 12 字节随机 IV；仅 `d` 内的 `{id,k,h}` 受 GCM 认证，外层版本、地址类型与端口没有作为 AAD 绑定。接收方用独立获取的 Wuu 密钥解出 `accessKey`，再通过 `http://<host>:<port>/playlist/<id>?k=<accessKey>` 拉取明文歌单。链接加密不等于 HTTP 传输加密。`.crt` v2 使用 `BEGIN WUU KEY` / `END WUU KEY` 标记，`Key / Link / Name` 为 Base64 文本，读取兼容旧版二进制封装。

### 3.4 渲染层架构

桌面界面由 React 组件与 TypeScript 服务组成。Zustand 集中管理业务状态，`api.ts` 封装 preload 暴露的 IPC 接口及独立事件取消订阅。播放器持有一个持续存在的媒体元素，音频节点和播放队列独立于页面组件生命周期，切换页面时继续播放。

```
desktop_UI/
  ├── index.html              Vite 挂载入口
  ├── src/
  │   ├── main.tsx            主界面 / 桌面歌词窗口入口
  │   ├── App.tsx             应用布局、导航与页面管理
  │   ├── store.ts            Zustand 状态与 userdata.json 持久化
  │   ├── types.ts            共享类型
  │   ├── api.ts              IPC 桥接与媒体地址处理
  │   ├── ui.ts               通知、确认与输入弹窗
  │   ├── components/         播放栏、歌词、桌面歌词、音效与通用组件
  │   ├── features/           歌库、导入、在线音乐、分享、修复、统计、设置
  │   ├── services/
  │   │   ├── player.ts       持久播放器、队列、进度与桌面状态同步
  │   │   ├── audioFx.ts      9 个预设、10 段 EQ 与自定义方案
  │   │   ├── lyrics.ts       行级 / 逐字歌词解析
  │   │   ├── discovery.ts    新曲候选去重、试听队列与保存
  │   │   ├── listeningHistory.ts  累计 / 近期聆听记录
  │   │   └── listeningStyles.ts   曲风标签与时长分布统计
  │   └── styles.css          全局样式
  ├── vite.config.ts          桌面开发端口 5173，构建输出 dist/
  ├── tsconfig.json           TypeScript 严格检查
  └── package.json
```

主窗口与桌面歌词窗口通过 `window/renderer-entry.js` 选择入口。默认 `modern` 模式加载同一套 React 构建产物；未打包且设置 `WUU_RENDERER_URL` 时使用 Vite。`classic` 模式加载 `renderer/index.html` 或 `renderer/desktop-lyric.html`，开发时也直接加载这些文件。`package.json` 同时包含两套资源。

`LibraryView.tsx` 已实现 64px 固定行高的虚拟列表，按视口上下各扩展 5 行，只渲染当前切片。`store.ts` 并行请求歌曲与用户数据，用户数据等待期间也可先发布基础歌曲；播放器在初始化时绑定事件，后台流派更新批量合并，时长通过 IPC 后补。这些是现有实现，并非待开发的路线目标。

桌面端通过 Electron IPC 访问本地业务，手机端通过 HTTP API 访问服务。两端使用不同组件框架，可共享与界面无关的类型、协议和纯逻辑；React 与 Vue 组件分别维护。

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
  │   │   ├── usePlayer.js   播放器组合式函数（含 MediaSession 集成）
  │   │   ├── useAudioFx.js  手机独立 EQ / 空间音效与桌面命名方案读取
  │   │   └── useListenTogether.js  WebSocket 一起听、序号校验与进度校准
  │   └── styles/
  │       └── main.css       全局样式
  ├── vite.config.js         Vite 配置
  └── package.json
```

---

## 四、核心技术实现

### 4.1 Web Audio 音效链

音效系统在 `desktop_UI/src/services/audioFx.ts` 中实现，由 `AudioEffects` 类管理音频节点。`desktop_UI/src/services/player.ts` 在首次初始化 Web Audio 时，将效果链接入 `MediaElementAudioSourceNode` 与 `GainNode` 之间；React 音效面板位于 `desktop_UI/src/components/AudioFxPanel.tsx`。页面切换不会重建媒体源或音效链。

**关键技术点**：

- **M/S 立体声加宽**：先将单声道上混为两个通道，再计算 `M=(L+R)/2`、`S=(L−R)/2`，输出 `L'=M+wS`、`R'=M−wS`；宽度 1 时 M/S 部分恢复原左右声道。其他滤波节点仍在链中。
- **环绕声像摆动**：`StereoPanner` 节点配合低频 LFO（`OscillatorNode`，0.05-0.08Hz）实现声像缓慢左右摆动，模拟 360 度环绕效果。
- **程序生成混响 IR**：`AudioEffects` 构造函数生成双通道 1.9 秒均匀随机噪声，振幅按 `(1-i/length)^2.6` 衰减；干声直达输出、湿声经 Convolver 与 wetGain 叠加。它是程序生成 IR，并非特定场所的实测声学响应。
- **平滑参数过渡**：增益、频率、Q、宽度、LFO 与湿声参数使用 `setTargetAtTime(value, currentTime, 0.03)`，0.03 秒为指数趋近的时间常数，并非 30ms 内完成切换。
- **构建失败回退**：效果链构建异常时自动回退为 `mediaSource` 直连 `gainNode`，不影响基础播放。

### 4.2 播放失败修复链

播放失败从检测到修复的完整链路：

```
持久媒体元素 error 事件 (code=2/3/4)
  → services/player.ts: handleFailure / failCount (连续失败保护)
  → IPC report-play-failed → repair/index.js → config/play_failed.json
  → 自动跳下一首 (playerService.next)
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

1. JPG 优先由 `jpeg-js` 解码并采样到 48×48 RGBA；其他格式由 `nativeImage` 缩放，随后将 BGRA 转为 RGBA
2. 忽略 alpha <128 和亮度 `(max+min)/2` <8 或 >248 的像素
3. 饱和度 <0.1 进入灰度桶；其余进入 12 个各 30° 的色相桶，总计 13 桶
4. 每桶累加 RGB 并求平均，灰度桶将三个通道统一为平均灰值，消除偏色
5. `weight=count/有效像素总数`，按占比降序返回所有非空桶的 `{r,g,b,weight}`，供界面选择主色与生成渐变；没有亮度权重或低占比桶删除步骤

### 4.6 音频时长解析与后台补齐

`audio/duration.js` 的 `getAACDuration()` 是多格式解析入口，并非仅处理 AAC：

1. 优先按 `fLaC` 魔数识别 FLAC，从 STREAMINFO 提取 20 位采样率与 36 位总采样数，时长 = `totalSamples/sampleRate`；不只依赖文件扩展名
2. MP3 跳过 ID3v2 标签，按 MPEG 版本、Layer、比特率、采样率及 padding 计算帧长，累加各帧样本数
3. AAC ADTS 从同步字、采样率索引、13 位帧长识别帧；≤10MiB 文件完整遍历，按当前实现每帧 1024 样本计算
4. >10MiB AAC 读取前 / 中 / 后各 64KiB，用采样帧平均字节数估算整文件帧数；可变码率、非音频头尾数据或损坏帧会影响估算
5. 桌面基础扫描先使用 `info.json.duration`（毫秒转秒）和缓存；300ms 后启动后台解析，每首通过 `setImmediate` 让出事件循环，每 10 首及完成时写缓存，通过 `duration-update` 补齐界面。单首解析内部仍有同步读取，不是 Worker
6. React 播放器对本地歌曲优先使用有效 `realDuration`，再回退到浏览器解码时长；seek 还按解码时长限制边界，不采用“偏差 >30 秒才信任解析值”的规则

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

桌面通过 `preload.js` 的 `contextBridge` 与主进程通信，React 业务服务经 `api.ts` 封装 IPC 与事件取消订阅。主窗口与桌面歌词窗口配置 `contextIsolation: true`、`nodeIntegration: false`；主窗口还配置 `webSecurity: false`，相关访问边界见 [技术架构与实现详解](docs/TECHNICAL_ARCHITECTURE.md)。

### 5.1 musicAPI — 本地音乐管理

| 方法 | 说明 |
|------|------|
| `getSongs()` | 同步扫描 output/ 返回基础列表；时长 / 流派随后通过事件补齐 |
| `onDurationUpdate(cb)` | 订阅后台时长更新；返回取消订阅函数 |
| `onSongMetadataUpdate(cb)` | 订阅按 audioPath 标识的流派补齐；返回取消订阅函数 |
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
| `toggle(show, snapshot?)` | 显示/隐藏；新版打开附完整状态快照并等待本次 DOM 提交确认 |
| `lock(locked)` | 锁定/解锁（锁定后鼠标穿透） |
| `setInteractive(on)` | 锁定态临时恢复/恢复穿透（保留兼容 API，悬浮窗不再显示按钮） |
| `send(payload)` | 发送歌词数据与当前时间 |
| `setPosition(pos)` | 设置窗口位置（null = 居中） |
| `onBoundsSaved(cb)` | 监听窗口位置已保存事件 |
| `onClosed(cb)` | 监听兼容的关闭通知 |

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
| 网易云音乐 | `neteaseAPI` | `qrKey/qrCreate/qrCheck`、`cookieLogin`、`discover`（公开歌单候选） |
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
| 免费听音乐 | music-dl 本地服务 | 第三方引擎，IPC 通过 127.0.0.1:17324 访问 |

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

- Node.js 20.19+ 或 22.12+（Vite 7 的运行要求）
- npm >= 9
- Windows 10 及以上版本（当前版本主要面向 Windows 平台）

### 7.2 安装依赖

```bash
npm install

# 开发或构建手机端时安装其依赖
npm install --prefix mobile_UI
```

根目录安装完成后会自动执行 `scripts/patch-kugoumusicapi.js` 对酷狗音乐 API 依赖进行补丁处理。首次运行 `npm start`、`npm run dev` 或 `npm run build:desktop` 时，启动脚本会检查并自动安装 `desktop_UI/` 的依赖；也可提前执行 `npm install --prefix desktop_UI`。

### 7.3 开发模式

```bash
# 构建 React 桌面界面后启动 Electron
npm start

# 桌面端 React 热更新 + Electron
npm run dev

# 仅启动手机端 Vue 热更新服务器
npm run dev:mobile

# 同时启动桌面端、Electron 与手机端热更新服务器
npm run dev:all
```

桌面开发服务器位于 `http://127.0.0.1:5173/`，Electron 自动加载该地址；手机端开发服务器位于 `http://localhost:5174/`。两端界面修改均支持 Vite 热更新。修改 Electron 主进程或 preload 后，需要重启开发进程。

手机端开发服务器将 API 请求代理至 `http://127.0.0.1:30967`，使用同步、歌库等功能时需同时运行桌面端并在设置中开启网络服务。

### 7.4 构建打包

```bash
npm run build

# 免安装目录版
npm run build:dir
```

两个命令均先构建 `desktop_UI/dist/` 与 `mobile_UI/dist/`，再使用 electron-builder 生成 Windows NSIS 安装包或免安装目录版，输出目录为根目录 `dist/`。安装包同时纳入 React 构建产物和 `renderer/` 经典界面源码，运行时根据 `interfaceMode` 选择入口。构建配置详见 `package.json` 中的 `build` 字段。

**asarUnpack 配置**：`parsers/qishui-decrypt/native/**` 需要解包到 `app.asar.unpacked`，因为 Node.js 无法从 asar 内加载原生 `.node` 模块。

### 7.5 移动端单独构建

```bash
npm run build:mobile
```

将移动端 Vue 项目构建为静态文件，输出至 `mobile_UI/dist/`。

### 7.6 构建脚本一览

| 脚本 | 说明 |
|------|------|
| `npm start` | 构建 React 桌面界面后启动 Electron |
| `npm run dev` / `npm run dev:desktop` | React 桌面端热更新（5173）+ Electron |
| `npm run dev:mobile` | Vue 手机端热更新（5174） |
| `npm run dev:all` | 同时运行桌面端、Electron 与手机端热更新服务器 |
| `npm run build:desktop` | 检查 TypeScript 并构建 React 桌面资源 |
| `npm run build:mobile` | 构建移动端静态文件 |
| `npm run build:full` | 构建桌面、手机两端资源后启动 Electron |
| `npm run build` | 构建两端资源并生成 Windows NSIS 安装包 |
| `npm run build:dir` | 构建两端资源并生成免安装目录版 |
| `npm run typecheck` | 检查桌面 TypeScript 类型 |
| `npm test` | 依次运行桌面 Vitest、移动端测试、基础扫描 / 启动测试、一起听状态测试 |
| `npm run test:mobile` | 移动端单元测试 |
| `npm run test:scanner` | Node.js test runner 验证基础扫描与后台补齐 |
| `npm run test:together` | 离线回归生产房间消息处理、欢迎快照及客户端状态应用，使用模拟 socket |
| `npm run test:desktop-lyrics` | 真实窗口逐帧检查首色、上移换句、倍速同步、跳转清退及减少动态效果 |
| `npm run test:desktop` | 使用 fixture 运行 Playwright Electron smoke 测试 |
| `npm run test:startup` | 使用隔离 fixture 验证分阶段启动与早期播放 |
| `npm run test:mobile-ui` | 浏览器验证移动端歌词交互 |
| `npm run test:visual` | 桌面视觉验证与截图 |

### 7.7 验证桌面重构

```bash
npm run build:desktop
npm run typecheck
npm test
npm run test:desktop
```

Electron smoke 测试使用生成的音频、歌词及 fixture IPC 验证本地播放、页面切换、收藏编辑、音效、桌面歌词和网络设置。测试数据、独立 Electron 用户目录及截图位于 `.test-artifacts/`，歌曲与配置写入由 fixture 接管，不修改真实的 `output/` 或 `config/userdata.json`。这类测试不代表第三方账号真实登录、远程接口可用性或实际会员音质已经验证；这些功能需在对应账号与网络环境中单独测试。

---

## 八、目录结构

```
Wuu-main/
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
│   ├── scanner.js                桌面同步基础扫描 + 后台补齐调度
│   ├── duration.js               AAC / FLAC / MP3 时长解析 + FLAC VORBIS_COMMENT 读取
│   ├── genres.js                 music-metadata 标签流派读取、缓存与后台补齐
│   └── verify.js                 文件完整性校验
├── soda/                         Soda 音频解密
│   └── decrypt.js                AES-CTR + MP4 box 原语
├── cover/
│   └── color.js                  封面主色调提取（13 桶 HSL 分色）
├── window/                       窗口管理
│   ├── main-window.js            主窗口
│   ├── desktop-lyric.js          桌面歌词窗口（skipTaskbar + 锁定态交互）
│   └── renderer-entry.js         modern React / classic HTML 窗口入口选择
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
│   ├── scanner-worker.js         HTTP 歌库扫描 Worker 线程
│   └── together-state.js         一起听房间欢迎快照状态合并
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
├── desktop_UI/                   桌面界面（React 19 + TypeScript + Vite 7 + Zustand 5）
│   ├── src/                      组件、功能页、状态与播放器服务
│   ├── dist/                     生产桌面与歌词窗口构建产物
│   ├── package.json
│   └── vite.config.ts
├── renderer/                     可切换的经典桌面 / 歌词界面，同样纳入打包
├── mobile_UI/                    移动端 Web UI（Vue 3 + Vite）
│   ├── src/
│   ├── package.json
│   └── vite.config.js
├── scripts/
│   ├── desktop.js                桌面依赖检查、构建、启动与热更新
│   ├── dev.js                    桌面、手机联合开发（dev:all）
│   ├── build.js                  两端构建与 Electron 打包
│   ├── smoke-desktop.cjs         Playwright Electron 验证
│   ├── smoke-main.cjs            隔离 fixture 数据与 IPC
│   └── patch-kugoumusicapi.js     依赖补丁脚本
├── docs/
│   ├── TECHNICAL_ARCHITECTURE.md  技术模块、算法、协议与实现边界
│   ├── REACT_MIGRATION.md         迁移范围、Git 备份与恢复说明
│   └── UI_DESIGN.md               桌面视觉规范与验证方式
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
| 桌面端渲染层 | React 默认入口 | React 19 + TypeScript 5.9 + Vite 7 + Zustand 5；经典 renderer 可切换并随包分发 |
| 音频解密 | 稳定 | Soda 格式（AES-CTR）解密已实现 |
| 播放失败处理 | 稳定 | 自动跳转 + 上报修复中心 + 删除/修复闭环 |
| 桌面歌词 | 稳定 | 锁定态交互 + skipTaskbar + 跑马灯 |
| 多平台歌单导入 | 维护中 | 网易云、酷狗、汽水界面与 IPC 已迁移；实际登录、导入依赖账号和平台服务 |
| 在线解析下载 | 维护中 | 依赖第三方平台接口，需持续跟进接口变更 |
| 歌词系统 | 稳定 | 逐字歌词解析，多级回退获取策略 |
| 歌单分享 | 稳定 | wuu:// 加密协议 + HTTP 服务器 + 访问控制 |
| 首页新曲发现 | 已实现 | 网易云公开歌单候选、归一化去重、懒加载试听队列与完整音频保存检查 |
| 聆听 / 曲风统计 | 已实现 | 累计 / 90 天日历记录、近 7 / 30 天时长分布、手动 / 内嵌曲风标签 |
| 移动端 Web UI | 开发中 | Vue 3 + Vite 实现，为网页应用移植，未发布原生应用 |
| 移动端音效 | 已实现 | 独立 Web Audio 链、localStorage 自定义参数、读取桌面命名方案 |
| 移动端一起听 | 已实现 | WebSocket 单房间、seq 去重、host 切歌 / 心跳、欢迎快照与进度校准 |
| 歌库渲染与启动 | 已有优化 | 64px 虚拟列表、并行加载基础歌曲 / 用户数据、后台时长 / 流派补齐；继续测量大歌库瓶颈 |

### 9.2 路线规划

**短期目标：**

- React 桌面完善：持续覆盖导入、解析、修复与分享的真实场景，补充关键回归验证，完善交互与可访问性
- 性能优化：在现有虚拟列表与分阶段启动基础上测量同步目录扫描、单首时长解析和元数据缓存开销，再评估增量扫描、音频缓冲与预加载策略
- 移动端完善：补充功能模块，优化移动端交互体验

**中长期目标：**

- 类型与逻辑共享：桌面 TypeScript 已落地，逐步完善 IPC、HTTP 协议的类型定义，并提取桌面与手机端可共享的纯逻辑
- 数据存储优化：当歌库规模增长到 JSON 性能瓶颈时评估数据库迁移；当前 sql.js 仅用于读取汽水客户端 Cookies，不是现有用户设置数据库
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
- 当前没有 PWA manifest 或 service worker 配置，浏览器可提供主屏快捷方式，但仓库未实现 PWA 安装与离线缓存
- 集成 MediaSession API，安卓锁屏/通知栏可显示媒体控制
- 首次进入可读取桌面歌曲与进度；手机一起听另用 WebSocket 同步控制与位置
- 未来计划基于 Tauri 或 React Native 构建真正的原生移动应用

---

## 十一、核心资产

### 11.1 自研技术模块

| 模块 | 技术描述 |
|------|----------|
| Web Audio 音效链 | 基于 BiquadFilter（highpass/peaking/lowshelf/highshelf）+ ChannelSplitter/Merger（M/S 加宽）+ StereoPanner + OscillatorNode（LFO）+ Convolver（程序生成 IR）构建的完整效果链 |
| Soda 音频解密 | 基于 AES-CTR 加密模式与 MP4 ISO Base Media File Format box 结构原语自主实现的解密算法，支持从加密的 M4A 容器中还原原始音频流 |
| music:// 协议 | Electron `protocol.handle` + Node.js 异步文件读取 + Buffer Response；单段 Range 分段读取与 206 / 416 响应 |
| wuu:// 协议 | AES-256-GCM 保护 `{id,k,h}`，密文额外 XOR；端口独立混淆，外层字段未认证；自定义 WUU KEY 文件传递密钥 |
| 封面色彩提取 | 48×48 RGBA 采样，12 个 30° 色相桶 + 1 灰度桶，按有效像素占比输出平均 RGB 与权重；nativeImage 分支将 BGRA 转为 RGBA |
| 桌面歌词窗口 | 基于 BrowserWindow 的独立透明窗口，通过 setIgnoreMouseEvents 实现锁定状态下的鼠标穿透，开关与锁定在软件内控制，窗口位置持久化至配置文件；完整快照避免首色闪烁，歌词按实际行距上移过渡 |
| 播放失败修复链 | 播放器解码失败自动跳转 + IPC 上报 + play_failed.json 持久化 + 修复中心扫描合并 + 修复/删除自动清除记录的完整闭环 |
| 歌库扫描与补齐 | 桌面 IPC 同步基础扫描 + setImmediate 后台补齐，HTTP 歌库使用 worker_threads + 10 分钟缓存，两条路径分工不同 |
| 移动端一起听 | HTTP 音频流 + WebSocket 操作广播，单调 seq、host 仲裁、欢迎快照、指数退避重连及阈值进度校准 |
| 签名请求机制 | 通过加载客户端原生签名模块生成 X-Helios/X-Medusa 签名头，恢复会员音质获取能力 |

### 11.2 集成开源项目

| 项目 | 用途 | 许可证 |
|------|------|--------|
| [Electron](https://github.com/electron/electron) | 跨平台桌面应用运行时框架 | MIT |
| [React](https://github.com/facebook/react) | 桌面组件界面与桌面歌词窗口 | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | 桌面类型检查与开发工具 | Apache-2.0 |
| [Zustand](https://github.com/pmndrs/zustand) | 桌面状态管理 | MIT |
| [Vue 3](https://github.com/vuejs/core) | 渐进式 JavaScript 框架（移动端 UI） | MIT |
| [Vite](https://github.com/vitejs/vite) | 桌面与移动端构建、热更新工具 | MIT |
| [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) | 网易云音乐 API 服务 | MIT |
| [kugoumusicapi](https://github.com/MacroJson/kugoumusicapi) | 酷狗音乐 API 库 | MIT |
| [jpeg-js](https://github.com/eugeneware/jpeg-js) | JPEG 图像解码（封面处理） | BSD-3-Clause |
| [sql.js](https://github.com/sql-js/sql.js) | SQLite WASM 编译版，读取汽水客户端 Cookies 数据库 | MIT |
| [music-metadata](https://github.com/Borewit/music-metadata) | 音频内嵌标签与流派解析 | MIT |
| [ws](https://github.com/websockets/ws) | 本地一起听 WebSocket 服务 | MIT |
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
| `config/userdata.json` | 用户数据（喜欢 / 不推荐、收藏歌单、累计 / 近期播放统计、genreOverrides、播放进度、界面 / 音效 / 网络设置） |
| `config/play_failed.json` | 播放失败记录（修复中心扫描合并用） |
| `config/duration_cache.json` | 音频时长缓存（AAC / FLAC / MP3，含文件修改时间） |
| `config/free_music.json` | 免费听音乐专区数据（含免责声明接受状态） |
| `config/kugou_config.json` | 酷狗音乐多账号配置 |
| `config/qishui_config.json` | 汽水音乐多账号配置 |
| `config/netease_config.json` | 网易云音乐多账号配置 |
| `config/qishui_device.json` | 汽水音乐签名设备 ID 持久化 |
| `config/shared/` | 已分享的歌单数据（含 accessKey） |
| `output/` | 下载的歌曲目录（按"歌曲名 - 艺人"结构组织） |
