/** Electron application shell for the loopback DSH Desktop Web Host. */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { env } from "node:process";
import {
  app,
  BrowserWindow,
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

function spawnDshWeb(): HostChild {
  const dshCommand = process.env.DSH_CLI ?? "npx";
  const dshArgs = process.env.DSH_CLI
    ? ["web", "--no-open", "--host", "127.0.0.1", "--port", "0"]
    : [
        "@deepseek-ai/dsh",
        "web",
        "--no-open",
        "--host",
        "127.0.0.1",
        "--port",
        "0",
      ];

  const child = spawn(dshCommand, dshArgs, {
    cwd: env.HOME || process.cwd(),
    env: { ...env, DSH_DESKTOP: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

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

// CSS injected into the web page to:
// 1. Push sidebar content below macOS traffic lights
// 2. Make the window draggable from the page
// 3. Keep all interactive elements clickable
// Make the page draggable; keep interactive elements clickable
const DESKTOP_CSS = `
  html { -webkit-app-region: drag; }
  button, input, a, select, textarea,
  [role="button"], [contenteditable],
  .cm-editor, .cm-content {
    -webkit-app-region: no-drag !important;
  }
`;

async function createMainWindow(): Promise<BrowserWindow> {
  const origin = currentHostOrigin();
  if (origin === undefined) throw new Error("desktop Host is not ready");

  const isMac = process.platform === "darwin";
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
    frame: false,
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 18 },
        }
      : {
          titleBarOverlay: {
            color: "#00000000",
            symbolColor: "#7f858f",
            height: 44,
          },
        }),
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
    void window.webContents.insertCSS(DESKTOP_CSS);
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
