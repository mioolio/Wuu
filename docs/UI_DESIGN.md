# Wuu 桌面设计

界面围绕聆听、浏览音乐库和管理歌单展开。使用克制的深色表面承托封面，减少常驻按钮，让播放操作和歌曲信息更容易找到。

本次参考 [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) 的音乐产品、深色界面、键盘焦点和响应式设计建议。设计参考保存在本地测试目录，未添加运行依赖；布局根据 Electron 音乐播放器的实际窗口与操作调整。

## 视觉规范

| 用途 | 颜色 / 规则 |
| --- | --- |
| 背景 | `#141718` |
| 内容表面 | `#1c2021` |
| 主要文字 | `#f4f4ef` |
| 次要文字 | `#a1aaa6` |
| 播放、选中、焦点 | `#d7f591` |
| 绿色按钮文字 | `#202717` |
| 字体 | Segoe UI Variable / Segoe UI / Microsoft YaHei UI；无需下载字体 |
| 间距 | 以 4px 为基础，内容区域使用 24–34px 边距 |
| 圆角 | 普通控件 8px，卡片 12px，首页主视觉 18px |
| 图标 | 统一 SVG 描边图标，装饰图形不替代按钮标签 |

`desktop_UI/src/design-system.css` 管理主题、标题栏、导航、列表和通用控件；`features/home.css` 管理首页；`components/player-design.css` 管理底栏与播放页。`styles.css` 保留共用的结构布局。

## 页面与交互

- 推荐首页展示当前或上次播放歌曲，依据本地收藏和播放记录推荐音乐。空歌库有明确的导入入口；不推荐歌曲不会进入首页推荐。
- 导航按聆听、我的音乐、音乐工具分组，设置固定在底部。较矮窗口收起资料库说明，窄窗口使用带提示的图标导航；内容仍可滚动。
- 歌曲列表区分曲名、艺人、专辑与时长，将分享、不推荐等低频操作放入菜单。菜单支持方向键、Escape 和 Tab。
- 播放栏始终保留封面、播放控制、时间与音量。播放页突出封面和歌词；既有圆盘、颜色、字号与音效设置继续有效。
- 页面通过 React 懒加载，已访问的页面保留实例，播放服务独立于路由。歌曲列表继续使用 64px 虚拟行步长。
- 提供清晰键盘焦点和跳过导航入口；焦点在按钮或菜单上时，空格按键操作当前控件。减少动画的系统偏好会关闭动效。

## 验证

```powershell
npm run build:desktop
npm test
npm run test:desktop
npm run test:visual
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
