/** Prepare bundled dsh host for packaging.
 *
 * Creates a standalone pnpm project in a temp directory, installs
 * @deepseek-ai/dsh (using the existing store for speed), then copies
 * the resulting flat node_modules/ to resources/dsh/.
 *
 * This produces a self-contained dependency tree with no symlinks,
 * suitable for bundling via electron-builder extraResources.
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

const DESKTOP_DIR = resolve(import.meta.dirname, "..");
const TARGET_DIR = join(DESKTOP_DIR, "resources", "dsh");

function main(): void {
  const dshPkg = join(
    DESKTOP_DIR,
    "node_modules/@deepseek-ai/dsh/package.json",
  );
  if (!existsSync(dshPkg)) {
    console.error("❌ @deepseek-ai/dsh not found in", dshPkg);
    process.exit(1);
  }

  // Read the exact version from the installed package
  const pkgJson = JSON.parse(readFileSync(dshPkg, "utf8"));
  const dshVersion = pkgJson.version;
  console.log("ℹ️  @deepseek-ai/dsh version:", dshVersion);

  // Clean target
  if (existsSync(TARGET_DIR)) {
    console.log("🧹 Cleaning existing", TARGET_DIR);
    rmSync(TARGET_DIR, { recursive: true });
  }

  // Create a temp directory completely outside the pnpm workspace
  const tmpDir = `/tmp/dsh-bundle-${Date.now()}`;
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  // Write package.json
  writeFileSync(
    join(tmpDir, "package.json"),
    JSON.stringify(
      {
        name: "dsh-bundle",
        private: true,
        type: "module",
        dependencies: {
          "@deepseek-ai/dsh": `^${dshVersion}`,
        },
      },
      null,
      2,
    ),
  );

  // Force pnpm to hoist all dependencies to a flat node_modules (no .pnpm virtual store)
  writeFileSync(join(tmpDir, ".npmrc"), "node-linker=hoisted\n");

  // Install in the temp dir (outside workspace, so pnpm creates a proper flat node_modules)
  console.log("📦 Installing @deepseek-ai/dsh with dependencies...");
  execSync(`pnpm install --no-frozen-lockfile --ignore-scripts`, {
    cwd: tmpDir,
    stdio: "inherit",
  });

  // Copy the resulting flat node_modules to target
  const srcNodeModules = join(tmpDir, "node_modules");
  if (!existsSync(srcNodeModules)) {
    console.error("❌ pnpm install did not produce node_modules");
    process.exit(1);
  }

  // Create target node_modules directory
  const targetNodeModules = join(TARGET_DIR, "node_modules");
  mkdirSync(targetNodeModules, { recursive: true });

  // Copy the entire node_modules/ with cp -RL to resolve all symlinks
  console.log("📦 Copying node_modules to", TARGET_DIR);
  execSync(`cp -RL "${srcNodeModules}/." "${targetNodeModules}"`, {
    stdio: "inherit",
  });

  // Flatten: move packages from .pnpm/*/node_modules/ to top-level node_modules/
  console.log("📦 Flattening pnpm virtual store to top-level node_modules...");
  flattenPnpmStore(targetNodeModules);

  // Write a minimal package.json
  writeFileSync(
    join(TARGET_DIR, "package.json"),
    JSON.stringify(
      { name: "dsh-host", private: true, type: "module" },
      null,
      2,
    ),
  );

  // Clean up temp
  rmSync(tmpDir, { recursive: true });

  // Verify
  const dshEntry = join(TARGET_DIR, "node_modules/@deepseek-ai/dsh/lib/bin.js");
  if (!existsSync(dshEntry)) {
    console.error("❌ dsh entry not found after deploy");
    process.exit(1);
  }

  const depCount = readdirSync(join(TARGET_DIR, "node_modules")).length;
  const totalSize = run(`du -sh "${TARGET_DIR}"`);

  console.log(
    `✅ dsh host prepared: ${depCount} top-level dependencies, ${totalSize}`,
  );

  // Quick smoke test: run `dsh --version` using the bundled copy
  console.log("🧪 Smoke-testing bundled dsh...");
  const versionOut = run(
    `node --expose-internals "${dshEntry}" --version`,
    { cwd: TARGET_DIR },
  );
  console.log(`   dsh --version = ${versionOut}`);

  console.log("✅ prepare-dsh complete");
}

/** Run a shell command and return trimmed stdout. Exits the process on failure. */
function run(cmd: string, opts?: { cwd?: string }): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe", ...opts })
      .toString()
      .trim();
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer; message?: string };
    console.error(`❌ Command failed: ${cmd}`);
    if (err.stderr) console.error(err.stderr.toString().trim());
    else console.error(err.message);
    process.exit(1);
  }
}

/** Flatten pnpm virtual store: move packages from .pnpm/<hash>/node_modules/ to top-level */
function flattenPnpmStore(nmDir: string): void {
  const pnpmDir = join(nmDir, ".pnpm");
  if (!existsSync(pnpmDir)) return;

  const hashDirs = readdirSync(pnpmDir);
  let moved = 0;

  for (const hashDir of hashDirs) {
    const pkgDir = join(pnpmDir, hashDir, "node_modules");
    if (!existsSync(pkgDir)) continue;

    moveAll(pkgDir, nmDir);
    moved++;
  }

  rmSync(pnpmDir, { recursive: true, force: true });
  console.log(`   Flattened ${moved} pnpm store directories`);
}

/** Recursively move all entries from srcDir to dstDir, merging into existing directories */
function moveAll(srcDir: string, dstDir: string): void {
  const entries = readdirSync(srcDir);
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const src = join(srcDir, entry);
    const dst = join(dstDir, entry);
    if (existsSync(dst)) {
      // If both are directories, recurse into them
      if (statSync(src).isDirectory() && readdirSync(src).length > 0) {
        moveAll(src, dst);
      }
    } else {
      try {
        execSync(`mv "${src}" "${dst}"`, { stdio: "ignore" });
      } catch {
        // ignore individual move failures, may be a race with another moveAll
      }
    }
  }
}

main();