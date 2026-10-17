# 自定义 AI 接入指南

扩展不仅支持 ChatGPT 网页和 Codex 桌面，也可以为其他 AI 网站配置工作状态检测。自定义规则由用户主动添加，并且只申请目标域名的访问权限。

## 用户配置流程

1. 打开目标 AI 网站。
2. 打开扩展弹窗，点击“其他 AI”。
3. 配置窗口会自动带入当前网站域名；填写名称和可选的“工作中”CSS 选择器。
4. 点击“保存并授权”，在浏览器权限提示中允许访问该域名。
5. 重新加载目标 AI 页面，即可测试开始与结束联动。

规则保存在 `chrome.storage.sync` 的 `customSources` 字段中。每项规则包含：

```json
{
  "id": "custom-example",
  "name": "Example AI",
  "origin": "https://ai.example.com",
  "selector": "button[aria-label='Stop response']",
  "enabled": true
}
```

同一个域名只允许一条规则。最多保存 20 条规则。

## 方式一：CSS 选择器

配置一个只在生成期间可见的元素选择器，例如：

```css
button[aria-label="Stop response"]
button[data-testid="generation-status"]
button.stop-button:not([disabled])
```

扩展每 160 毫秒检查一次。选择器命中可见且未禁用的元素时，任务进入工作状态；元素消失并稳定约 0.45 秒后，任务结束。

选择器不要匹配长期存在的发送按钮、导航栏或布局容器，否则可能产生误触发。

## 方式二：页面状态属性

网站或用户脚本可以直接修改页面根元素：

```js
// 开始工作
document.documentElement.setAttribute(
  "data-work-video-link-state",
  "working"
);

// 完成、取消或报错
document.documentElement.removeAttribute(
  "data-work-video-link-state"
);
```

内容脚本运行在扩展隔离环境中，但与页面共享 DOM，因此能够读取该属性，不需要网站引入额外 SDK。

## 方式三：页面事件

适合单页应用在状态切换点直接派发事件：

```js
window.dispatchEvent(new CustomEvent("work-video-link:start"));
window.dispatchEvent(new CustomEvent("work-video-link:end"));
```

事件名称：

| 事件 | 含义 |
| --- | --- |
| `work-video-link:start` | 开始或继续工作 |
| `work-video-link:end` | 完成、取消或中断 |

事件方式会立即上报结束。如果页面状态可能抖动，应先在页面业务层合并重复事件。

## 扩展内部接口

动态适配脚本 `extension/custom-ai.js` 会向后台发送以下消息：

```js
chrome.runtime.sendMessage({
  type: "CUSTOM_AI_GENERATION_STARTED",
  sourceId: "custom-example"
});

chrome.runtime.sendMessage({
  type: "CUSTOM_AI_GENERATION_COMPLETED",
  sourceId: "custom-example"
});
```

后台使用标签页 ID 创建统一工作来源 `browser:<tabId>`，与 ChatGPT 网页共用现有启动、暂停、返回、视频上限和快捷键逻辑。

新增内置站点适配器时，推荐复用以下接口：

- `WorkLink.normalizeCustomSource()`：规范化站点规则。
- `WorkLink.normalizeCustomSources()`：去重、限制数量并规范化规则列表。
- `WorkLink.findCustomSource(url, sources)`：按当前 URL 查找启用规则。
- `extension/custom-ai.js`：选择器、状态属性和事件三种通用检测实现。
- 后台消息 `CUSTOM_AI_GENERATION_STARTED` / `CUSTOM_AI_GENERATION_COMPLETED`：接入统一工作来源。

## 权限与安全

- 配置窗口使用 `chrome.permissions.request()` 按域名申请可选主机权限。
- 删除最后一条同域名规则时，会尝试撤销对应权限。
- 扩展不申请常驻全站访问权限。
- 动态脚本只读取工作状态元素、页面根元素上的状态属性以及约定事件，不读取对话正文。
- 页面关闭、规则停用或删除时，会清除对应工作来源并触发安全暂停。

## 验证

配置完成后，在配置窗口点击规则的“测试连接”按钮。测试会：

1. 检查当前域名权限。
2. 查找该域名已打开的标签页。
3. 注入或刷新通用适配脚本。
4. 检查选择器当前是否命中“工作中”元素。

如果页面仍无法联动，请先刷新目标页面，再检查选择器是否会随生成状态出现和消失。
