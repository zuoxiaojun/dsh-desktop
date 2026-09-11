/** @type {import('electron-builder').Configuration} */
module.exports = {
	appId: "com.dsh.desktop",
	productName: "DSH Desktop",
	artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
	directories: {
		app: "apps/desktop",
		output: "dist",
	},
	files: [
		"lib/**",
		"package.json",
		"resources/icon.svg",
		"resources/boot.html",
		// 运行时读取的清单/映射（node-versions、version、config-renames）一并打包。
		// 用通配符而不是逐个列举：曾漏列 config-renames.json，导致生产版改名表恒为空、
		// 配置自动迁移永不触发（dev 模式文件在磁盘上，看不出来）。
		"resources/*.json",
		"build/icon.png",
	],
	extraResources: [
		// Bundle Node.js runtime (platform-specific, downloaded by prepare-node.ts)
		{
			from: "apps/desktop/resources/",
			to: ".",
			filter: ["node-bundle-*"],
		},
	],
	electronDist: require("path").resolve(
		__dirname,
		"../../node_modules/electron/dist",
	),
	mac: {
		category: "public.app-category.developer-tools",
		icon: "apps/desktop/build/icon.icns",
		target: [
			{ target: "dmg", arch: "arm64" },
			{ target: "dmg", arch: "x64" },
		],
	},
	dmg: {
		title: "DSH Desktop ${version}",
		artifactName: "${productName}-${version}-${arch}.${ext}",
		icon: "apps/desktop/build/icon.icns",
		background: undefined,
		contents: [
			{ x: 130, y: 220, type: "file" },
			{ x: 410, y: 220, type: "link", path: "/Applications" },
		],
	},
	win: {
		icon: "apps/desktop/build/icon.png",
		target: [{ target: "nsis", arch: "x64" }],
	},
	nsis: {
		oneClick: false,
		allowToChangeInstallationDirectory: true,
		deleteAppDataOnUninstall: false,
		artifactName: "${productName}-${version}-setup-${arch}.${ext}",
	},
	linux: {
		category: "Development",
		target: [{ target: "AppImage", arch: "x64" }],
	},
};
