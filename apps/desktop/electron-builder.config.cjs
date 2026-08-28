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
    "build/icon.png",
    "!resources/dsh/**",
  ],
  extraResources: [
    {
      from: "apps/desktop/resources/dsh/node_modules",
      to: "dsh/node_modules",
      filter: ["**/*"],
    },
    {
      from: "apps/desktop/resources/dsh/package.json",
      to: "dsh/package.json",
    },
  ],
  electronDist: require("path").resolve(
    __dirname,
    "../../node_modules/electron/dist",
  ),
  mac: {
    category: "public.app-category.developer-tools",
    icon: "build/icon.icns",
    target: [
      { target: "dmg", arch: "arm64" },
      { target: "dmg", arch: "x64" },
    ],
  },
  dmg: {
    title: "DSH Desktop ${version}",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    icon: "build/icon.icns",
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
