/** Electron application shell for the loopback DSH Desktop Web Host. */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "node:process";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	nativeImage,
	session,
	shell,
	Tray,
	type Event,
	type MenuItem,
	type MenuItemConstructorOptions,
} from "electron";
import {
	createHostSupervisor,
	spawnDshWeb,
	type HostSupervisor,
} from "./host-supervisor.ts";
import {
	checkDshUpdate,
	ensureManagedDsh,
	hostPathFor,
	managedDshRoot,
	installDshUpdate,
	readManagedDshVersion,
	resolveNode,
	type NodeInfo,
	type NodeProgress,
	type NodeVersionsConfig,
} from "./node-manager.ts";
import {
	createBootWindow,
	setBootRetryHandler,
	type BootWindow,
} from "./boot-window.ts";
import {
	createDesktopLifecycle,
	isInstallerQuitRequest,
	type DesktopLifecycle,
} from "./window-lifecycle.ts";
import { checkUserConfig, type CompatReport } from "./config-migration.ts";
import {
	explainReason,
	readSafeMode,
	recoveringDetail,
	safePatchPath,
	startWithPluginRecovery,
	withoutDisabled,
	writeSafeMode,
	type DisabledPlugin,
} from "./plugin-recovery.ts";
import {
	applyPluginUpdate,
	resolvePluginUpdate,
	webProfileDir,
} from "./plugin-updates.ts";

const APP_NAME = "DSH Desktop";
const GITHUB_REPO = "zuoxiaojun/dsh-desktop";
const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 920;
const DESKTOP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let host: HostSupervisor | undefined;
let lifecycle: DesktopLifecycle | undefined;
let bootQuitPromise: Promise<void> | undefined;
let quitReleased = false;
let bootWindow: BootWindow | undefined;
let abortController: AbortController | undefined;
let ipcRegistered = false;

function readDesktopVersion(): string {
	try {
		const v = JSON.parse(
			readFileSync(join(DESKTOP_DIR, "resources/version.json"), "utf8"),
		);
		return v.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

const DESKTOP_VERSION = readDesktopVersion();
let DSH_VERSION: string | undefined;
let DSH_LATEST: string | undefined;
let DSH_UPDATE_AVAILABLE = false;
let APP_UPDATE_AVAILABLE = false;
let APP_LATEST: string | undefined;
let APP_UPDATE_URL: string | undefined;
let dshUpdateMenuItem: MenuItem | undefined;
let bootNode: NodeInfo | undefined;
let bootUserDataDir: string | undefined;
/** Everything the plugin recovery and repair flows need after boot returns. */
let bootDshEntry: string | undefined;
let bootHostEnv: NodeJS.ProcessEnv | undefined;
/** Bundles disabled by safe mode, mirrored to userData for the next launch. */
let safeDisabled: DisabledPlugin[] = [];
/** Overlay carrying those disables, or undefined when the Host boots bare. */
let safePatchFile: string | undefined;

/** Recovery relaunches one round per newly attributed bundle. */
const MAX_RECOVERY_ROUNDS = 8;

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const NODE_VERSIONS: NodeVersionsConfig = (() => {
	try {
		return JSON.parse(
			readFileSync(join(DESKTOP_DIR, "resources/node-versions.json"), "utf8"),
		) as NodeVersionsConfig;
	} catch (error) {
		throw new Error(`node-versions.json missing or invalid: ${String(error)}`);
	}
})();

function currentHostOrigin(): string | undefined {
	return host?.current?.origin;
}

/**
 * Full readiness URL, token included.
 *
 * The window must load this rather than the bare origin: dsh puts a session
 * credential in the readiness URL, the port is ephemeral, and a renderer that
 * loses the token has no way to authenticate again. Origin stays the security
 * boundary; the URL stays the load target.
 */
function currentHostUrl(): string | undefined {
	return host?.current?.url ?? host?.current?.origin;
}

function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const x = pa[i] ?? 0;
		const y = pb[i] ?? 0;
		if (x > y) return 1;
		if (x < y) return -1;
	}
	return 0;
}

