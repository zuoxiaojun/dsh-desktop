/** Sandboxed renderer bridge: fixed methods only, no generic IPC escape hatch. */

import { contextBridge, ipcRenderer } from "electron";

/** Bridge API exposed to the renderer. */
export interface DesktopBridge {
  readonly platform: NodeJS.Platform;
  readonly versions: Promise<{ desktop: string; dsh: string | undefined }>;
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
  workspace: Object.freeze({
    pickDirectory: () =>
      ipcRenderer.invoke("dsh-desktop:workspace:pick-directory") as Promise<
        string | null
      >,
  }),
});

contextBridge.exposeInMainWorld("dshDesktop", bridge);