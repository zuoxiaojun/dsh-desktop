/** Boot splash bridge: fixed methods only, no generic IPC escape hatch. */

import { contextBridge, ipcRenderer } from "electron";
import type { NodeProgress } from "./node-manager.ts";

/** Bridge API exposed to the boot splash renderer. */
export interface BootBridge {
  onProgress(callback: (progress: NodeProgress) => void): () => void;
  onError(callback: (error: { message: string }) => void): () => void;
  retry(): void;
}

const bridge: BootBridge = {
  onProgress(callback) {
    const listener = (_e: unknown, progress: NodeProgress): void => {
      callback(progress);
    };
    ipcRenderer.on("dsh-boot:progress", listener);
    return () => {
      ipcRenderer.off("dsh-boot:progress", listener);
    };
  },
  onError(callback) {
    const listener = (_e: unknown, error: { message: string }): void => {
      callback(error);
    };
    ipcRenderer.on("dsh-boot:error", listener);
    return () => {
      ipcRenderer.off("dsh-boot:error", listener);
    };
  },
  retry() {
    ipcRenderer.send("dsh-boot:retry");
  },
};

Object.freeze(bridge);

contextBridge.exposeInMainWorld("dshBoot", bridge);