async function checkAppUpdate(force: boolean): Promise<void> {
	try {
		const res = await fetch(
			"https://api.github.com/repos/" + GITHUB_REPO + "/releases/latest",
			{
				signal: AbortSignal.timeout(6000),
				headers: {
					"User-Agent": "dsh-desktop",
					Accept: "application/vnd.github+json",
				},
			},
		);
		if (!res.ok) {
			if (force) {
				await dialog.showMessageBox({
					type: "info",
					title: APP_NAME,
					message: "检查应用更新失败",
					detail: "GitHub 返回 HTTP " + String(res.status),
				});
			}
			return;
		}
		const data = (await res.json()) as { tag_name?: string; html_url?: string };
		const latest = (data.tag_name ?? "").replace(/^v/, "");
		if (!/^\d+\.\d+\.\d+/.test(latest)) return;
		const newer = compareVersions(latest, DESKTOP_VERSION) > 0;
		if (newer) {
			APP_UPDATE_AVAILABLE = true;
			APP_LATEST = latest;
			APP_UPDATE_URL = data.html_url;
			const { response } = await dialog.showMessageBox({
				type: "info",
				title: APP_NAME + " 有更新",
				message: "发现新版本 v" + latest,
				detail:
					"当前版本 v" + DESKTOP_VERSION + "\n是否前往 GitHub 下载新版本？",
				buttons: ["去下载", "暂不安装"],
				defaultId: 0,
				cancelId: 1,
			});
			if (response === 0 && APP_UPDATE_URL)
				void shell.openExternal(APP_UPDATE_URL);
		} else if (force) {
			await dialog.showMessageBox({
				type: "info",
				title: APP_NAME,
				message: "当前已是最新版本 v" + DESKTOP_VERSION,
			});
		}
	} catch {
		if (force) {
			await dialog.showMessageBox({
				type: "info",
				title: APP_NAME,
				message: "检查应用更新失败，请检查网络连接",
			});
		}
	}
}

function isExternalUrl(raw: string): boolean {
	try {
		return (
			new URL(raw).protocol === "http:" || new URL(raw).protocol === "https:"
		);
	} catch {
		return false;
	}
}

function hasOrigin(raw: string, expected: string): boolean {
	try {
		return new URL(raw).origin === expected;
	} catch {
		return false;
	}
}

function desktopRendererUrl(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.searchParams.set("dsh-desktop-platform", process.platform);
		return parsed.href;
	} catch {
		return url;
	}
}

function registerIpcHandlers(): void {
	ipcMain.handle("dsh-desktop:get-versions", () => ({
		desktop: DESKTOP_VERSION,
		dsh: DSH_VERSION,
	}));

	// 用户点击「检查 dsh 内核更新」→ 手动安装 dsh 最新版（主进程菜单 / 托盘 / IPC 共用逻辑）
	ipcMain.handle("dsh-desktop:update-dsh", async () => {
		const result = await performDshUpdate();
		if (result.ok && result.version) {
			await dialog.showMessageBox({
				type: "info",
				title: "dsh 更新",
				message: "dsh 已更新到 v" + result.version,
				detail: "重启客户端后生效。",
				buttons: ["好的"],
				defaultId: 0,
			});
		}
		return result;
	});

	// 用户点击「检查桌面版更新」→ 手动检查桌面版新版本（GitHub Release）
	ipcMain.handle("dsh-desktop:check-app-update", () => {
		void checkAppUpdate(true);
		return { ok: true };
	});
}

function dshUpdateLabel(): string {
	return DSH_UPDATE_AVAILABLE && DSH_LATEST !== undefined
		? `检查 dsh 内核更新 (v${DSH_LATEST})`
		: "检查 dsh 内核更新";
}

function refreshAboutPanel(): void {
	app.setAboutPanelOptions({
		applicationName: APP_NAME,
		applicationVersion: DESKTOP_VERSION,
		version: DESKTOP_VERSION,
		copyright: "Built by zuoxiaojun",
		credits: DSH_VERSION ? `dsh ${DSH_VERSION}` : "dsh 未安装",
	});
}

function showAboutDialog(): void {
	refreshAboutPanel();
	app.showAboutPanel();
}

