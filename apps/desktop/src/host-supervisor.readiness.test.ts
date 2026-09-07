import { describe, expect, it } from "vitest";
import {
  createHostSupervisor,
  type HostChild,
} from "./host-supervisor.ts";

/**
 * A Host stand-in that emits a chosen stdout line.
 *
 * kill() must deliver an exit event: shutdown waits for the generation to
 * settle, so a no-op kill hangs every test that cleans up.
 */
function emitting(line: string): {
  child: HostChild;
  listeners: ((c: string) => void)[];
} {
  const listeners: ((c: string) => void)[] = [];
  let onExit:
    | ((code: number | null, signal: NodeJS.Signals | null) => void)
    | undefined;
  let exited = false;
  return {
    listeners,
    child: {
      pid: 4242,
      stdout: {
        onData: (l) => {
          listeners.push(l);
          return () => {};
        },
      },
      stderr: { onData: () => () => {} },
      onExit: (l) => {
        onExit = l;
        return () => {};
      },
      onError: () => () => {},
      kill: () => {
        if (exited) return;
        exited = true;
        onExit?.(0, null);
      },
    },
  };
}

async function bootWith(line: string) {
  const probe = emitting(line);
  const supervisor = createHostSupervisor({
    spawnHost: () => probe.child,
    readinessTimeoutMs: 2000,
    shutdownTimeoutMs: 100,
  });
  const pending = supervisor.start();
  for (const listener of probe.listeners) listener(line);
  const url = await pending;
  return { supervisor, url };
}

/**
 * dsh 0.1.2-rc.1 appended a session token to the readiness URL. The old parser
 * rejected any query string outright and returned only an origin, so the client
 * could not start on the new kernel at all — and had it started, the renderer
 * would have been handed a URL with no credential for an ephemeral port.
 */
describe("readiness line", () => {
  it("accepts a bare loopback URL", async () => {
    const { url, supervisor } = await bootWith("dsh web: http://127.0.0.1:51234\n");
    expect(url).toBe("http://127.0.0.1:51234/");
    expect(supervisor.current?.origin).toBe("http://127.0.0.1:51234");
    await supervisor.shutdown();
  });

  it("keeps the token through to the load URL", async () => {
    const line = "dsh web: http://127.0.0.1:55249/?token=mchlZ2_Z5a664\n";
    const { supervisor, url } = await bootWith(line);
    expect(url).toContain("token=mchlZ2_Z5a664");
    expect(supervisor.current?.url).toContain("token=");
    expect(supervisor.current?.origin).toBe("http://127.0.0.1:55249");
    await supervisor.shutdown();
  });

  it("accepts localhost as loopback", async () => {
    const { url } = await bootWith("dsh web: http://localhost:3000/?token=abc\n");
    expect(url).toContain("localhost:3000");
  });

  it("rejects a non-loopback or portless URL", async () => {
    for (const line of [
      "dsh web: http://evil.example.com:3000\n",
      "dsh web: https://127.0.0.1:3000\n",
      "dsh web: http://127.0.0.1\n",
      "dsh web: not-a-url\n",
    ]) {
      const probe = emitting(line);
      const supervisor = createHostSupervisor({
        spawnHost: () => probe.child,
        readinessTimeoutMs: 2000,
        shutdownTimeoutMs: 100,
      });
      const pending = supervisor.start();
      for (const listener of probe.listeners) listener(line);
      await expect(pending).rejects.toThrow(/loopback|invalid/iu);
      await supervisor.shutdown();
    }
  });

  it("still ignores unrelated stdout before the readiness line", async () => {
    const probe = emitting("dsh web: http://127.0.0.1:9/?token=x\n");
    const supervisor = createHostSupervisor({
      spawnHost: () => probe.child,
      readinessTimeoutMs: 2000,
      shutdownTimeoutMs: 100,
    });
    const pending = supervisor.start();
    for (const listener of probe.listeners) {
      listener("some banner\n");
      listener("chrome-devtools-mcp disclaimer\n");
      listener("dsh web: http://127.0.0.1:9/?token=x\n");
    }
    await expect(pending).resolves.toContain("token=x");
    await supervisor.shutdown();
  });
});
