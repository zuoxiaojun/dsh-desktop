/** Supervise the loopback Web Host used by the desktop application. */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

const READINESS_PREFIX = "dsh web: ";
const DEFAULT_READINESS_TIMEOUT_MS = 90_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const MAX_STARTUP_OUTPUT_CHARS = 32_768;

/** Incremental parser for the Web Host's canonical readiness line. */
export interface ReadinessParser {
  push(chunk: string): string | undefined;
  finalize(): string;
}

/**
 * Assert one readiness line and return the URL to load.
 *
 * The security property is that the Host is reachable only on a loopback HTTP
 * port it chose: anything remote is rejected, so the shell can never be pointed
 * at another origin by a rogue child. Path and query are deliberately *not*
 * constrained. dsh 0.1.2-rc.1 appends a session credential to the readiness
 * URL (`/?token=...`); normalizing the line to a bare origin silently dropped
 * it, and a stripped token cannot be recovered later because the port is
 * ephemeral. So the full href is the load target, and the loopback origin
 * derived from it stays the authorization boundary for navigation checks.
 */
function parseReadinessLine(line: string): string | undefined {
  if (!line.startsWith(READINESS_PREFIX)) return undefined;
  const token = line.slice(READINESS_PREFIX.length).split(/\s/u, 1)[0];
  if (token === undefined)
    throw new Error(`desktop Host readiness line has no URL: ${line}`);

  let url: URL;
  try {
    url = new URL(token);
  } catch {
    throw new Error(`desktop Host readiness URL is invalid: ${token}`);
  }
  const port = Number(url.port);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error(
      `desktop Host readiness URL must be loopback HTTP with an explicit port: ${token}`,
    );
  }
  return url.href;
}

/** Loopback origin of a Host URL, the boundary navigation is checked against. */
export function hostOriginOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** Create a line parser whose result is stable after readiness. */
export function createReadinessParser(): ReadinessParser {
  let pending = "";
  let readyUrl: string | undefined;

  const accept = (line: string): string | undefined => {
    const parsed = parseReadinessLine(line.replace(/\r$/u, ""));
    if (parsed === undefined) return undefined;
    if (readyUrl !== undefined && parsed !== readyUrl) {
      throw new Error(
        `desktop Host emitted conflicting readiness URLs: ${readyUrl} and ${parsed}`,
      );
    }
    readyUrl = parsed;
    return readyUrl;
  };

  return {
    push(chunk) {
      pending += chunk;
      for (;;) {
        const newline = pending.indexOf("\n");
        if (newline === -1) return readyUrl;
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        const parsed = accept(line);
        if (parsed !== undefined) return parsed;
      }
    },
    finalize() {
      if (pending !== "") accept(pending);
      if (readyUrl === undefined)
        throw new Error(
          "desktop Host exited before emitting its readiness URL",
        );
      return readyUrl;
    },
  };
}

