# Wuu 桌面设计

界面围绕聆听、浏览音乐库和管理歌单展开。导航可收起与调宽；透明度与封面配色统一在设置的外观分类调整。中性模式与沉浸模式共用同一套布局。

正在播放的布局、封面配色与细节交互遵循 [播放器体验约定](player-experience.md)。全部功能见 [README](../README.md)；进程、音频、存储、网络与平台协议见 [技术实现说明](TECHNICAL_ARCHITECTURE.md)。本文记录界面参数与对应实现。

## 视觉规范

| 用途 | 颜色 / 规则 |
| --- | --- |
| 背景 | 中性深色；开启随音乐变色后使用当前封面派生色 |
| 内容表面 | 与外壳共用透明度和封面色，不用固定不透明图层覆盖 |
| 主要文字 | `#f2f2f5` |
| 次要文字 | `#aaaab4` |
| 播放、选中、焦点 | `#c7b8ed`；中性表面只在选中与关键操作使用强调色 |
| 歌词、桌面歌词、播放进度 | 默认封面色；自定义颜色优先；开启全局跟随时扩展到选中和焦点 |
| 强调按钮文字 | `#24202e` |
| 字体 | Segoe UI Variable / Segoe UI / Microsoft YaHei UI；无需下载字体 |
| 间距 | 以 4px 为基础，内容区域使用 24–34px 边距 |
| 圆角 | 普通控件、卡片和首页主视觉 8px |
| 图标 | 统一 SVG 描边图标，装饰图形不替代按钮标签 |

`desktop_UI/src/design-system.css` 管理主题、标题栏、导航、列表和通用控件；`features/home.css` 管理首页；`components/player-design.css` 管理底栏与播放页。`styles.css` 保留共用的结构布局。

## 页面与交互

- 新版常驻标题栏 44px，播放栏 80px。标题栏仅保留商标、窗口拖动区域和窗口控制，所有窗口尺寸都显示完整商标；外观调整集中在设置。
- 侧栏默认收起为 56px 图标导航；可随时展开，展开默认 184px，支持拖动边缘在 152–260px 内调宽。收起状态与展开宽度持久化，窗口缩小时仅限制实际宽度，不覆盖用户偏好。分隔条支持键盘方向键、Home、End；设置中也有宽度滑杆作为拖动替代。
- 侧栏收起与展开使用短缓动，拖动期间立即跟随指针，快速反向操作接续当前宽度；减少动画偏好会关闭过渡。
- 设置 → 外观 → 封面与背景提供全局跟随封面开关与透明度滑杆。`glassOpacity` 表示不透明度，范围 0.12–1，向左拖动更透明。标题栏、侧栏、主内容与底栏直接使用该 alpha；外壳不再叠加固定不透明底色。调整立即显示，偏好定期保存。
- 可选的封面主题同时改变外壳、标题栏、导航和底栏，换歌时平滑过渡；关闭后回到中性表面，播放页仍保留当前音乐的氛围。
- 设置按外观、播放、歌词、音效、网络服务分类，类别内再分功能组，高级参数默认折叠。支持方向键、Home、End 切换类别。
- 外观提供「切换到旧版界面」，直接加载 `renderer/index.html`，桌面歌词也加载 `renderer/desktop-lyric.html`；旧版设置提供返回新版入口。启动遵循保存的 `settings.interfaceMode`。两版共享歌曲、歌单、进度、设置及统计；切换会重载界面，恢复本地歌曲与暂停状态。
- 当前歌词使用独立字号（新用户默认 28px，普通行 20px，当前行可调至 60px）与较高字重，已播放与待播放周边行使用同一弱化层级。相同时间戳的双语行成组高亮与居中；手动浏览和拖动期间停止跟随。
- 音乐统计用一条数据带展示四项累计指标，较窄内容区域才折行。统计页隐藏时停止数据订阅；显示时按秒更新累计排行与曲风，手工标签即时更新。
- 曲风来源为本地音频标签与手工补充，手工标签保存在 `genreOverrides`，不改写媒体。近期分布按最近 7／30 天实际聆听时长计算，多标签平分时长，并展示未标注占比与覆盖率。新日期记录保存在 `stats[path].recentDays`，保留 90 天明细；旧累计保留，不伪造日期。

- 推荐首页展示当前或上次播放歌曲，依据本地收藏和播放记录推荐音乐。空歌库有明确的导入入口；不推荐歌曲不会进入首页推荐。
- 导航按聆听、我的音乐、音乐工具分组，设置固定在底部。图标模式保留按钮名称和工具提示；展开、收起由用户控制，较矮窗口内导航仍可滚动。
- 歌曲列表区分曲名、艺人、专辑与时长，将分享、不推荐等低频操作放入菜单。菜单支持方向键、Escape 和 Tab。
- 播放栏始终保留封面、播放控制、时间与音量。播放页直接展示封面和歌词，不使用「正在聆听」状态头或预留空行；试听来源与视频类型在歌曲信息行说明。既有圆盘、颜色、字号与音效设置继续有效。
- 音效入口集中在常驻底栏；播放页同功能的收藏与加号合并为明确的歌单管理入口。歌曲时长与专辑放在同一信息行，长标题和作词信息通过等比缩小封面获得稳定空间。
- 右侧滚动条与导航标记保留实例，切换页面时连续变换位置与长度；底栏保持实时反馈。音效、歌单与队列退出后保留内容，快速反向操作接续当前视觉状态；弹窗具有键盘焦点约束和返回。
- 页面通过 React 懒加载，已访问的页面保留实例，播放服务独立于路由。歌曲列表继续使用 64px 虚拟行步长。
- 提供清晰键盘焦点和跳过导航入口；焦点在按钮或菜单上时，空格按键操作当前控件。减少动画的系统偏好会关闭动效。

