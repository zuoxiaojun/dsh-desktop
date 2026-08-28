/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.dsh.desktop",
  productName: "DSH Desktop",
  directories: {
    app: "apps/desktop",
    output: "dist",
  },
  files: ["lib/**", "package.json", "resources/**", "build/icon.png"],
  extraResources: [],
  electronDist: require("path").resolve(
    __dirname,
    "../../node_modules/electron/dist",
  ),
  mac: {
    category: "public.app-category.developer-tools",
    icon: "build/icon.icns",
    target: ["dir"],
  },
  win: {
    icon: "apps/desktop/build/icon.png",
    target: ["nsis"],
  },
  linux: {
    category: "Development",
    target: ["dir"],
  },
};
