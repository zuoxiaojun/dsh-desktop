/** Frameless splash window reporting environment initialization progress. */

import { BrowserWindow, ipcMain } from "electron";
import type { NodeProgress } from "./node-manager.ts";

export interface BootWindow {
  show(): void;
  update(progress: NodeProgress): void;
  showError(message: string): void;
  close(): void;
}

export interface BootWindowOptions {
  readonly desktopVersion: string;
  readonly bootHtmlPath: string;
  readonly bootPreloadPath: string;
}

let retryHandler: (() => void) | undefined;

export function createBootWindow(options: BootWindowOptions): BootWindow {
  const window = new BrowserWindow({
    width: 540,
    height: 420,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    title: "DSH Desktop",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: options.bootPreloadPath,
    },
  });
  window.setMenuBarVisibility(false);
  void window.loadFile(options.bootHtmlPath);

  const onRetry = (): void => {
    retryHandler?.();
  };
  ipcMain.removeAllListeners("dsh-boot:retry");
  ipcMain.on("dsh-boot:retry", onRetry);

  return {
    show() {
      window.show();
    },
    update(progress) {
      if (window.isDestroyed()) return;
      window.webContents.send("dsh-boot:progress", progress);
    },
    showError(message) {
      if (window.isDestroyed()) return;
      window.webContents.send("dsh-boot:error", { message });
    },
    close() {
      ipcMain.removeListener("dsh-boot:retry", onRetry);
      if (!window.isDestroyed()) window.destroy();
    },
  };
}

export function setBootRetryHandler(handler: () => void): void {
  retryHandler = handler;
}