async function performDshUpdate(): Promise<{
	ok: boolean;
	version?: string;
	error?: string;
	alreadyLatest?: boolean;
}> {
	if (!bootNode || !bootUserDataDir) {
		return { ok: false, error: "not-ready" };
	}
	let available = false;
	try {
		available = (await checkDshUpdate(bootUserDataDir)).available;
	} catch {
		// 无法确认版本时按「已是最新」处理（fail-open，不误报失败）
		available = false;
	}
	if (!available) {
		return { ok: true, alreadyLatest: true };
	}
	try {
		const newVersion = await installDshUpdate({
			node: bootNode,
			userDataDir: bootUserDataDir,
		});
		if (newVersion === undefined) {
			return { ok: false, error: "update-failed" };
		}
		DSH_UPDATE_AVAILABLE = false;
		DSH_LATEST = newVersion;
		DSH_VERSION = newVersion;
		refreshAboutPanel();
		return { ok: true, version: newVersion };
	} catch {
		return { ok: false, error: "update-failed" };
	}
}

async function menuCheckDshUpdate(): Promise<void> {
	const result = await performDshUpdate();
	if (result.alreadyLatest) {
		await dialog.showMessageBox({
			type: "info",
			title: "dsh 更新",
			message: "dsh 已是最新版本",
		});
	} else if (result.ok && result.version) {
		await dialog.showMessageBox({
			type: "info",
			title: "dsh 更新",
			message: `dsh 已更新到 v${result.version}`,
			detail: "重启客户端后生效。",
			buttons: ["好的"],
			defaultId: 0,
		});
	} else if (result.error === "not-ready") {
		await dialog.showMessageBox({
			type: "info",
			title: "dsh 更新",
			message: "dsh 尚未就绪，请稍后重试",
		});
	} else {
		await dialog.showMessageBox({
			type: "info",
			title: "dsh 更新",
			message: "dsh 更新失败，请检查网络连接",
		});
	}
}

/**
 * Recovery arguments bound to a live supervisor and its userData home.
 *
 * Safe mode lives in userData rather than the profile so the shell never edits
 * files dsh owns; every round rewrites the overlay the next spawn will read.
 */
function pluginRecovery(
	supervisor: HostSupervisor,
	userDataDir: string,
	onProgress: (p: NodeProgress) => void,
) {
	return {
		startup: (attempt: number) =>
			attempt === 0
				? supervisor.start()
				: supervisor.restart("plugin-safe-mode"),
		getDisabled: (): readonly DisabledPlugin[] => safeDisabled,
		commit: (next: readonly DisabledPlugin[]): void => {
			safeDisabled = [...next];
			safePatchFile = writeSafeMode(userDataDir, safeDisabled);
		},
		report: (count: number): void => {
			onProgress({
				stage: "installing-dsh",
				detail: recoveringDetail(count),
			});
		},
	};
}

/** Tell the user what safe mode skipped, and offer the repair path. */
async function notifyRecoveredPlugins(
	disabled: readonly DisabledPlugin[],
): Promise<void> {
	if (disabled.length === 0) return;
	const lines = disabled.map(
		(entry) => "- " + entry.packageName + "\n  " + explainReason(entry.reason),
	);
	const { response } = await dialog.showMessageBox({
		type: "warning",
		title: APP_NAME,
		message: "已停用 " + String(disabled.length) + " 个与当前内核不兼容的插件",
		detail:
			lines.join("\n") +
			"\n\n客户端已跳过这些插件正常启动。需要时可从菜单「已停用插件」检查更新或重新启用。",
		buttons: ["查看可用更新", "知道了"],
		defaultId: 1,
		cancelId: 1,
	});
	if (response === 0) await offerPluginUpdates(disabled);
}

/**
 * Look upstream once for every disabled plugin and report in a single dialog.
 *
 * One summary rather than a per-plugin prompt: these run concurrently, and
 * stacking app-modal dialogs on top of each other is both noisy and
 * indistinguishable to the user. Nothing installs from here — the caller still
 * chooses per plugin from the menu, because a candidate is a guess until the
 * Host boots with it.
 */
