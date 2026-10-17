# 视频工作联动

一个 Edge / Chrome 扩展：AI 开始工作时打开抖音并自动播放，AI 完成后暂停视频、切回工作台。支持 ChatGPT 网页、其他自定义 AI 网站和可选的 Codex 桌面联动，并可在开始前选择网页版或电脑端抖音 App。

## 先查过的 GitHub 项目

结论：没有找到同时满足“抖音 + AI 工作联动 + 完成暂停并返回”的现成项目。

| 项目 | 可复用点 | 不满足的部分 |
| --- | --- | --- |
| [Tyson3101/Auto-TikTok-Scroller](https://github.com/Tyson3101/Auto-TikTok-Scroller) | Apache-2.0，视频结束后逐条推进 | 仅支持 TikTok，已归档，无 AI 联动与返回工作台 |
| [kevintheliao/Auto-Scroller-Instagram-Reels-TikTok-YouTube-Shorts](https://github.com/kevintheliao/Auto-Scroller-Instagram-Reels-TikTok-YouTube-Shorts) | 多站点短视频自动翻页 | 不支持抖音，无 AI 状态联动 |
| [bao-lin-yang/auto-scroller-extension](https://github.com/bao-lin-yang/auto-scroller-extension) | Edge 扩展结构、通用滚动容器识别 | 短视频模式仍在路线图中，无 AI 联动 |
| [Sran012/LazyScroll](https://github.com/Sran012/LazyScroll) | 短视频进度判断 | 仅支持 YouTube Shorts |

更完整的检索记录见 [docs/github-research.md](docs/github-research.md)。

## 已实现

- ChatGPT 网页开始生成时，自动打开或切到抖音标签页。
- ChatGPT 的多个网页对话会复用一个抖音会话：任意对话开始都会进入抖音，任意一个对话结束都会立即暂停并返回。
- 其他 AI 网站可通过独立配置窗口接入：填写域名、名称和“工作中”CSS 选择器，或采用统一页面状态接口。
- 自定义网站只在用户授权目标域名后动态注入适配脚本，不申请常驻全站访问权限。
- Codex 桌面任务开始时，通过本地桥自动进入抖音并开始播放。
- ChatGPT 对话和 Codex 桌面同时工作时，任意一个来源结束都会暂停本轮抖音，不会等待其他来源完成。
- 抖音视频结束后只推进一次，避免同一视频重复滚动。
- 达到视频上限后暂停，不会继续刷过头。
- AI 完成后暂停全部抖音视频，并切回发起工作的 ChatGPT、自定义 AI 标签页或 Codex 窗口。
- 开始前可选择“网页版”或“电脑端 App”：网页版支持逐条计数，电脑端 App 由本地桥启动时确认播放、结束时确认暂停。
- 两种视频端都会显示可用状态：网页版检测抖音页面是否可达，电脑端检测协议、客户端文件和运行窗口；不可用项会禁用并显示原因。
- 电脑端 App 不再盲发空格键：本地桥直接向抖音渲染窗口发送视频点击，并用相邻画面和播放时间戳变化复核真实播放状态。
- 每次开始前再次校验所选视频端，避免弹窗打开后网络、本地桥或客户端状态发生变化。
- 桌面桥断开超过 10 秒时安全暂停并返回，避免无人看管时继续刷。
- 设置项：视频端、AI 页面自动联动、自定义 AI 网站、Codex 桌面联动、完成后返回、视频上限。
- 手动兜底：扩展弹窗开始/结束，以及浏览器快捷键 `Alt+Shift+S`、`Alt+Shift+X`。
- 抖音页面左下角显示本轮进度，可随时暂停并返回。

## 工作原理

- `extension/workbench.js` 检测 ChatGPT 网页中的停止生成按钮，判断工作开始与结束。
- `extension/custom-ai.js` 在已授权的自定义 AI 页面中检测 CSS 选择器、`data-work-video-link-state="working"` 属性或开始/结束事件。
- `extension/custom-ai/custom-ai.html` 提供独立的自定义 AI 配置窗口，负责规则管理、域名授权和连接测试。
- `bridge/server.mjs` 通过本机只读 CDP 连接识别 Codex 桌面当前是否处于 Working，再通过 `ws://127.0.0.1:17321/ws` 通知扩展。
- 扩展统一管理会话：打开抖音、记录视频数、暂停视频、切回工作台。
- 扩展记录正在工作的来源，每个 AI 网页标签页和 Codex 桌面各占一个来源；任一来源上报结束就执行自动暂停，并锁定本轮避免其他来源的心跳再次拉起抖音。
- 电脑端控制先截图比较当前是否在播放；状态不符时点击一次视频区域，再复核目标状态，未通过复核就报告失败。
- 桌面桥只监听 `127.0.0.1`，不下载、修改或上传视频，也不读取对话内容。

## 安装

需要 Windows、Edge/Chrome，以及 Node.js 22 或更新版本。


1. 打开 Edge 的 `edge://extensions`，或 Chrome 的 `chrome://extensions`。
2. 开启“开发人员模式”。
3. 选择“加载解压缩的扩展”，指向本仓库的 `extension` 目录；如果使用发布包，解压后指向其中的 `extension` 目录。
4. 将扩展固定到工具栏。
5. 在扩展弹窗的“视频端”中选择播放位置。网页版需先在抖音网页登录；电脑端需安装并登录抖音 Windows 客户端。

如果只使用网页版且不需要跟随 Codex 桌面，到这里即可。使用电脑端 App 或跟随 Codex 桌面时，需要安装本地桥：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bridge\install-autostart.ps1
```

该脚本会创建开机启动快捷方式并立即启动桥。可以这样检查：

```powershell
Invoke-RestMethod http://127.0.0.1:17321/status
```

然后在扩展弹窗中打开“跟随 Codex 桌面”。默认关闭，避免未安装本地桥时产生误动作。

本地桥的其他命令：

```powershell
.\bridge\start.ps1
.\bridge\stop.ps1
.\bridge\uninstall-autostart.ps1
```

桥日志位于 `%LOCALAPPDATA%\VideoWorkLink\bridge.out.log` 和 `bridge.err.log`。

## 使用

ChatGPT 网页：发送任务后，扩展检测到正在生成时进入抖音；生成结束后暂停并返回原标签页。

其他 AI 网站：打开目标网站后，在扩展弹窗点击“其他 AI”。配置窗口会自动带入当前域名；填写显示名称和“工作中”元素选择器后保存并授权。若网站支持修改页面，也可以直接使用状态属性或事件接口。完整说明见 [docs/custom-ai-integration.md](docs/custom-ai-integration.md)。

Codex 桌面：启用桌面联动且本地桥运行后，Codex 进入工作状态时进入抖音；工作完成或中断时暂停并切回 Codex 窗口。

手动模式：在任意普通网页打开扩展，点击“开始联动”。该网页会记录为返回目标。也可以先在抖音页打开扩展，手动开始播放。

视频端选择：

- “网页版”会在浏览器标签页中打开或复用抖音，支持视频结束检测、逐条推进和视频上限。
- “电脑端 App”会通过 `douyin-pc://` 启动或聚焦 Windows 客户端；开始时若当前已暂停会恢复播放，AI 完成、手动结束或联动中断时会确认暂停，然后返回工作台。该模式使用客户端自身的连播能力，不按网页视频条数计数。

弹窗中的状态点会显示检测结果：绿色表示可用，灰色表示正在检测，红色表示不可用。不可用项不能选择；当前已选项不可用时，“开始联动”也会禁用并显示具体原因。

快捷键：

- `Alt+Shift+S`：开始或结束联动
- `Alt+Shift+X`：结束、暂停并返回

## 边界

- Codex 桌面联动依赖本机 CDP 端口 `9229` 和当前工作状态标记；Codex 桌面升级后标记变化时，需要更新桥的检测逻辑。
- 本地桥必须运行。桥断开超过 10 秒时，扩展会选择安全暂停并返回工作台。
- 抖音推荐流需要登录；未登录时页面会显示登录框，扩展会提示而不会继续乱刷。
- 多个对话只共用一个抖音会话，不会为每个对话重复打开抖音；任意一个对话结束都会暂停本轮，其他仍在工作的对话不会自动重新开启抖音，需要等下一次新任务开始。
- 电脑端 App 模式依赖抖音 Windows 客户端、`douyin-pc://` 协议和本地桥。若客户端没有可聚焦窗口，扩展会提示启动失败；暂停失败时会明确标红，避免误报为已暂停。
- 电脑端 App 的视频播放状态通过画面和时间戳变化判断。极少数完全静态且隐藏时间戳的页面可能需要用户手动点击一次视频；未通过复核时扩展会明确标红，不会误报暂停成功。
- ChatGPT 的按钮结构变化时，自动检测可能失效；弹窗和快捷键仍可控制。
- 自定义 AI 的选择器必须只在生成期间命中。选择器失效时可以在配置窗口编辑；不提供选择器时，需要页面设置状态属性或派发约定事件。
- 自定义域名权限不会随同步存储跨设备迁移，在新设备上需要重新授权。
- 浏览器可能要求用户先与抖音页面交互一次，才允许自动播放。被拦截时点击抖音页面左下角的“继续播放”。
- 扩展不下载、修改或上传视频，只控制当前网页的播放与滚动。

## 开发与验证

```powershell
npm run verify
npm run test:popup
```

本地桥和 Codex 桌面打开时，可以额外运行：

```powershell
npm run test:bridge
npm run test:e2e:desktop
npm run test:e2e:app
```

生成发布包：

```powershell
npm run package:release
```

真实浏览器链路测试会在本机 Edge 中加载扩展并模拟 ChatGPT、自定义 AI 与抖音页面：

```powershell
npm run test:e2e
```

项目不需要构建步骤，`extension` 目录可直接加载。
