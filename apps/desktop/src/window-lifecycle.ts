/** Desktop window and application lifetime. */

/** Private command-line signal used by the Windows installer before replacing application files. */
export const INSTALLER_QUIT_ARGUMENT = "--dsh-installer-quit";

/** Identify an installer-owned quit request. */
export function isInstallerQuitRequest(
  commandLine: readonly string[],
): boolean {
  return commandLine.includes(INSTALLER_QUIT_ARGUMENT);
}

/** Minimal close event accepted by the desktop lifecycle. */
interface WindowCloseEvent {
  preventDefault(): void;
}

/** Window operations owned by the desktop lifecycle. */
export interface DesktopWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  show(): void;
  focus(): void;
  hide(): void;
}

/** Dependencies supplied by the Electron main process. */
export interface DesktopLifecycleOptions {
  readonly getWindow: () => DesktopWindow | undefined;
  readonly createWindow: () => Promise<DesktopWindow>;
  readonly loadHost: (
    window: DesktopWindow,
    origin: string,
    primaryPage?: string,
  ) => Promise<void>;
  readonly disposeHost: () => Promise<void>;
  readonly quit: () => void;
  readonly reportError?: (error: unknown) => void;
}

/** Public controller for close, restore and explicit quit events. */
export interface DesktopLifecycle {
  readonly isQuitting: boolean;
  readonly pendingQuit: Promise<void> | undefined;
  onWindowClose(event: WindowCloseEvent): void;
  showWindow(): Promise<void>;
  reloadHost(origin: string, primaryPage?: string): Promise<void>;
  requestQuit(): Promise<void>;
}

/** Create the desktop application lifecycle. */
export function createDesktopLifecycle(
  options: DesktopLifecycleOptions,
): DesktopLifecycle {
  let quitting = false;
  let pendingQuit: Promise<void> | undefined;
  let creatingWindow: Promise<DesktopWindow> | undefined;

  const showWindow = async (): Promise<void> => {
    if (quitting) return;
    let window = options.getWindow();
    if (window === undefined || window.isDestroyed()) {
      creatingWindow ??= options.createWindow().finally(() => {
        creatingWindow = undefined;
      });
      window = await creatingWindow;
    }
    if (!window.isVisible()) window.show();
    window.focus();
  };

  const requestQuit = (): Promise<void> => {
    if (pendingQuit !== undefined) return pendingQuit;
    quitting = true;
    pendingQuit = options
      .disposeHost()
      .catch((error: unknown) => {
        options.reportError?.(error);
      })
      .then(() => {
        options.quit();
      });
    return pendingQuit;
  };

  const reloadHost = async (
    origin: string,
    primaryPage?: string,
  ): Promise<void> => {
    if (quitting) return;
    const window = options.getWindow();
    if (window === undefined || window.isDestroyed()) return;
    await options.loadHost(window, origin, primaryPage);
  };

  return {
    get isQuitting() {
      return quitting;
    },
    get pendingQuit() {
      return pendingQuit;
    },
    onWindowClose(event) {
      if (quitting) return;
      event.preventDefault();
      options.getWindow()?.hide();
    },
    showWindow,
    reloadHost,
    requestQuit,
  };
}