async function offerPluginUpdates(
	disabled: readonly DisabledPlugin[],
): Promise<void> {
	const checked = await Promise.all(
		disabled.map(async (entry) => ({
			entry,
			update: await resolvePluginUpdate(
				entry.packageName,
				webProfileDir(),
			).catch(() => undefined),
		})),
	);
	const found = checked.filter((row) => row.update !== undefined);
	if (found.length === 0) {
		await dialog.showMessageBox({
			type: "info",
			title: "插件更新",
			message: "上游暂时没有可用的新版本",
			detail:
				"这些插件可能还未适配当前 dsh 内核。可保持停用状态，或联系插件作者后从「已停用插件」菜单再试。",
			buttons: ["好的"],
			defaultId: 0,
		});
		return;
	}
	const detail = found
		.map(
			(row) =>
				"- " +
				row.entry.packageName +
				"：" +
				String(row.update?.label) +
				"（菜单「已停用插件」→ 检查更新并启用）",
		)
		.join("\n");
	const { response } = await dialog.showMessageBox({
		type: "info",
		title: "插件更新",
		message: "找到 " + String(found.length) + " 个可尝试的插件更新",
		detail:
			detail +
			(found.length < disabled.length
				? "\n- 其余 " + String(disabled.length - found.length) + " 个暂无新版本"
				: "") +
			"\n\n更新后会自动重新尝试启动；仍不兼容的插件会再次停用。",
		buttons: ["现在更新并启用", "稍后再说"],
		defaultId: 0,
		cancelId: 1,
	});
	if (response !== 0) return;
	for (const row of found) {
		// Sequential on purpose: each attempt restarts the Host and must be judged
		// by the boot result before the next plugin is touched.
		await enablePlugin(row.entry.entryId, true);
	}
}

/**
 * Re-enable one bundle, optionally updating it through dsh's plugin command
 * first. An update is a guess at compatibility, so the boot decides: if the
 * plugin still fails it goes back to the disabled set and the user is told the
 * upstream build is still broken.
 */
async function enablePlugin(
	entryId: string,
	withUpdate: boolean,
): Promise<void> {
	const target = safeDisabled.find((entry) => entry.entryId === entryId);
	if (
		target === undefined ||
		host === undefined ||
		bootUserDataDir === undefined
	)
		return;

	if (withUpdate) {
		if (bootNode === undefined || bootDshEntry === undefined) return;
		const update = await resolvePluginUpdate(
			target.packageName,
			webProfileDir(),
		);
		if (update === undefined) {
			await dialog.showMessageBox({
				type: "info",
				title: "插件更新",
				message: "未找到 " + target.packageName + " 的可用新版本",
				detail:
					"上游可能还没适配当前 dsh 内核版本，可联系插件作者，或继续使用停用状态。",
				buttons: ["好的"],
				defaultId: 0,
			});
			return;
		}
		const updated = await applyPluginUpdate({
			nodeExecutable: bootNode.executable,
			dshEntry: bootDshEntry,
			profile: "web",
			spec: update.candidateSpec,
			env: bootHostEnv ?? env,
		});
		if (!updated) {
			await dialog.showMessageBox({
				type: "error",
				title: "插件更新",
				message: target.packageName + " 更新失败",
				detail: "安装未完成，插件保持停用。请检查网络或镜像可用性后重试。",
				buttons: ["好的"],
				defaultId: 0,
			});
			return;
		}
	}

	const next = withoutDisabled(safeDisabled, entryId);
	safeDisabled = next ?? safeDisabled;
	safePatchFile = writeSafeMode(bootUserDataDir, safeDisabled);
	refreshRuntimeMenus();
	try {
		await host.restart("plugin-enabled");
		await dialog.showMessageBox({
			type: "info",
			title: "插件已启用",
			message:
				target.packageName + (withUpdate ? " 已更新并重新启用" : " 已重新启用"),
			detail: "立即生效，无需重启客户端。",
			buttons: ["好的"],
			defaultId: 0,
		});
	} catch (error) {
		const restored = await startWithPluginRecovery(
			pluginRecovery(host, bootUserDataDir, () => {}),
		).catch((inner: unknown) => {
			console.error("safe-mode restore failed:", inner);
			return [] as DisabledPlugin[];
		});
		await dialog.showMessageBox({
			type: "warning",
			title: "插件仍不兼容",
			message:
				target.packageName +
				(withUpdate ? " 更新后仍与当前内核不兼容" : " 仍与当前内核不兼容"),
			detail:
				(restored.length > 0
					? "客户端已重新停用 " +
						String(restored.length) +
						" 个插件以恢复启动。"
					: "客户端已恢复停用状态。") +
				"\n" +
				explainReason(target.reason),
			buttons: ["好的"],
			defaultId: 0,
		});
	}
}

