import { existsSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ManagedPresetRuntimeId,
  PresetRuntimeDependencyId,
} from "@deepseek-ai/dsh-plugin-center-contracts";
import {
  prepareBundledPackageManagerCommand,
  PresetRuntimeController,
  presetRuntimePaths,
  withPresetRuntimeEnvironment,
  type PresetRuntimeInstaller,
  type PresetRuntimeProcessAdapter,
} from "../src/preset-square/runtime-controller.ts";

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function home(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "dsh-preset-runtime-"));
  homes.push(path);
  return path;
}

function processAdapter(): PresetRuntimeProcessAdapter {
  return {
    async run(request) {
      if (
        request.command === "/desktop/node" &&
        request.args[0] === "--version"
      ) {
        return { code: 0, stdout: "v24.0.0\n", stderr: "" };
      }
      if (request.command === "/desktop/node" && request.args[0] === "-e") {
        const browserRoot = request.env.PLAYWRIGHT_BROWSERS_PATH;
        const browser =
          browserRoot === undefined
            ? undefined
            : join(browserRoot, "chromium-fixture");
        return browser !== undefined && existsSync(browser)
          ? { code: 0, stdout: `${browser}\n`, stderr: "" }
          : { code: 1, stdout: "", stderr: "managed Chromium is missing" };
      }
      if (request.command === "ffmpeg")
        return { code: 0, stdout: "ffmpeg version 8.1\n", stderr: "" };
      if (request.command === "ffprobe")
        return { code: 0, stdout: "ffprobe version 8.1\n", stderr: "" };
      throw Object.assign(new Error(`missing ${request.command}`), {
        code: "ENOENT",
      });
    },
  };
}

class FixtureInstaller implements PresetRuntimeInstaller {
  readonly installs: ManagedPresetRuntimeId[] = [];

  constructor(private readonly directory: string) {}

  async prepare(): Promise<void> {}

  async install(
    presetId: ManagedPresetRuntimeId,
    _missing: readonly PresetRuntimeDependencyId[],
  ): Promise<void> {
    this.installs.push(presetId);
    const paths = presetRuntimePaths(this.directory);
    await mkdir(paths.packages, { recursive: true });
    await writeFile(join(paths.packages, "package.json"), '{"private":true}\n');
    if (presetId === "product-video-director") {
      const root = join(paths.packages, "node_modules", "hyperframes");
      await mkdir(join(root, "bin"), { recursive: true });
      await writeFile(
        join(root, "package.json"),
        '{"name":"hyperframes","version":"0.7.109"}\n',
      );
      await writeFile(join(root, "bin", "hyperframes.mjs"), "");
      return;
    }
    const echarts = join(paths.packages, "node_modules", "echarts");
    await mkdir(echarts, { recursive: true });
    await writeFile(
      join(echarts, "package.json"),
      '{"name":"echarts","version":"6.1.0"}\n',
    );
    const playwright = join(paths.packages, "node_modules", "playwright");
    const browser = join(paths.browsers, "chromium-fixture");
    await mkdir(playwright, { recursive: true });
    await mkdir(paths.browsers, { recursive: true });
    await writeFile(browser, "");
    await writeFile(
      join(playwright, "package.json"),
      '{"name":"playwright","version":"1.61.1","main":"index.cjs"}\n',
    );
    await writeFile(
      join(playwright, "index.cjs"),
      `module.exports={chromium:{executablePath:()=>${JSON.stringify(browser)}}}\n`,
    );
  }
}

function controller(
  directory: string,
  installer: FixtureInstaller,
  platform: NodeJS.Platform = "darwin",
): PresetRuntimeController {
  return new PresetRuntimeController({
    homeDirectory: directory,
    nodeExecutable: "/desktop/node",
    packageManagerEntry: "/desktop/pnpm.cjs",
    electronRunAsNode: false,
    platform,
    inheritedEnvironment: { PATH: "" },
    processAdapter: processAdapter(),
    installer,
    now: () => Date.parse("2026-08-17T08:00:00.000Z"),
  });
}

