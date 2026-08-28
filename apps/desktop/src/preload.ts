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

// ---------------------------------------------------------------------------
// Version badge — inject directly into the page DOM.
// Preload runs in the renderer process, so we have full DOM access.
// Uses MutationObserver to survive SPA page navigation.
// ---------------------------------------------------------------------------

function injectVersionBadge(): void {
  // If we already have a badge, nothing to do
  if (document.getElementById("dsh-desktop-version")) return;

  bridge.versions.then((v) => {
    if (document.getElementById("dsh-desktop-version")) return;
    // Inject CSS
    const style = document.createElement("style");
    style.textContent =
      "#dsh-desktop-version{position:fixed;bottom:8px;right:12px;padding:4px 10px;font-size:11px;line-height:1.5;color:#888;background:rgba(0,0,0,0.06);border-radius:6px;z-index:9999;pointer-events:none;user-select:none;font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:right}";
    document.head.appendChild(style);

    // Create badge
    const el = document.createElement("div");
    el.id = "dsh-desktop-version";
    const line1 = document.createTextNode("DSH Desktop v" + v.desktop);
    el.appendChild(line1);
    el.appendChild(document.createElement("br"));
    if (v.dsh) {
      el.appendChild(document.createTextNode("dsh v" + v.dsh));
    }
    document.body.appendChild(el);
  });
}

// Watch for DOM changes — if the SPA replaces the whole body, re-inject
const observer = new MutationObserver(() => {
  if (!document.getElementById("dsh-desktop-version")) injectVersionBadge();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    observer.observe(document.body, { childList: true, subtree: true });
    injectVersionBadge();
  });
} else {
  observer.observe(document.body, { childList: true, subtree: true });
  injectVersionBadge();
}