/** Menu rows for the safe-mode set; shared by the app menu and the tray. */
function disabledPluginsMenuItems(): MenuItemConstructorOptions[] {
	if (safeDisabled.length === 0) {
		return [{ label: "已停用插件（无）", enabled: false }];
	}
	return [
		{
			label: "已停用插件 (" + String(safeDisabled.length) + ")",
			submenu: safeDisabled.map<MenuItemConstructorOptions>((entry) => ({
				label: entry.packageName,
				submenu: [
					{ label: explainReason(entry.reason), enabled: false },
					{ type: "separator" },
					{
						label: "检查更新并启用…",
						click: () => void enablePlugin(entry.entryId, true),
					},
					{
						label: "直接重新启用",
						click: () => void enablePlugin(entry.entryId, false),
					},
				],
			})),
		},
	];
}

/** Rebuild the menus that reflect safe-mode state after it changes. */
function refreshRuntimeMenus(): void {
	buildApplicationMenu();
	if (tray !== undefined) {
		tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
	}
}

/**
 * Report what the kernel-contract check found, and migrate what is certain.
 *
 * The installed kernel is the source of truth for config vocabularies, and a
 * value it renamed (preset code -> ptc in 0.1.2-rc.1) makes session creation
 * fail with nothing but a console.warn in the web UI - the user sees a dead
 * button. Runs only after the window is up: a note is worth showing, never
 * worth delaying or blocking a working session over.
 */
async function reportConfigCompat(report: CompatReport): Promise<void> {
	const issues = report.dangling.length + report.unknownModels.length;
	if (report.migrated.length > 0) {
		const lines = report.migrated.map(
			(entry) =>
				"- " +
				entry.key +
				": " +
				entry.value +
				" -> " +
				String(entry.replacement),
		);
		await dialog.showMessageBox({
			type: "info",
			title: "已更新配置以匹配当前内核",
			message: "已自动更新 " + String(report.migrated.length) + " 项客户端配置",
			detail:
				lines.join("\n") +
				"\n\n这些取值在 dsh " +
				(report.kernelVersion ?? "当前") +
				" 里已被改名。~/.dsh/settings.yaml 只改动了对应的那一行，其余内容与注释保持不变。" +
				(issues > 0
					? "\n另有 " + String(issues) + " 项无法自动判断，见下一条提示。"
					: ""),
			buttons: ["好的"],
			defaultId: 0,
		});
	}
	if (issues > 0) {
		const lines = [...report.dangling, ...report.unknownModels].map(
			(entry) => "- " + entry.key + ": " + entry.value + "\n  " + entry.reason,
		);
		await dialog.showMessageBox({
			type: "warning",
			title: "部分配置与当前内核不匹配",
			message: "有 " + String(issues) + " 项配置取值在当前内核中无效",
			detail:
				lines.join("\n") +
				"\n\n这些值不会被自动改写（避免猜错）。请在「设置」里重新选择对应项，" +
				"或直接编辑 ~/.dsh/settings.yaml。",
			buttons: ["好的"],
			defaultId: 0,
		});
	}
}