describe("Preset runtime controller", () => {
  it("exposes the bundled pnpm entry through the Windows Host command path", async () => {
    const directory = await home();
    await prepareBundledPackageManagerCommand({
      homeDirectory: directory,
      nodeExecutable: "C:\\Program Files\\DSH Desktop\\DSH Desktop.exe",
      packageManagerEntry:
        "C:\\Program Files\\DSH Desktop\\resources\\host\\node_modules\\pnpm\\bin\\pnpm.cjs",
      electronRunAsNode: true,
      platform: "win32",
    });

    const wrapper = await readFile(
      join(presetRuntimePaths(directory).bin, "pnpm.cmd"),
      "utf8",
    );
    expect(wrapper).toBe(
      [
        "@echo off",
        'set "ELECTRON_RUN_AS_NODE=1"',
        '"C:\\Program Files\\DSH Desktop\\DSH Desktop.exe" "C:\\Program Files\\DSH Desktop\\resources\\host\\node_modules\\pnpm\\bin\\pnpm.cjs" %*',
        "",
      ].join("\r\n"),
    );
  });

  it("places an executable bundled pnpm wrapper first in the POSIX Host path", async () => {
    const directory = await home();
    const paths = presetRuntimePaths(directory);
    await prepareBundledPackageManagerCommand({
      homeDirectory: directory,
      nodeExecutable:
        "/Applications/DSH Desktop.app/Contents/MacOS/DSH Desktop",
      packageManagerEntry:
        "/Applications/DSH Desktop.app/Contents/Resources/host/node_modules/pnpm/bin/pnpm.cjs",
      electronRunAsNode: true,
      platform: "darwin",
    });

    const wrapperPath = join(paths.bin, "pnpm");
    expect(await readFile(wrapperPath, "utf8")).toBe(
      [
        "#!/bin/sh",
        "export ELECTRON_RUN_AS_NODE='1'",
        "exec '/Applications/DSH Desktop.app/Contents/MacOS/DSH Desktop' '/Applications/DSH Desktop.app/Contents/Resources/host/node_modules/pnpm/bin/pnpm.cjs' \"$@\"",
        "",
      ].join("\n"),
    );
    expect((await stat(wrapperPath)).mode & 0o777).toBe(0o700);
    expect(
      withPresetRuntimeEnvironment({ PATH: "/usr/bin" }, directory).PATH?.split(
        delimiter,
      )[0],
    ).toBe(paths.bin);
  });

  it("moves the video runtime from detected missing to verified ready after one confirmed install", async () => {
    const directory = await home();
    const installer = new FixtureInstaller(directory);
    const runtime = controller(directory, installer);

    const missing = await runtime.check("product-video-director");
    expect(missing.phase).toBe("missing");
    expect(
      missing.dependencies.find((item) => item.id === "hyperframes")?.state,
    ).toBe("missing");
    expect(missing.canInstall).toBe(true);

    const ready = await runtime.install("product-video-director");
    expect(installer.installs).toEqual(["product-video-director"]);
    expect(ready.phase).toBe("ready");
    expect(ready.dependencies.every((item) => item.state === "ready")).toBe(
      true,
    );
  });

  it("installs the managed report libraries but keeps missing Python as an explicit manual requirement", async () => {
    const directory = await home();
    const installer = new FixtureInstaller(directory);
    const runtime = controller(directory, installer, "win32");

    const result = await runtime.install("ai-report-analyst");
    expect(installer.installs).toEqual(["ai-report-analyst"]);
    expect(result.phase).toBe("missing");
    expect(
      result.dependencies.find((item) => item.id === "python"),
    ).toMatchObject({
      state: "missing",
      installable: false,
    });
    expect(
      result.dependencies.find((item) => item.id === "playwright")?.state,
    ).toBe("ready");
    expect(
      result.dependencies.find((item) => item.id === "chromium")?.state,
    ).toBe("ready");
    expect(result.canInstall).toBe(false);
  });
});