## 组件和浏览器技术

| 能力 | 具体实现 | 源码 |
| --- | --- | --- |
| 功能页加载及状态保留 | React lazy/Suspense 按功能拆包；访问集合保留实例，hidden 切换；播放器独立单例 | [App.tsx](../desktop_UI/src/App.tsx)、[player.ts](../desktop_UI/src/services/player.ts) |
| 大歌库列表 | 固定 64px 行步长，按 scrollTop/容器高度计算可见范围，前后各 5 行缓冲，绝对定位行 | [LibraryView.tsx](../desktop_UI/src/features/LibraryView.tsx) |
| 连续页面和封面过渡 | View Transition API；generation 防旧回调，skipTransition 中断；只捕获 page-host；页面 320ms、共享封面 620ms，备用 WAAPI 内容 280ms | [usePageMotion.ts](../desktop_UI/src/components/usePageMotion.ts)、[page-motion.css](../desktop_UI/src/components/page-motion.css) |
| 封面加载与恢复 | RecordArtwork 等待 Cover 的 onLoad 后交接封面层；请求隔离；失败 1200ms 后自动重试一次，focus/online/可见性触发后续重试 | [RecordArtwork.tsx](../desktop_UI/src/components/RecordArtwork.tsx)、[Cover.tsx](../desktop_UI/src/components/Cover.tsx) |
| 配色与可读性 | 主进程 48×48 像素采样、12 色相桶加灰度桶；渲染层 sRGB 相对亮度及 4.5 对比目标二分调整 | [color.js](../cover/color.js)、[coverPalette.ts](../desktop_UI/src/services/coverPalette.ts) |
| 歌词焦点与逐字填充 | rAF 读取音频时钟；时间戳二分定位、同时间戳组共享焦点；六秒手工浏览暂停跟随 | [LyricsView.tsx](../desktop_UI/src/components/LyricsView.tsx)、[lyricPresentation.ts](../desktop_UI/src/services/lyricPresentation.ts) |
| 侧栏参数与拖动替代 | 宽度限幅与持久化；pointer 拖动、方向键/Home/End、设置滑杆 | [Sidebar.tsx](../desktop_UI/src/components/Sidebar.tsx)、[sidebarPreferences.ts](../desktop_UI/src/services/sidebarPreferences.ts) |
| 导航标记与滚动轨 | 保留组件实例，追踪当前目标矩形/滚动容器，动画从当前位置接续 | [NavigationMarker.tsx](../desktop_UI/src/components/NavigationMarker.tsx)、[PageScrollRail.tsx](../desktop_UI/src/components/PageScrollRail.tsx) |
| 浮层与键盘操作 | 可访问按钮名称、Escape/Tab/方向键、焦点约束与关闭后返回触发按钮 | [GlobalUI.tsx](../desktop_UI/src/components/GlobalUI.tsx)、[SongPopover.tsx](../desktop_UI/src/components/SongPopover.tsx) |

`prefers-reduced-motion` 和隐藏窗口分支直接落实最终页面，继续更新歌词时间与填充。动画只承担视觉反馈，必要数据与播放状态不等待 animationend。ResizeObserver/IntersectionObserver 用于尺寸、可见性与加载生命周期，卸载清理监听、定时器和帧。

## 验证

```powershell
npm run build:desktop
npm test
npm run test:desktop
npm run test:visual
node scripts/freedom-desktop.cjs
# 同时验证空歌库
$env:WUU_VISUAL_EMPTY = '1'
npm run test:visual
Remove-Item Env:WUU_VISUAL_EMPTY
```

视觉验证在真实 Electron 中使用独立配置和虚构歌库，生成默认 1100×720、最小 800×500 窗口，以及空歌库截图；同时检查内容溢出、播放器控件、菜单和键盘操作。截图输出到忽略的 `.test-artifacts/`，测试歌曲与封面不进入正式应用。

## Git 备份

- 改版前：`pre-ui-redesign-20260929`，指向已完成的 React 迁移。
- 改版完成：`ui-redesign-20260929`。
- 独立完整历史备份：`.backups/wuu-ui-redesign-20260929.bundle`。

```powershell
git bundle verify .backups/wuu-ui-redesign-20260929.bundle
git diff pre-ui-redesign-20260929 ui-redesign-20260929 -- desktop_UI
```

备份包含源码和锁文件；音乐、账号配置、依赖与构建产物按 `.gitignore` 排除。