/** Re-run the check from the menu, e.g. after the user edited settings by hand. */
async function manualConfigCheck(): Promise<void> {
	if (bootUserDataDir === undefined) return;
	const report = checkUserConfig({
		desktopDir: DESKTOP_DIR,
		kernelRoot: managedDshRoot(bootUserDataDir),
		userDataDir: bootUserDataDir,
	});
	if (
		report.migrated.length +
			report.dangling.length +
			report.unknownModels.length ===
		0
	) {
		await dialog.showMessageBox({
			type: "info",
			title: "配置兼容性",
			message: "客户端配置与当前内核一致",
		});
		return;
	}
	await reportConfigCompat(report);
}
function findMenuItemById(menu: Menu, id: string): MenuItem | undefined {
	for (const item of menu.items) {
		if (item.id === id) return item;
		if (item.submenu) {
			const found = findMenuItemById(item.submenu, id);
			if (found) return found;
		}
	}
	return undefined;
}

function refreshDshUpdateMenuItem(): void {
	if (dshUpdateMenuItem === undefined) return;
	const label = dshUpdateLabel();
	refreshAboutPanel();
	dshUpdateMenuItem.label = label;
}

function buildApplicationMenu(): void {
	const isMac = process.platform === "darwin";
	const template: MenuItemConstructorOptions[] = [];
	if (isMac) {
		template.push({
			label: APP_NAME,
			submenu: [
				{ label: `关于 ${APP_NAME}`, click: () => showAboutDialog() },
				{ type: "separator" },
				...disabledPluginsMenuItems(),
				{
					id: "dsh-update-item",
					label: dshUpdateLabel(),
					click: () => void menuCheckDshUpdate(),
				},
				{
					label: "检查配置兼容性",
					click: () => {
						void manualConfigCheck();
					},
				},
				{
					label: "检查桌面版更新",
					click: () => void checkAppUpdate(true),
				},
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" },
			],
		});
		template.push({ role: "fileMenu" });
		template.push({ role: "editMenu" });
		template.push({ role: "viewMenu" });
		template.push({ role: "windowMenu" });
	} else {
		template.push({ role: "fileMenu" });
		template.push({ role: "editMenu" });
		template.push({ role: "viewMenu" });
		template.push({ role: "windowMenu" });
		template.push({
			label: "帮助",
			submenu: [
				{ label: `关于 ${APP_NAME}`, click: () => showAboutDialog() },
				{ type: "separator" },
				...disabledPluginsMenuItems(),
				{
					id: "dsh-update-item",
					label: dshUpdateLabel(),
					click: () => void menuCheckDshUpdate(),
				},
				{
					label: "检查配置兼容性",
					click: () => {
						void manualConfigCheck();
					},
				},
				{
					label: "检查桌面版更新",
					click: () => void checkAppUpdate(true),
				},
			],
		});
	}
	const menu = Menu.buildFromTemplate(template);
	dshUpdateMenuItem = findMenuItemById(menu, "dsh-update-item");
	Menu.setApplicationMenu(menu);
}

function hardenSession(): void {
	session.defaultSession.setPermissionCheckHandler(() => false);
	session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => {
		cb(false);
	});
}

