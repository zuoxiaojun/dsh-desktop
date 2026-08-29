/** Sandboxed renderer bridge: fixed methods only, no generic IPC escape hatch. */

import { contextBridge, ipcRenderer } from "electron";

/** Bridge API exposed to the renderer. */
export interface DesktopBridge {
  readonly platform: NodeJS.Platform;
  readonly versions: Promise<{ desktop: string; dsh: string | undefined }>;
  readonly dsh: {
    update(): Promise<{ ok: boolean; version?: string; error?: string }>;
  };
  readonly desktopUpdate: {
    check(): Promise<{ ok: boolean }>;
  };
  readonly workspace: {
    pickDirectory(): Promise<string | null>;
  };
}

const bridge: DesktopBridge = Object.freeze({
  platform: process.platform,
  versions: ipcRenderer.invoke("dsh-desktop:get-versions") as Promise<{
    desktop: string;
    dsh: string | undefined;
  }>,
  dsh: Object.freeze({
    update: () =>
      ipcRenderer.invoke("dsh-desktop:update-dsh") as Promise<{
        ok: boolean;
        version?: string;
        error?: string;
      }>,
  }),
  desktopUpdate: Object.freeze({
    check: () =>
      ipcRenderer.invoke("dsh-desktop:check-app-update") as Promise<{
        ok: boolean;
      }>,
  }),
  workspace: Object.freeze({
    pickDirectory: () =>
      ipcRenderer.invoke("dsh-desktop:workspace:pick-directory") as Promise<
        string | null
      >,
  }),
});

contextBridge.exposeInMainWorld("dshDesktop", bridge);
