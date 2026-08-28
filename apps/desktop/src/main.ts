/** Electron application shell for the loopback DSH Desktop Web Host. */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  spawnDshWeb,
  type HostSupervisor,
} from "./host-supervisor.ts";
import {
  ensureManagedDsh,
  readManagedDshVersion,
  resolveNode,
  type NodeInfo,
  type NodeProgress,
  type NodeVersionsConfig,
} from "./node-manager.ts";
import {
  createBootWindow,
  setBootRetryHandler,
  type BootWindow,
} from "./boot-window.ts";
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
let bootWindow: BootWindow | undefined;
let abortController: AbortController | undefined;
let nodeInfo: NodeInfo | undefined;
let ipcRegistered = false;

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

const DESKTOP_VERSION = readDesktopVersion();
let DSH_VERSION: string | undefined;

const NODE_VERSIONS: NodeVersionsConfig = (() => {
  try {
    return JSON.parse(
      readFileSync(join(DESKTOP_DIR, "resources/node-versions.json"), "utf8"),
    ) as NodeVersionsConfig;
  } catch (error) {
    throw new Error(`node-versions.json missing or invalid: ${String(error)}`);
  }
})();

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
  const desktopText = JSON.stringify(`DSH Desktop v${DESKTOP_VERSION}`);
  const dshText = DSH_VERSION ? JSON.stringify(`dsh v${DSH_VERSION}`) : "null";
  win.webContents
    .executeJavaScript(
      `(()=>{const ID="dsh-desktop-version";const SID="dsh-desktop-version-style";const render=()=>{if(document.getElementById(ID))return;if(!document.getElementById(SID)){const s=document.createElement("style");s.id=SID;s.textContent="#dsh-desktop-version{position:fixed;bottom:8px;right:12px;padding:4px 10px;font-size:11px;line-height:1.5;color:#888;background:rgba(0,0,0,0.06);border-radius:6px;z-index:9999;pointer-events:none;user-select:none;font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:right}";document.head.appendChild(s);}const d=document.createElement("div");d.id=ID;d.appendChild(document.createTextNode(${desktopText}));const dsh=${dshText};if(dsh){d.appendChild(document.createElement("br"));d.appendChild(document.createTextNode(dsh));}d.appendChild(document.createElement("br"));d.appendChild(document.createTextNode("Built by leftxiaojun"));document.body.appendChild(d);};render();const prev=window.__dshVersionObserver__;if(prev)prev.disconnect();const o=new MutationObserver(render);window.__dshVersionObserver__=o;o.observe(document.body,{childList:true,subtree:true});})()`,
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
  window.on("page-title-updated", (event) => {
    event.preventDefault();
  });
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
  window.webContents.on("did-navigate-in-page", () => {
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

  const bootHtml = join(DESKTOP_DIR, "resources/boot.html");
  const bootPreload = join(DESKTOP_DIR, "lib/boot-preload.mjs");
  if (bootWindow === undefined) {
    bootWindow = createBootWindow({
      desktopVersion: DESKTOP_VERSION,
      bootHtmlPath: bootHtml,
      bootPreloadPath: bootPreload,
    });
  }
  bootWindow.show();

  abortController = new AbortController();
  const signal = abortController.signal;
  const userDataDir = app.getPath("userData");

  setBootRetryHandler(() => {
    void (async () => {
      if (host !== undefined) {
        const previous = host;
        host = undefined;
        await previous.shutdown().catch(() => undefined);
      }
      await boot().catch(handleBootError);
    })();
  });

  const onProgress = (p: NodeProgress): void => {
    bootWindow?.update(p);
  };

  // 阶段一：解析 Node（系统 Node ≥18 优先，否则受管安装 v24 LTS）
  const node = await resolveNode({
    userDataDir,
    config: NODE_VERSIONS,
    onProgress,
    signal,
  });
  nodeInfo = node;

  // 阶段二：受管安装 dsh（首次联网拉取，走国内镜像）
  const dshEntry = await ensureManagedDsh({
    node,
    userDataDir,
    onProgress,
    signal,
  });

  // 阶段三：Host 监督模型启动 dsh web
  host = createHostSupervisor({
    spawnHost: () =>
      spawnDshWeb({
        nodeExecutable: node.executable,
        dshEntry,
        cwd: env.HOME || process.cwd(),
        env: { ...env, DSH_DESKTOP: "1" },
      }),
    log: (chunk) => process.stderr.write(chunk),
    onUnexpectedExit: ({ code, signal: sig }) => {
      console.error(
        `desktop Host exited unexpectedly (code ${String(code)}, signal ${String(sig)})`,
      );
      void requestAppQuit();
    },
  });

  if (!ipcRegistered) {
    hardenSession();
    registerIpcHandlers();
    ipcRegistered = true;
  }

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

  bootWindow.update({ stage: "installing-dsh", detail: "正在启动 dsh…" });
  await host.start();

  DSH_VERSION = readManagedDshVersion(userDataDir);

  bootWindow.close();
  bootWindow = undefined;
  createTray();
  await lifecycle.showWindow();
}

async function handleBootError(error: unknown): Promise<void> {
  console.error("desktop startup failed:", error);
  if (bootWindow !== undefined) {
    const message = error instanceof Error ? error.message : String(error);
    bootWindow.showError(message);
    return;
  }
  const { dialog } = await import("electron");
  await dialog.showMessageBox({
    type: "error",
    title: `${APP_NAME} failed to start`,
    message: error instanceof Error ? error.message : String(error),
  });
  await requestAppQuit();
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
    abortController?.abort();
    void requestAppQuit();
  });
  app
    .whenReady()
    .then(boot)
    .catch((error: unknown) => {
      void handleBootError(error);
    });
}
