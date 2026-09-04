/** Electron application shell for the loopback DSH Desktop Web Host. */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "node:process";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
  type Event,
  type MenuItem,
  type MenuItemConstructorOptions,
} from "electron";
import {
  createHostSupervisor,
  spawnDshWeb,
  type HostSupervisor,
} from "./host-supervisor.ts";
import {
  checkDshUpdate,
  ensureManagedDsh,
  hostPathFor,
  installDshUpdate,
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
const GITHUB_REPO = "zuoxiaojun/dsh-desktop";
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
let DSH_LATEST: string | undefined;
let DSH_UPDATE_AVAILABLE = false;
let APP_UPDATE_AVAILABLE = false;
let APP_LATEST: string | undefined;
let APP_UPDATE_URL: string | undefined;
let dshUpdateMenuItem: MenuItem | undefined;
let bootNode: NodeInfo | undefined;
let bootUserDataDir: string | undefined;

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

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

async function checkAppUpdate(force: boolean): Promise<void> {
  try {
    const res = await fetch(
      "https://api.github.com/repos/" + GITHUB_REPO + "/releases/latest",
      {
        signal: AbortSignal.timeout(6000),
        headers: {
          "User-Agent": "dsh-desktop",
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!res.ok) {
      if (force) {
        await dialog.showMessageBox({
          type: "info",
          title: APP_NAME,
          message: "检查应用更新失败",
          detail: "GitHub 返回 HTTP " + String(res.status),
        });
      }
      return;
    }
    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    const latest = (data.tag_name ?? "").replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+/.test(latest)) return;
    const newer = compareVersions(latest, DESKTOP_VERSION) > 0;
    if (newer) {
      APP_UPDATE_AVAILABLE = true;
      APP_LATEST = latest;
      APP_UPDATE_URL = data.html_url;
      const { response } = await dialog.showMessageBox({
        type: "info",
        title: APP_NAME + " 有更新",
        message: "发现新版本 v" + latest,
        detail: "当前版本 v" + DESKTOP_VERSION + "\n是否前往 GitHub 下载新版本？",
        buttons: ["去下载", "暂不安装"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0 && APP_UPDATE_URL) void shell.openExternal(APP_UPDATE_URL);
    } else if (force) {
      await dialog.showMessageBox({
        type: "info",
        title: APP_NAME,
        message: "当前已是最新版本 v" + DESKTOP_VERSION,
      });
    }
  } catch {
    if (force) {
      await dialog.showMessageBox({
        type: "info",
        title: APP_NAME,
        message: "检查应用更新失败，请检查网络连接",
      });
    }
  }
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

  // 用户点击「检查 dsh 内核更新」→ 手动安装 dsh 最新版（主进程菜单 / 托盘 / IPC 共用逻辑）
  ipcMain.handle("dsh-desktop:update-dsh", async () => {
    const result = await performDshUpdate();
    if (result.ok && result.version) {
      await dialog.showMessageBox({
        type: "info",
        title: "dsh 更新",
        message: "dsh 已更新到 v" + result.version,
        detail: "重启客户端后生效。",
        buttons: ["好的"],
        defaultId: 0,
      });
    }
    return result;
  });

  // 用户点击「检查桌面版更新」→ 手动检查桌面版新版本（GitHub Release）
  ipcMain.handle("dsh-desktop:check-app-update", () => {
    void checkAppUpdate(true);
    return { ok: true };
  });
}

function dshUpdateLabel(): string {
  return DSH_UPDATE_AVAILABLE && DSH_LATEST !== undefined
    ? `检查 dsh 内核更新 (v${DSH_LATEST})`
    : "检查 dsh 内核更新";
}

function refreshAboutPanel(): void {
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: DESKTOP_VERSION,
    version: DESKTOP_VERSION,
    copyright: "Built by zuoxiaojun",
    credits: DSH_VERSION ? `dsh ${DSH_VERSION}` : "dsh 未安装",
  });
}

function showAboutDialog(): void {
  refreshAboutPanel();
  app.showAboutPanel();
}

async function performDshUpdate(): Promise<{
  ok: boolean;
  version?: string;
  error?: string;
  alreadyLatest?: boolean;
}> {
  if (!bootNode || !bootUserDataDir) {
    return { ok: false, error: "not-ready" };
  }
  let available = false;
  try {
    available = (await checkDshUpdate(bootUserDataDir)).available;
  } catch {
    // 无法确认版本时按「已是最新」处理（fail-open，不误报失败）
    available = false;
  }
  if (!available) {
    return { ok: true, alreadyLatest: true };
  }
  try {
    const newVersion = await installDshUpdate({
      node: bootNode,
      userDataDir: bootUserDataDir,
    });
    if (newVersion === undefined) {
      return { ok: false, error: "update-failed" };
    }
    DSH_UPDATE_AVAILABLE = false;
    DSH_LATEST = newVersion;
    DSH_VERSION = newVersion;
    refreshAboutPanel();
    return { ok: true, version: newVersion };
  } catch {
    return { ok: false, error: "update-failed" };
  }
}

async function menuCheckDshUpdate(): Promise<void> {
  const result = await performDshUpdate();
  if (result.alreadyLatest) {
    await dialog.showMessageBox({
      type: "info",
      title: "dsh 更新",
      message: "dsh 已是最新版本",
    });
  } else if (result.ok && result.version) {
    await dialog.showMessageBox({
      type: "info",
      title: "dsh 更新",
      message: `dsh 已更新到 v${result.version}`,
      detail: "重启客户端后生效。",
      buttons: ["好的"],
      defaultId: 0,
    });
  } else if (result.error === "not-ready") {
    await dialog.showMessageBox({
      type: "info",
      title: "dsh 更新",
      message: "dsh 尚未就绪，请稍后重试",
    });
  } else {
    await dialog.showMessageBox({
      type: "info",
      title: "dsh 更新",
      message: "dsh 更新失败，请检查网络连接",
    });
  }
}

function findMenuItemById(
  menu: Menu,
  id: string,
): MenuItem | undefined {
  for (const item of menu.items) {
    if (item.id === id) return item;
    if (item.submenu) {
      const found = findMenuItemById(item.submenu, id);
      if (found) return found;
    }
  }
  return undefined;
}

function refreshDshUpdateMenuItem(): void {
  if (dshUpdateMenuItem === undefined) return;
  const label = dshUpdateLabel();
  refreshAboutPanel();
  dshUpdateMenuItem.label = label;
}

function buildApplicationMenu(): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [];
  if (isMac) {
    template.push({
      label: APP_NAME,
      submenu: [
        { label: `关于 ${APP_NAME}`, click: () => showAboutDialog() },
        { type: "separator" },
        {
          id: "dsh-update-item",
          label: dshUpdateLabel(),
          click: () => void menuCheckDshUpdate(),
        },
        {
          label: "检查桌面版更新",
          click: () => void checkAppUpdate(true),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
    template.push({ role: "fileMenu" });
    template.push({ role: "editMenu" });
    template.push({ role: "viewMenu" });
    template.push({ role: "windowMenu" });
  } else {
    template.push({ role: "fileMenu" });
    template.push({ role: "editMenu" });
    template.push({ role: "viewMenu" });
    template.push({ role: "windowMenu" });
    template.push({
      label: "帮助",
      submenu: [
        { label: `关于 ${APP_NAME}`, click: () => showAboutDialog() },
        { type: "separator" },
        {
          id: "dsh-update-item",
          label: dshUpdateLabel(),
          click: () => void menuCheckDshUpdate(),
        },
        {
          label: "检查桌面版更新",
          click: () => void checkAppUpdate(true),
        },
      ],
    });
  }
  const menu = Menu.buildFromTemplate(template);
  dshUpdateMenuItem = findMenuItemById(menu, "dsh-update-item");
  Menu.setApplicationMenu(menu);
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
      sandbox: false,
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
      label: "检查 dsh 内核更新",
      click: () => {
        void menuCheckDshUpdate();
      },
    },
    {
      label: "检查应用更新",
      click: () => {
        void checkAppUpdate(true);
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
  bootNode = node;
  bootUserDataDir = userDataDir;

  // 阶段二：受管安装 dsh（首次联网拉取，走国内镜像）
  const dshEntry = await ensureManagedDsh({
    node,
    userDataDir,
    onProgress,
    signal,
  });

  // 阶段三：Host 监督模型启动 dsh web
  // 打包后 .app 的 PATH 只有系统最小集，dsh 插件 marketplace 会 spawnSync("pnpm")——
  // 注入完整 PATH（受管 pnpm bin + node bin + 系统路径 + 原 PATH）
  const pnpmBin = join(userDataDir, "tools", "pnpm", "node_modules", ".bin");
  host = createHostSupervisor({
    spawnHost: () =>
      spawnDshWeb({
        nodeExecutable: node.executable,
        dshEntry,
        cwd: env.HOME || process.cwd(),
        env: {
          ...env,
          DSH_DESKTOP: "1",
          PATH: hostPathFor(
            node,
            existsSync(pnpmBin) ? pnpmBin : undefined,
            process.platform as NodeJS.Platform,
            { PATH: env.PATH },
          ),
        },
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
  refreshAboutPanel();
  buildApplicationMenu();

  bootWindow.close();
  bootWindow = undefined;
  createTray();
  await lifecycle.showWindow();

  // 非阻塞：启动后异步检查 dsh 是否有更新（不阻塞启动、不自动安装），用于「检查更新」菜单项
  void checkDshUpdate(userDataDir)
    .then(({ available, latest }) => {
      DSH_UPDATE_AVAILABLE = available;
      DSH_LATEST = latest;
      refreshDshUpdateMenuItem();
    })
    .catch(() => {
      /* ignore */
    });

  // 非阻塞：启动后异步检查应用本身的新版本（GitHub Release），有新版弹窗提示下载
  void checkAppUpdate(false);
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
