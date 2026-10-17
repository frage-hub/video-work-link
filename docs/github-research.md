# GitHub 检索记录

检索日期：2026-10-17

检索目标：找到能复用“抖音自动播放、AI 开始/完成联动、自动暂停并返回工作台”的开源项目。

## 检索范围

- GitHub Repository Search：`douyin auto scroll`、`douyin autoplay extension`、`douyin assistant extension`、`tiktok auto scroll extension`、`auto scroll short video extension`、`chatgpt tiktok autoscroll extension` 等。
- 中文关键词：`抖音 自动刷视频 插件`、`抖音 自动滑动 油猴脚本`、`抖音 自动播放 浏览器`。
- 对候选项目检查了 README、Manifest、内容脚本、许可证和维护状态。

## 候选项目

### Tyson3101/Auto-TikTok-Scroller

- 许可证：Apache-2.0
- 状态：已归档
- 能力：TikTok 视频结束后自动切换到下一条，支持全屏。
- 缺口：仅 TikTok；没有抖音 DOM 适配、AI 状态检测、暂停后返回。
- 可借鉴：`video.ended` 驱动的单次推进思路。

### kevintheliao/Auto-Scroller-Instagram-Reels-TikTok-YouTube-Shorts

- 能力：Instagram Reels、TikTok、YouTube Shorts 自动翻页与快捷键。
- 缺口：不支持抖音；没有工作台联动。
- 可借鉴：多平台内容脚本与快捷键控制。

### bao-lin-yang/auto-scroller-extension

- 能力：Edge MV3 扩展、通用滚动容器发现。
- 缺口：README 明确列出短视频模式仍在 roadmap，未实现。

### Sran012/LazyScroll

- 能力：YouTube Shorts 播放进度超过 80% 后跳过。
- 缺口：仅 YouTube；目标行为是跳过而不是工作结束暂停。

## 结论

不存在可直接安装并满足全部需求的公开项目。因此本项目自行实现，同时借用公开项目中“每个视频只推进一次”和“短页面滚动容器识别”的成熟思路，不复制其 UI 或品牌资源。