/** Child process operations the supervisor owns. */
export interface HostChild {
  readonly pid?: number;
  readonly stdout: { onData(listener: (chunk: string) => void): () => void };
  readonly stderr: { onData(listener: (chunk: string) => void): () => void };
  onExit(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): () => void;
  onError(listener: (error: Error) => void): () => void;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

/** Configuration and platform operations for one Host supervisor. */
export interface HostSupervisorOptions {
  readonly spawnHost: () => HostChild;
  readonly readinessTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly log?: (line: string) => void;
  readonly onUnexpectedExit?: (detail: HostUnexpectedExit) => void;
}

/** Public identity of one ready Host generation. */
export interface HostGeneration {
  readonly id: number;
  /** Loopback origin: the boundary every navigation is checked against. */
  readonly origin: string;
  /** Full readiness URL, including any credential dsh appended to it. */
  readonly url: string;
}

/** Detail reported when the currently owned ready generation exits by itself. */
interface HostUnexpectedExit extends HostGeneration {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** Handle for the desktop-owned Host generations. */
export interface HostSupervisor {
  readonly current: HostGeneration | undefined;
  /** Resolves with the full readiness URL to load once the Host is ready. */
  start(): Promise<string>;
  restart(
    reason: string,
    beforeStart?: () => Promise<void>,
  ): Promise<HostGeneration>;
  shutdown(): Promise<void>;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

type StopOwner =
  | { readonly kind: "restart"; readonly reason: string }
  | { readonly kind: "shutdown" };

interface HostGenerationState {
  readonly id: number;
  readonly child: HostChild;
  readonly readiness: Deferred<string>;
  readonly exited: Deferred<void>;
  readonly parser: ReadinessParser;
  readonly startupCleanups: Array<() => void>;
  origin?: string;
  url?: string;
  output: string;
  readinessSettled: boolean;
  exitedSettled: boolean;
  stopOwner?: StopOwner;
  stopPromise?: Promise<void>;
  readinessTimer?: ReturnType<typeof setTimeout>;
}

/** Create a single-owner, multi-generation Host supervisor. */
export function createHostSupervisor(
  options: HostSupervisorOptions,
): HostSupervisor {
  const readinessTimeoutMs =
    options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
  const shutdownTimeoutMs =
    options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  let active: HostGenerationState | undefined;
  let nextGenerationId = 0;
  let permanentlyClosed = false;
  let restartQueue: Promise<void> = Promise.resolve();
  let shutdownPromise: Promise<void> | undefined;

  const cleanupStartup = (state: HostGenerationState): void => {
    if (state.readinessTimer !== undefined) clearTimeout(state.readinessTimer);
    delete state.readinessTimer;
    for (const dispose of state.startupCleanups.splice(0)) dispose();
  };

  const appendOutput = (state: HostGenerationState, chunk: string): void => {
    state.output = `${state.output}${chunk}`.slice(-MAX_STARTUP_OUTPUT_CHARS);
    options.log?.(chunk);
  };

  const failReadiness = (state: HostGenerationState, error: unknown): void => {
    if (state.readinessSettled) return;
    state.readinessSettled = true;
    cleanupStartup(state);
    const diagnostic =
      state.output === "" ? "" : `\nHost output:\n${state.output}`;
    state.readiness.reject(
      new Error(
        `${error instanceof Error ? error.message : String(error)}${diagnostic}`,
      ),
    );
  };

  const settleExit = (
    state: HostGenerationState,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void => {
    if (state.exitedSettled) return;
    state.exitedSettled = true;
    state.exited.resolve(undefined);
    if (!state.readinessSettled) {
      failReadiness(
        state,
        new Error(
          `desktop Host exited before readiness (code ${String(code)}, signal ${String(signal)})`,
        ),
      );
    }
    if (active !== state) return;
    active = undefined;
    if (state.origin !== undefined && state.stopOwner === undefined) {
      options.onUnexpectedExit?.({
        id: state.id,
        origin: state.origin,
        url: state.url ?? state.origin,
        code,
        signal,
      });
    }
  };

  const createGeneration = (): HostGenerationState => {
    const child = options.spawnHost();
    const state: HostGenerationState = {
      id: ++nextGenerationId,
      child,
      readiness: deferred<string>(),
      exited: deferred<void>(),
      parser: createReadinessParser(),
      startupCleanups: [],
      output: "",
      readinessSettled: false,
      exitedSettled: false,
    };
    active = state;

    const acceptChunk = (chunk: string): void => {
      appendOutput(state, chunk);
      try {
        const url = state.parser.push(chunk);
        if (url === undefined || state.readinessSettled) return;
        state.readinessSettled = true;
        state.url = url;
        state.origin = hostOriginOf(url);
        cleanupStartup(state);
        state.readiness.resolve(url);
      } catch (error) {
        failReadiness(state, error);
        child.kill("SIGTERM");
      }
    };

    state.readinessTimer = setTimeout(() => {
      failReadiness(
        state,
        new Error(
          `desktop Host readiness timed out after ${String(readinessTimeoutMs)}ms`,
        ),
      );
      child.kill("SIGTERM");
    }, readinessTimeoutMs);
    state.startupCleanups.push(child.stdout.onData(acceptChunk));
    state.startupCleanups.push(
      child.stderr.onData((chunk) => {
        appendOutput(state, chunk);
      }),
    );
    child.onError((error) => {
      failReadiness(
        state,
        new Error(`desktop Host failed to spawn: ${error.message}`),
      );
      settleExit(state, null, null);
    });
    child.onExit((code, signal) => {
      settleExit(state, code, signal);
    });
    return state;
  };

  const stopGeneration = (
    state: HostGenerationState,
    owner: StopOwner,
  ): Promise<void> => {
    if (state.stopPromise !== undefined) return state.stopPromise;
    state.stopOwner = owner;
    state.stopPromise = (async () => {
      if (state.exitedSettled) return;
      state.child.kill("SIGTERM");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        state.exited.promise.then(() => "closed" as const),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => {
            resolve("timeout");
          }, shutdownTimeoutMs);
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
      if (outcome === "timeout") {
        state.child.kill("SIGKILL");
        await state.exited.promise;
      }
    })();
    return state.stopPromise;
  };

  const start = (): Promise<string> => {
    if (permanentlyClosed)
      return Promise.reject(
        new Error("desktop Host cannot start after shutdown"),
      );
    if (active !== undefined) return active.readiness.promise;
    try {
      return createGeneration().readiness.promise;
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  };

  const restart = (
    reason: string,
    beforeStart?: () => Promise<void>,
  ): Promise<HostGeneration> => {
    if (permanentlyClosed)
      return Promise.reject(
        new Error("desktop Host cannot restart after shutdown"),
      );
    const operation = restartQueue.then(async () => {
      const previous = active;
      if (previous !== undefined)
        await stopGeneration(previous, { kind: "restart", reason });
      await beforeStart?.();
      const next = createGeneration();
      const url = await next.readiness.promise;
      return { id: next.id, origin: hostOriginOf(url), url };
    });
    restartQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  const shutdown = (): Promise<void> => {
    if (shutdownPromise !== undefined) return shutdownPromise;
    permanentlyClosed = true;
    const generationAtShutdown = active;
    const initialStop =
      generationAtShutdown === undefined
        ? Promise.resolve()
        : stopGeneration(generationAtShutdown, { kind: "shutdown" });
    shutdownPromise = (async () => {
      await initialStop;
      await restartQueue;
      const finalGeneration = active;
      if (
        finalGeneration !== undefined &&
        finalGeneration !== generationAtShutdown
      ) {
        await stopGeneration(finalGeneration, { kind: "shutdown" });
      }
    })();
    return shutdownPromise;
  };

  return {
    get current() {
      if (active?.url === undefined) return undefined;
      return {
        id: active.id,
        origin: hostOriginOf(active.url),
        url: active.url,
      };
    },
    start,
    restart,
    shutdown,
  };
}

/** Options for the real `dsh web` child. */
export interface SpawnDshWebOptions {
  readonly nodeExecutable: string;
  readonly dshEntry: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /**
   * Cordis overlay disabling plugins the kernel cannot load. Passed as
   * `--patch`, a launcher-level option, which is why the Host is booted as
   * `--profile web` rather than the `web` alias: `dsh web` rejects parent
   * options outright. Both forms emit the same readiness line.
   */
  readonly patchFile?: string;
}

/**
 * Build the Host argv: boot the web profile, optionally over its composed
 * tree with a disable overlay, and let the OS pick a loopback port.
 *
 * Flag order is load-bearing — `--profile`/`--patch` are parsed by the dsh
 * launcher and must precede the app's own flags, which reach the web app.
 */
export function dshWebArgs(
  dshEntry: string,
  patchFile?: string,
): string[] {
  const args = ["--expose-internals", dshEntry, "--profile", "web"];
  if (patchFile !== undefined && patchFile !== "") {
    args.push("--patch", patchFile);
  }
  args.push("--no-open", "--host", "127.0.0.1", "--port", "0");
  return args;
}

function streamAdapter(stream: NodeJS.ReadableStream): HostChild["stdout"] {
  return {
    onData(listener) {
      const accept = (chunk: string | Buffer): void => {
        listener(chunk.toString());
      };
      stream.on("data", accept);
      return () => {
        stream.off("data", accept);
      };
    },
  };
}

/** Spawn the production Web Host on an OS-assigned loopback port. */
export function spawnDshWeb(options: SpawnDshWebOptions): HostChild {
  const process = spawn(
    options.nodeExecutable,
    dshWebArgs(options.dshEntry, options.patchFile),
    {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  return nodeChildAdapter(process);
}

/** Adapt Node's event overloads to the supervisor's explicit ownership API. */
function nodeChildAdapter(
  child: ChildProcessByStdio<null, Readable, Readable>,
): HostChild {
  return {
    ...(child.pid === undefined ? {} : { pid: child.pid }),
    stdout: streamAdapter(child.stdout),
    stderr: streamAdapter(child.stderr),
    onExit(listener) {
      child.on("exit", listener);
      return () => {
        child.off("exit", listener);
      };
    },
    onError(listener) {
      child.on("error", listener);
      return () => {
        child.off("error", listener);
      };
    },
    kill(signal) {
      child.kill(signal);
    },
  };
}