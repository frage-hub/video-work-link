# 视频工作联动安装说明

发布页只提供一个完整安装包。解压后，所有组件都在同一个文件夹中。

## 一键准备

1. 安装 Node.js 22 或更新版本。
2. 双击 `INSTALL.cmd`。
3. 安装器会安装并启动本地桥，复制扩展目录路径，打开 Edge/Chrome 扩展页和文件资源管理器。
4. 在扩展页开启“开发人员模式”，选择“加载解压缩的扩展”，指向安装器显示的 `extension` 文件夹。
5. 固定扩展，打开弹窗选择“网页版”或“电脑端 App”。

安装器还会在桌面创建“Video Work Link”快捷方式，图标与扩展一致。加载扩展后，双击快捷方式会直接打开扩展控制面板。

如果扩展页里还保留着旧版本，请先移除旧版本，再加载当前包内的 `extension` 文件夹。`v0.6.4` 起使用固定扩展 ID，因此后续更新不再改变桌面快捷方式。

浏览器不允许普通安装程序绕过扩展安全确认，因此最后一步必须在扩展页手动确认。

## 只用网页版

可以跳过本地桥。直接按照上面的第 4、5 步加载 `extension` 文件夹即可。

## 使用电脑端 App 或 Codex 桌面联动

必须保证：

- Node.js 22 或更新版本可用。
- 抖音 Windows 客户端已安装并登录。
- 本地桥已启动：`http://127.0.0.1:17321/status` 可访问。
- 扩展弹窗中的“跟随 Codex 桌面”已开启。

本地桥命令位于 `bridge` 文件夹：

```powershell
.\bridge\start.ps1
.\bridge\stop.ps1
.\bridge\install-autostart.ps1
.\bridge\uninstall-autostart.ps1
```

日志位于 `%LOCALAPPDATA%\VideoWorkLink\bridge.out.log` 和 `bridge.err.log`。