function loadIcon(): Electron.NativeImage {
	try {
		const svg = readFileSync(join(DESKTOP_DIR, "resources/icon.svg"), "utf8");
		const img = nativeImage.createFromDataURL(
			`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
		);
		if (!img.isEmpty()) return img;
	} catch {
		/* fallback */
	}
	return nativeImage.createEmpty();
}

async function createMainWindow(): Promise<BrowserWindow> {
	const origin = currentHostOrigin();
	const target = currentHostUrl();
	if (origin === undefined || target === undefined)
		throw new Error("desktop Host is not ready");

	const icon = loadIcon();

	const window = new BrowserWindow({
		width: WINDOW_WIDTH,
		height: WINDOW_HEIGHT,
		minWidth: 960,
		minHeight: 640,
		show: false,
		autoHideMenuBar: true,
		title: APP_NAME,
		icon: icon.isEmpty() ? undefined : icon,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			webSecurity: true,
			preload: join(DESKTOP_DIR, "lib/preload.mjs"),
		},
	});

	mainWindow = window;
	window.on("page-title-updated", (event) => {
		event.preventDefault();
	});
	window.on("close", (event) => {
		lifecycle?.onWindowClose(event);
	});
	window.on("closed", () => {
		if (mainWindow === window) mainWindow = undefined;
	});
	window.webContents.on("will-navigate", (event, url) => {
		const o = currentHostOrigin();
		if (o !== undefined && hasOrigin(url, o)) return;
		event.preventDefault();
		if (isExternalUrl(url)) void shell.openExternal(url);
	});
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (isExternalUrl(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
	await window.loadURL(desktopRendererUrl(target));
	if (!lifecycle?.isQuitting) window.show();
	return window;
}

function trayMenuTemplate(): MenuItemConstructorOptions[] {
	return [
		{
			label: "打开主窗口",
			click: () => {
				void lifecycle?.showWindow();
			},
		},
		{ type: "separator" },
		...disabledPluginsMenuItems(),
		{
			label: "检查 dsh 内核更新",
			click: () => {
				void menuCheckDshUpdate();
			},
		},
		{
			label: "检查配置兼容性",
			click: () => {
				void manualConfigCheck();
			},
		},
		{
			label: "检查应用更新",
			click: () => {
				void checkAppUpdate(true);
			},
		},
		{ type: "separator" },
		{
			label: "退出",
			click: () => {
				void requestAppQuit();
			},
		},
	];
}

function createTray(): void {
	const icon = loadIcon();
	tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
	tray.setToolTip(APP_NAME);
	tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
	tray.on("click", () => {
		void lifecycle?.showWindow();
	});
}

function releaseAppQuit(): void {
	quitReleased = true;
	tray?.destroy();
	tray = undefined;
	app.quit();
}

function requestAppQuit(): Promise<void> {
	if (lifecycle !== undefined) return lifecycle.requestQuit();
	bootQuitPromise ??= (host?.shutdown() ?? Promise.resolve())
		.catch((e) => {
			console.error("desktop shutdown failed:", e);
		})
		.then(() => {
			releaseAppQuit();
		});
	return bootQuitPromise;
}

async function boot(): Promise<void> {
	if (bootQuitPromise !== undefined) return;

	const bootHtml = join(DESKTOP_DIR, "resources/boot.html");
	const bootPreload = join(DESKTOP_DIR, "lib/boot-preload.mjs");
	if (bootWindow === undefined) {
		bootWindow = createBootWindow({
			desktopVersion: DESKTOP_VERSION,
			bootHtmlPath: bootHtml,
			bootPreloadPath: bootPreload,
		});
	}
	bootWindow.show();

	abortController = new AbortController();
	const signal = abortController.signal;
	const userDataDir = app.getPath("userData");
	// 安全模式是跨启动的记忆：上一轮被停用的插件，本轮继续以 --patch 停用，
	// 直到用户在菜单里重新启用（或更新后由启动结果判定）。
	safeDisabled = readSafeMode(userDataDir);
	safePatchFile = safePatchPath(userDataDir);

	setBootRetryHandler(() => {
		void (async () => {
			if (host !== undefined) {
				const previous = host;
				host = undefined;
				await previous.shutdown().catch(() => undefined);
			}
			await boot().catch(handleBootError);
		})();
	});

	const onProgress = (p: NodeProgress): void => {
		bootWindow?.update(p);
	};

	// 阶段一：解析 Node（系统 Node ≥18 优先，否则受管安装 v24 LTS）
	const node = await resolveNode({
		userDataDir,
		config: NODE_VERSIONS,
		desktopDir: DESKTOP_DIR,
		onProgress,
		signal,
	});
	bootNode = node;
	bootUserDataDir = userDataDir;

	// 阶段二：受管安装 dsh（首次联网拉取，走国内镜像）
	const dshEntry = await ensureManagedDsh({
		node,
		userDataDir,
		onProgress,
		signal,
	});

	// 阶段三：Host 监督模型启动 dsh web
	// 打包后 .app 的 PATH 只有系统最小集，dsh 插件 marketplace 会 spawnSync("pnpm")——
	// 注入完整 PATH（受管 pnpm bin + node bin + 系统路径 + 原 PATH）
	const pnpmBin = join(userDataDir, "tools", "pnpm", "node_modules", ".bin");
	const hostEnv: NodeJS.ProcessEnv = {
		...env,
		DSH_DESKTOP: "1",
		PATH: hostPathFor(
			node,
			existsSync(pnpmBin) ? pnpmBin : undefined,
			process.platform as NodeJS.Platform,
			{ PATH: env.PATH },
		),
	};
	// Retained for the repair flows: updating a plugin shells out to dsh itself.
	bootDshEntry = dshEntry;
	bootHostEnv = hostEnv;
	host = createHostSupervisor({
		spawnHost: () =>
			spawnDshWeb({
				nodeExecutable: node.executable,
				dshEntry,
				cwd: env.HOME || process.cwd(),
				env: hostEnv,
				patchFile: safePatchFile,
			}),
		log: (chunk) => process.stderr.write(chunk),
		onUnexpectedExit: ({ code, signal: sig }) => {
			console.error(
				`desktop Host exited unexpectedly (code ${String(code)}, signal ${String(sig)})`,
			);
			void requestAppQuit();
		},
	});

	if (!ipcRegistered) {
		hardenSession();
		registerIpcHandlers();
		ipcRegistered = true;
	}

	lifecycle = createDesktopLifecycle({
		getWindow: () => mainWindow,
		createWindow: createMainWindow,
		loadHost: async (w, url) => {
			await (w as BrowserWindow).loadURL(desktopRendererUrl(url));
		},
		disposeHost: async () => {
			await host?.shutdown();
		},
		quit: releaseAppQuit,
		reportError: (e) => {
			console.error("desktop shutdown failed:", e);
		},
	});

	bootWindow.update({ stage: "installing-dsh", detail: "正在启动 dsh…" });
	const recovered = await startWithPluginRecovery(
		pluginRecovery(host, userDataDir, onProgress),
	);

	DSH_VERSION = readManagedDshVersion(userDataDir);
	refreshAboutPanel();
	buildApplicationMenu();

	bootWindow.close();
	bootWindow = undefined;
	createTray();
	await lifecycle.showWindow();
	// 只有本轮真的停用了插件才打扰用户；历史停用项安静地留在菜单里。
	await notifyRecoveredPlugins(recovered);
	// 内核改过公共配置值域而用户文件里还留着旧值时（预设 code -> ptc 这类），
	// 建会话会静默失败，所以在窗口起来之后按当前已装内核校验并迁移能确定安全的那部分。
	void reportConfigCompat(
		checkUserConfig({
			desktopDir: DESKTOP_DIR,
			kernelRoot: managedDshRoot(userDataDir),
			userDataDir,
		}),
	);

	// 非阻塞：启动后异步检查 dsh 是否有更新（不阻塞启动、不自动安装），用于「检查更新」菜单项
	void checkDshUpdate(userDataDir)
		.then(({ available, latest }) => {
			DSH_UPDATE_AVAILABLE = available;
			DSH_LATEST = latest;
			refreshDshUpdateMenuItem();
		})
		.catch(() => {
			/* ignore */
		});

	// 非阻塞：启动后异步检查应用本身的新版本（GitHub Release），有新版弹窗提示下载
	void checkAppUpdate(false);
}

async function handleBootError(error: unknown): Promise<void> {
	console.error("desktop startup failed:", error);
	if (bootWindow !== undefined) {
		const message = error instanceof Error ? error.message : String(error);
		bootWindow.showError(message);
		return;
	}
	const { dialog } = await import("electron");
	await dialog.showMessageBox({
		type: "error",
		title: `${APP_NAME} failed to start`,
		message: error instanceof Error ? error.message : String(error),
	});
	await requestAppQuit();
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else if (isInstallerQuitRequest(process.argv)) {
	app.quit();
} else {
	app.on("second-instance", (_e, cl) => {
		if (isInstallerQuitRequest(cl)) {
			void requestAppQuit();
			return;
		}
		void lifecycle?.showWindow();
	});
	app.on("activate", () => {
		void lifecycle?.showWindow();
	});
	app.on("window-all-closed", () => {});
	app.on("before-quit", (event: Event) => {
		if (quitReleased) return;
		event.preventDefault();
		abortController?.abort();
		void requestAppQuit();
	});
	app
		.whenReady()
		.then(boot)
		.catch((error: unknown) => {
			void handleBootError(error);
		});
}
