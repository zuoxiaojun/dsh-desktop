/** Electron application shell for the loopback DSH Desktop Web Host. */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { env } from "node:process";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
  type Event,
  type MenuItemConstructorOptions,
} from "electron";
import {
  createHostSupervisor,
  type HostSupervisor,
  type HostChild,
} from "./host-supervisor.ts";
import {
  createDesktopLifecycle,
  isInstallerQuitRequest,
  type DesktopLifecycle,
} from "./window-lifecycle.ts";

const APP_NAME = "DSH Desktop";
const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 920;
const DESKTOP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let host: HostSupervisor | undefined;
let lifecycle: DesktopLifecycle | undefined;
let bootQuitPromise: Promise<void> | undefined;
let quitReleased = false;

function readDesktopVersion(): string {
  try {
    const v = JSON.parse(
      readFileSync(join(DESKTOP_DIR, "resources/version.json"), "utf8"),
    );
    return v.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readDshVersion(): string | undefined {
  const dshEntry = resolveDshEntry();
  if (dshEntry === undefined) return undefined;
  try {
    const pkg = JSON.parse(
      readFileSync(join(dirname(dshEntry), "../../package.json"), "utf8"),
    );
    return pkg.version;
  } catch {
    return undefined;
  }
}

const DESKTOP_VERSION = readDesktopVersion();
const DSH_VERSION = readDshVersion();

function resolveDshEntry(): string | undefined {
  // 打包后: Electron.app/Contents/Resources/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js
  // 开发时: apps/desktop/resources/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js
  const candidates = [
    // 生产环境 (process.resourcesPath 在打包后指向 app.asar 解压目录)
    ...(process.resourcesPath
      ? [
          join(
            process.resourcesPath,
            "dsh/node_modules/@deepseek-ai/dsh/lib/bin.js",
          ),
        ]
      : []),
    // 开发环境
    join(DESKTOP_DIR, "resources/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

function spawnDshWeb(): HostChild {
  // 优先使用 Electron 自带的 Node.js 运行捆绑的 dsh
  const dshEntry = resolveDshEntry();

  if (dshEntry !== undefined) {
    const child = spawn(
      process.execPath,
      [
        "--expose-internals",
        dshEntry,
        "web",
        "--no-open",
        "--host",
        "127.0.0.1",
        "--port",
        "0",
      ],
      {
        cwd: env.HOME || process.cwd(),
        env: { ...env, DSH_DESKTOP: "1", ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    return adaptChild(child);
  }

  // 兜底：通过 npx 运行（用户需自行安装 Node.js + dsh）
  const child = spawn(
    "npx",
    [
      "@deepseek-ai/dsh",
      "web",
      "--no-open",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
    ],
    {
      cwd: env.HOME || process.cwd(),
      env: { ...env, DSH_DESKTOP: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  return adaptChild(child);
}

function adaptChild(
  child: import("node:child_process").ChildProcess,
): HostChild {
  return {
    pid: child.pid ?? undefined,
    stdout: {
      onData: (listener) => {
        const handler = (chunk: string | Buffer) => listener(chunk.toString());
        child.stdout?.on("data", handler);
        return () => child.stdout?.off("data", handler);
      },
    },
    stderr: {
      onData: (listener) => {
        const handler = (chunk: string | Buffer) => listener(chunk.toString());
        child.stderr?.on("data", handler);
        return () => child.stderr?.off("data", handler);
      },
    },
    onExit: (listener) => {
      child.on("exit", listener);
      return () => child.off("exit", listener);
    },
    onError: (listener) => {
      child.on("error", listener);
      return () => child.off("error", listener);
    },
    kill: (signal) => child.kill(signal),
  };
}

function currentHostOrigin(): string | undefined {
  return host?.current?.origin;
}

function isExternalUrl(raw: string): boolean {
  try {
    return (
      new URL(raw).protocol === "http:" || new URL(raw).protocol === "https:"
    );
  } catch {
    return false;
  }
}

function hasOrigin(raw: string, expected: string): boolean {
  try {
    return new URL(raw).origin === expected;
  } catch {
    return false;
  }
}

function desktopRendererUrl(origin: string): string {
  try {
    const url = new URL(origin);
    url.searchParams.set("dsh-desktop-platform", process.platform);
    return url.href;
  } catch {
    return origin;
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle("dsh-desktop:get-versions", () => ({
    desktop: DESKTOP_VERSION,
    dsh: DSH_VERSION,
  }));
}

function injectVersionBadge(win: BrowserWindow): void {
  const html = DSH_VERSION
    ? `DSH Desktop v${DESKTOP_VERSION}<br>dsh v${DSH_VERSION}`
    : `DSH Desktop v${DESKTOP_VERSION}`;
  win.webContents
    .executeJavaScript(
      `(()=>{const e=document.createElement("div");e.id="dsh-desktop-version";e.style.cssText="position:fixed;bottom:8px;right:12px;padding:4px 10px;font-size:11px;line-height:1.5;color:#888;background:rgba(0,0,0,0.06);border-radius:6px;z-index:9999;pointer-events:none;user-select:none;font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:right";e.innerHTML=${JSON.stringify(html)};document.body.appendChild(e)})()`,
    )
    .catch(() => {
      /* ignore */
    });
}

function hardenSession(): void {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => {
    cb(false);
  });
}

function loadIcon(): Electron.NativeImage {
  try {
    const svg = readFileSync(join(DESKTOP_DIR, "resources/icon.svg"), "utf8");
    const img = nativeImage.createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    );
    if (!img.isEmpty()) return img;
  } catch {
    /* fallback */
  }
  return nativeImage.createEmpty();
}

async function createMainWindow(): Promise<BrowserWindow> {
  const origin = currentHostOrigin();
  if (origin === undefined) throw new Error("desktop Host is not ready");

  const icon = loadIcon();

  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: icon.isEmpty() ? undefined : icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: join(DESKTOP_DIR, "lib/preload.mjs"),
    },
  });

  mainWindow = window;
  window.on("close", (event) => {
    lifecycle?.onWindowClose(event);
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  window.webContents.on("will-navigate", (event, url) => {
    const o = currentHostOrigin();
    if (o !== undefined && hasOrigin(url, o)) return;
    event.preventDefault();
    if (isExternalUrl(url)) void shell.openExternal(url);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("did-finish-load", () => {
    injectVersionBadge(window);
  });

  await window.loadURL(desktopRendererUrl(origin));
  if (!lifecycle?.isQuitting) window.show();
  return window;
}

function createTray(): void {
  const icon = loadIcon();
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(APP_NAME);
  const template: MenuItemConstructorOptions[] = [
    {
      label: "打开主窗口",
      click: () => {
        void lifecycle?.showWindow();
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        void requestAppQuit();
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.on("click", () => {
    void lifecycle?.showWindow();
  });
}

function releaseAppQuit(): void {
  quitReleased = true;
  tray?.destroy();
  tray = undefined;
  app.quit();
}

function requestAppQuit(): Promise<void> {
  if (lifecycle !== undefined) return lifecycle.requestQuit();
  bootQuitPromise ??= (host?.shutdown() ?? Promise.resolve())
    .catch((e) => {
      console.error("desktop shutdown failed:", e);
    })
    .then(() => {
      releaseAppQuit();
    });
  return bootQuitPromise;
}

async function boot(): Promise<void> {
  if (bootQuitPromise !== undefined) return;

  host = createHostSupervisor({
    spawnHost: spawnDshWeb,
    log: (chunk) => process.stderr.write(chunk),
    onUnexpectedExit: ({ code, signal }) => {
      console.error(
        `desktop Host exited unexpectedly (code ${String(code)}, signal ${String(signal)})`,
      );
      void requestAppQuit();
    },
  });

  hardenSession();
  registerIpcHandlers();

  lifecycle = createDesktopLifecycle({
    getWindow: () => mainWindow,
    createWindow: createMainWindow,
    loadHost: async (w, o) => {
      await (w as BrowserWindow).loadURL(desktopRendererUrl(o));
    },
    disposeHost: async () => {
      await host?.shutdown();
    },
    quit: releaseAppQuit,
    reportError: (e) => {
      console.error("desktop shutdown failed:", e);
    },
  });

  await host.start();
  createTray();
  await lifecycle.showWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else if (isInstallerQuitRequest(process.argv)) {
  app.quit();
} else {
  app.on("second-instance", (_e, cl) => {
    if (isInstallerQuitRequest(cl)) {
      void requestAppQuit();
      return;
    }
    void lifecycle?.showWindow();
  });
  app.on("activate", () => {
    void lifecycle?.showWindow();
  });
  app.on("window-all-closed", () => {});
  app.on("before-quit", (event: Event) => {
    if (quitReleased) return;
    event.preventDefault();
    void requestAppQuit();
  });
  app
    .whenReady()
    .then(boot)
    .catch(async (error: unknown) => {
      console.error("desktop startup failed:", error);
      if (bootQuitPromise === undefined) {
        const { dialog } = await import("electron");
        await dialog.showMessageBox({
          type: "error",
          title: `${APP_NAME} failed to start`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      await requestAppQuit();
    });
}
