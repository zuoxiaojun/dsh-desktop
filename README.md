# DSH Desktop

> DeepSeek Harness（`dsh web`）的桌面客户端

DSH Desktop 是一个轻量 Electron 桌面壳，在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 官方 `dsh web` 之上提供桌面化体验。

**只加一个桌面入口，不改一行 DSH 核心代码，也不打包任何运行时。**

## 特性

- **纯壳、轻量**：不打包 dsh 及其依赖，安装包约 90MB；运行时使用你**自己的 Node.js**。
- **自动装 Node**：首次启动若系统没有 Node（或版本 < 18），自动从**国内镜像 `npmmirror`** 下载 Node LTS 并安装，闪屏显示进度。
- **国内镜像加速**：dsh 安装走 npm 国内镜像，npm 缓存隔离在应用数据目录。
- **与官方完全一致**：HMR、全部 dsh 功能原样保留，桌面只加入口。
- **内置更新检查**：通过应用菜单「关于 / 检查更新」与系统托盘可手动检查 dsh 内核与桌面版更新，检测到新版本引导去 GitHub Release 下载。
- **多平台**：macOS / Windows / Linux。

## 安装

从 [GitHub Releases](https://github.com/zuoxiaojun/dsh-desktop/releases) 下载对应平台的安装包：

| 平台 | 安装包 | 说明 |
| --- | --- | --- |
| macOS | `DSH.Desktop-<ver>-arm64.dmg` | 自签名未公证，首次打开请**右键 → 打开**，或见下方终端命令解除安全校验 |
| Windows | `DSH.Desktop-<ver>-setup-x64.exe` | 直接安装 |
| Linux | `DSH.Desktop-<ver>-x86_64.AppImage` | 直接运行 |

> **macOS 打开提示**：安装包为自签名（未公证），从网上下载会被 Gatekeeper 标记为「无法验证开发者 / 安全性阻止」。两种绕过方式（任选其一）：
>
> - **右键 → 打开**（最简单，无需终端）；
> - **用终端解除安全校验**：移除下载带来的 `com.apple.quarantine` 隔离属性：

```sh
xattr -d com.apple.quarantine "/Applications/DSH Desktop.app"
```

如需清除 app 的全部扩展属性（含 quarantine），可执行：

```sh
xattr -cr "/Applications/DSH Desktop.app"
```

若命令提示 app 不在上述路径，把引号里的 `.app` 路径换成实际的即可。

## 运行环境

- Node.js >= 18（运行时缺 Node 由客户端自动安装）
- macOS / Windows / Linux

## 本地开发

```sh
pnpm install
pnpm run dev:desktop           # 构建并启动
pnpm run dev:desktop:rebuild   # 强制重建后启动
```

## 许可证

[MIT](./LICENSE)
