/** Build-time: download Node.js binary and stage it for bundling. */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const DESKTOP_DIR = resolve(import.meta.dirname, "..");
const RESOURCES_DIR = join(DESKTOP_DIR, "resources");

interface NodeVersionsConfig {
	version: string;
	minSystemNode: number;
	mirrorBase: string;
	mirrorFallback?: string;
	checksums: Record<string, string>;
}

let config: NodeVersionsConfig;
try {
	config = JSON.parse(
		readFileSync(join(RESOURCES_DIR, "node-versions.json"), "utf8"),
	) as NodeVersionsConfig;
} catch (error) {
	throw new Error(`node-versions.json missing or invalid: ${String(error)}`);
}

const PLATFORM = process.platform;
const ARCH = process.arch;
const MIRROR_BASE = config.mirrorBase;
const MIRROR_FALLBACK = config.mirrorFallback ?? "";
const VERSION = config.version;

/** Official Node archive platform label (win32 uses "win"). */
const ARCHIVE_PLATFORM_LABEL: Record<string, string> = {
	win32: "win",
};

interface ArchiveSpec {
	ext: "tar.gz" | "zip";
}

const ARCHIVE_SPECS: Record<string, ArchiveSpec> = {
	"darwin-arm64": { ext: "tar.gz" },
	"darwin-x64": { ext: "tar.gz" },
	"win32-x64": { ext: "zip" },
	"linux-x64": { ext: "tar.gz" },
	"linux-arm64": { ext: "tar.gz" },
};

function getArchiveSpec(): ArchiveSpec {
	const spec = ARCHIVE_SPECS[`${PLATFORM}-${ARCH}`];
	if (spec === undefined) {
		throw new Error(`unsupported platform/arch: ${PLATFORM}-${ARCH}`);
	}
	return spec;
}

function archiveFileName(): string {
	const label = ARCHIVE_PLATFORM_LABEL[PLATFORM] ?? PLATFORM;
	const spec = getArchiveSpec();
	return `node-v${VERSION}-${label}-${ARCH}.${spec.ext}`;
}

/** Output file in resources/. Use .tar.gz even for zip platforms for uniform naming. */
function bundleFileName(): string {
	const spec = getArchiveSpec();
	return `node-bundle-${PLATFORM}-${ARCH}.${spec.ext}`;
}

function expectedChecksum(): string {
	const key = `${PLATFORM}-${ARCH}`;
	const sum = config.checksums[key];
	if (sum === undefined || sum === "") {
		throw new Error(`no SHA256 checksum for ${key} in node-versions.json`);
	}
	return sum;
}

async function sha256File(filePath: string): Promise<string> {
	const { createHash } = await import("node:crypto");
	const { createReadStream } = await import("node:fs");
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		const stream = createReadStream(filePath);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => resolve(hash.digest("hex")));
		stream.on("error", reject);
	});
}

async function download(
	url: string,
	destPath: string,
	redirects = 5,
): Promise<void> {
	if (redirects <= 0) throw new Error(`too many redirects for ${url}`);
	const { get: httpGet } = await import("node:http");
	const { get: httpsGet } = await import("node:https");
	const { createWriteStream } = await import("node:fs");
	return new Promise((resolve, reject) => {
		const get = url.startsWith("https:") ? httpsGet : httpGet;
		const request = get(url, (response) => {
			// Follow redirects
			if (
				response.statusCode !== undefined &&
				response.statusCode >= 300 &&
				response.statusCode < 400
			) {
				const location = response.headers["location"];
				if (location === undefined) {
					reject(new Error(`redirect without Location header for ${url}`));
					return;
				}
				response.resume();
				const redirected = new URL(location, url).href;
				download(redirected, destPath, redirects - 1)
					.then(resolve)
					.catch(reject);
				return;
			}
			if (response.statusCode !== 200) {
				response.resume();
				reject(new Error(`HTTP ${String(response.statusCode)} for ${url}`));
				return;
			}
			const sink = createWriteStream(destPath);
			response.pipe(sink);
			sink.on("finish", () => resolve());
			sink.on("error", reject);
		});
		request.on("error", reject);
		request.setTimeout(120_000, () => {
			request.destroy(new Error("download timeout"));
		});
	});
}

async function main(): Promise<void> {
	mkdirSync(RESOURCES_DIR, { recursive: true });

	const bundlePath = join(RESOURCES_DIR, bundleFileName());
	const expected = expectedChecksum().toLowerCase();

	// Skip if already downloaded and checksum matches
	if (existsSync(bundlePath)) {
		const actual = await sha256File(bundlePath);
		if (actual === expected) {
			console.log(
				`[prepare-node] ${bundleFileName()} already up-to-date (SHA256 OK)`,
			);
			return;
		}
		console.log(`[prepare-node] checksum mismatch, re-downloading...`);
		rmSync(bundlePath, { force: true });
	}

	// Download from primary mirror
	const archiveName = archiveFileName();
	const primaryUrl = `${MIRROR_BASE}/v${VERSION}/${archiveName}`;
	const urls: string[] = [primaryUrl];
	if (MIRROR_FALLBACK) {
		urls.push(`${MIRROR_FALLBACK}/v${VERSION}/${archiveName}`);
	}

	for (const url of urls) {
		const isFallback = url !== primaryUrl;
		console.log(
			`[prepare-node] downloading ${isFallback ? "(fallback) " : ""}${url}`,
		);
		try {
			const tmpPath = bundlePath + ".tmp";
			await download(url, tmpPath);
			// Verify
			const actual = await sha256File(tmpPath);
			if (actual !== expected) {
				rmSync(tmpPath, { force: true });
				console.error(`[prepare-node] SHA256 mismatch for ${url}`);
				if (url === urls[urls.length - 1]) {
					throw new Error(
						`SHA256 mismatch for ${url}: expected ${expected}, got ${actual}`,
					);
				}
				continue;
			}
			// Rename temp to final
			rmSync(bundlePath, { force: true });
			const { renameSync } = await import("node:fs");
			renameSync(tmpPath, bundlePath);
			console.log(
				`[prepare-node] saved to ${bundleFileName()} (${(await import("node:fs")).statSync(bundlePath).size} bytes)`,
			);
			return;
		} catch (error) {
			console.error(
				`[prepare-node] failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			if (url === urls[urls.length - 1]) throw error;
		}
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
