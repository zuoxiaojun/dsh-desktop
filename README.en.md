# DSH Desktop

<p align="center">
  <img src="https://img.shields.io/badge/Desktop-App-2563EB" alt="Desktop App">
  <img src="https://img.shields.io/badge/Electron-Desktop-47848F?logo=electron&logoColor=white" alt="Electron Desktop">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/deepseek-ai/deepseek-harness?color=22C55E" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows-supported-3B82F6" alt="macOS and Windows">
</p>

<p align="center">DSH Desktop is a desktop client for <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>, providing a complete Electron desktop experience.</p>

## Features

DSH Desktop extends the DeepSeek Harness Web workspace with desktop-native capabilities:

- **System tray** — stay alive in the background after closing the window
- **Plugin Center** — browse, search, install, and manage DSH plugins
- **Preset Square** — one-click installation of Agent Preset workflows
- **Application Center** — full AI applications with dedicated UI and data
- **Theme skins** — multiple built-in backgrounds with custom support
- **Vision enhancement** — auto-route images to compatible vision models
- **Auto updates** — silent check and download of updates
- **Native window** — macOS vibrancy, Windows acrylic, Linux support

## Quick Start

### Prerequisites

- Node.js `^22.19.0 || >=24.0.0`
- pnpm `11.7.0`

### Install and Run

```sh
git clone <your-repo-url>
cd dsh-desktop
pnpm install
pnpm run dev:desktop
```

The first run automatically builds the required modules and opens the Electron desktop window.

### Package

```sh
pnpm run package:desktop   # unpacked directory for the current platform
pnpm run dist:mac          # macOS DMG + ZIP
pnpm run dist:win          # Windows NSIS installer
```

## Directory Structure

```text
dsh-desktop/
├── apps/
│   ├── desktop/     # Electron main process, preload, Host lifecycle
│   ├── web/         # Web workspace frontend
│   └── cli/         # dsh CLI
├── packages/        # Agent, model, tool, session, plugin capability packages
├── vendor/          # Cordis framework
├── native/          # Native modules
├── python/          # Python SDK
└── scripts/         # Build and check scripts
```

## Architecture

DSH Desktop uses a three-layer architecture:

```
Electron main process ←→ child process (dsh web) ←→ Web renderer
```

- **Electron main process**: manages windows, tray, plugin installation, updates
- **dsh web child process**: runs the Harness core logic
- **Web renderer**: sandboxed user interface

## Development Commands

| Command | Purpose |
| --- | --- |
| `pnpm run dev:desktop` | Build and launch the desktop app |
| `pnpm run dev:desktop:rebuild` | Force full rebuild then launch |
| `pnpm run build` | Build all modules |
| `pnpm run typecheck` | Type checking |
| `pnpm run test` | Run tests |

## License

[MIT](LICENSE)
