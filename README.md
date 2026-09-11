# DSH Desktop

> DeepSeek Harness（`dsh web`）的桌面客户端

DSH Desktop 是一个 Electron 桌面壳，在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 官方 `dsh web` 之上提供桌面化体验。

**只加一个桌面入口，不改一行 DSH 核心代码，也不打包 DSH 依赖。**

## 特性

### 架构

- **纯壳**：安装包只含 Electron 壳 + Node 运行时（约 176MB），不打包 `@deepseek-ai/dsh` 及其 npm 依赖，dsh 首次启动联网安装。
- **内置 Node 运行时**：构建时从国内镜像下载 Node LTS 并压缩进安装包，首次启动直接解压使用，无需联网下载 Node。
- **系统 Node 优先**：若系统已装 Node ≥18 则优先复用，内置 Node 作为备用，不干扰已有环境。
- **国内镜像加速**：dsh 安装走 npm 国内镜像，npm 缓存隔离在应用数据目录。
- **与官方功能一致**：HMR、全部 dsh 功能原样保留，桌面只加入口。

### 更新

- **dsh 内核更新**：通过应用菜单「检查 dsh 内核更新」或系统托盘触发，走 npm 在线升级（`@deepseek-ai/dsh`），重启生效。
- **桌面版本更新**：应用菜单与系统托盘检查后引导至 GitHub Release 下载新版安装包覆盖安装。
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

- Node.js >= 18（缺 Node 时自动解压内置 Node 运行时）
- macOS / Windows / Linux

## 本地开发

```sh
pnpm install
pnpm run dev:desktop           # 构建并启动
pnpm run dev:desktop:rebuild   # 强制重建后启动
```

## 许可证

[MIT](./LICENSE)
