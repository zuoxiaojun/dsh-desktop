/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.dsh.desktop',
  productName: 'DSH Desktop',
  directories: {
    app: 'apps/desktop',
    output: 'dist',
  },
  files: [
    'lib/**',
    'package.json',
  ],
  extraResources: [],
  mac: {
    category: 'public.app-category.developer-tools',
    icon: 'apps/desktop/build/icon.png',
    target: ['dir'],
  },
  win: {
    icon: 'apps/desktop/build/icon.png',
    target: ['nsis'],
  },
  linux: {
    category: 'Development',
    target: ['dir'],
  },
}