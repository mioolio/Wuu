# React 桌面端重构

桌面新版主界面和桌面歌词窗口使用 React 19、TypeScript、Vite 7 和 Zustand 5。Electron 主进程继续处理文件、解密、下载、账号和本地服务，移动端继续使用 Vue。默认生产入口是 `desktop_UI/dist/index.html`；`settings.interfaceMode='classic'` 时实际加载旧 `renderer/index.html` 和 `renderer/desktop-lyric.html`，两套资源均随包保留。

完整功能总览见 [README](../README.md)，各技术模块、算法和协议字段见 [技术实现说明](TECHNICAL_ARCHITECTURE.md)。本文侧重迁移后的边界、兼容方式和恢复入口。

## 开发与运行

构建环境需要 Node.js 20.19+ 或 22.12+（本次使用 Node.js 24），以及 npm。

```powershell
npm install
npm install --prefix desktop_UI
npm install --prefix mobile_UI
npm run dev
```

`npm run dev` 启动桌面 React 热更新服务和 Electron；主界面与歌词窗口共用 `127.0.0.1:5173`。修改主进程或 preload 后需要重启。`npm run dev:all` 同时启动移动端热更新服务，移动端地址为 `localhost:5174`。

```powershell
npm start             # 构建 React，再运行 Electron
npm run build:desktop # 类型检查及桌面静态构建
npm run build:mobile  # 移动端静态构建
npm run build:dir     # 两端构建及免安装目录包
npm run build         # 两端构建及 Windows 安装包
```

桌面启动脚本会在缺少 Vite 时自动安装 `desktop_UI` 依赖。网易服务的运行依赖声明在根 `package.json`，保证安装目录包包含完整依赖。

## 代码入口

- `src/main.tsx`：应用初始化、错误边界、窗口模式、快捷键和退出保存。
- `src/App.tsx`：窗口标题栏、导航、页面懒加载；访问过的功能页保留实例，使正在进行的导入不因切换页面中断。
- `src/store.ts`：歌曲、歌单、设置、统计、播放状态与兼容原有 JSON 的持久化。
- `src/api.ts`：Electron bridge、可取消的 IPC 订阅与本地媒体 URL。
- `src/services/player.ts`：独立播放器服务，页面切换不会销毁媒体元素。
- `src/services/audioFx.ts`、`lyrics.ts`：Web Audio 音效链及歌词解析。
- `src/components/`：播放栏、播放页、歌词、音效和通用交互。
- `src/features/`：音乐库、平台导入、免费听、修复、分享、统计和设置。
- `window/renderer-entry.js`：选择开发服务器或打包后的 React 入口。

上述 `src/` 路径均相对于 `desktop_UI/`。界面通过 preload 访问现有 IPC，未直接开放 Node.js 给 React。

## 实现边界与并发控制

| 场景 | 实现方式 | 避免的问题 |
| --- | --- | --- |
| 切页面继续听歌 | `playerService` 单例持有 `<video>`、AudioContext 与效果链，UI 订阅 Zustand 快照 | 页面卸载重新创建媒体、丢失进度 |
| 启动和迟到用户数据 | 歌曲与 userdata 并发；`hydrated` 前禁写；`pendingChanges` 顺序重放早期用户操作 | 空默认值覆盖原收藏、迟到恢复覆盖手动选歌 |
| 快速切歌和试听 | 初始化生命周期、播放版本、封面请求编号分别检查异步结果 | 旧歌词、旧音源、旧颜色覆盖当前歌曲 |
| 歌曲标签后台补齐 | `song-metadata-update` 按路径入 Map，50ms 批量合并现有对象 | 逐首重建全库、已删歌曲回流、音频重新打开 |
| 导入页面切换 | lazy/Suspense + visited 集合保留页面实例 | 长任务因页面隐藏中断 |
| IPC 事件订阅 | preload 返回具体 listener 的 unsubscribe，组件/服务清理监听 | 重开页面重复处理事件 |
| 收藏迁移和退出 | JSON 兼容字段、500ms 合并保存、beforeunload 同步 IPC；旧 localStorage 成功落盘后清除 | 迁移或退出过程中丢数据 |
| 新旧界面切换 | 先保存共享 JSON 与本地会话，再通过 renderer-entry 重载对应文件 | 两套界面数据分叉、暂停状态丢失 |

`contextIsolation:true` 与 `nodeIntegration:false` 隔离 React 对 Node 的直接访问；主窗口当前仍配置 `webSecurity:false`，媒体协议允许解码本地路径。迁移没有同时完成通用 IPC 参数校验或文件目录沙箱，不能把框架重构等同于这些边界已加固。

原有 `config/userdata.json` 的收藏、歌单、进度、统计、设置和自定义音效字段保持兼容。旧字符串收藏可迁移为歌单；旧浏览器收藏只有成功保存后才移除。修复歌曲重命名时同步迁移相关路径引用。

## 验证

```powershell
npm run typecheck
npm test
npm run build:desktop
npm run test:desktop
```

单元测试覆盖用户数据迁移、播放与试听竞态、歌词和音效、IPC 订阅清理、歌单数据处理及修复路径迁移。Electron 验证使用独立音频、内存 IPC 数据和浏览器配置目录；文件写入位于忽略的 `.test-artifacts/`，不修改真实音乐目录和账号配置。

Electron 验证检查主要页面、音乐连续播放、拖动进度、前后切歌、收藏保存、音效、歌词窗口、修复扫描和网络开关，并输出界面截图。验证打包内的 React 资源与网易依赖：

```powershell
npm run build:dir
$env:WUU_SMOKE_PACKAGED = '1'
npm run test:desktop
Remove-Item Env:WUU_SMOKE_PACKAGED
```

第三方平台真实账号登录、授权内容获取及实际联网下载未在隔离验证中执行，仍需要使用相应账号和网络进行实际验证。

## Git 备份与恢复

重构前创建了完整源码快照，随后在独立分支上重构：

- 重构前提交：`cafe60e73e892486665d3fe8c49230e45cdca35f`。
- 重构前标签：`pre-react-20260929`。
- React 分支：`refactor/react-desktop`。
- 独立备份文件：`.backups/wuu-before-react-20260929.bundle`，已通过 `git bundle verify`。
- 完成后备份：`.backups/wuu-react-desktop-20260929.bundle`，包含旧快照与 React 分支；完成标签为 `react-desktop-20260929`。

查看或验证备份：

```powershell
git show --stat pre-react-20260929
git bundle verify .backups/wuu-before-react-20260929.bundle
```

需要检查旧版本时，先保存当前修改，再创建恢复分支：

```powershell
git switch -c restore/pre-react pre-react-20260929
```

也可从独立 bundle 恢复到另一个目录，不覆盖当前源码：

```powershell
git clone .backups/wuu-before-react-20260929.bundle ../Wuu-before-react
```

Git 和 bundle 备份的是源码及锁文件；原有 `.gitignore` 排除的账号配置、下载音乐、依赖目录、构建产物和专有二进制不在备份内。本次重构保留这些本地文件。
