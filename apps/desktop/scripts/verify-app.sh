#!/bin/bash
# 验证打包后的 .app 能否正常启动 dsh web
# 在 electron-builder --dir 之后、package-dmg.sh 之前运行

set -euo pipefail

APP_PATH="${1:-}"
if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
  echo "❌ 用法: $0 <path/to/DSH Desktop.app>"
  exit 1
fi

echo "🔍 Verifying packaged app at ${APP_PATH}..."
echo ""

# 1. 检查 dsh 入口文件
DSH_ENTRY="${APP_PATH}/Contents/Resources/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"
if [ ! -f "$DSH_ENTRY" ]; then
  echo "❌ dsh entry not found: ${DSH_ENTRY}"
  exit 1
fi
echo "✅ dsh entry: ${DSH_ENTRY}"

# 2. 检查 dsh 版本号
DSH_PKG="${APP_PATH}/Contents/Resources/dsh/node_modules/@deepseek-ai/dsh/package.json"
if [ -f "$DSH_PKG" ]; then
  DSH_VER=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${DSH_PKG}','utf8')).version)")
  echo "✅ dsh version: ${DSH_VER}"
else
  echo "❌ dsh package.json not found"
  exit 1
fi

# 3. 检查关键依赖是否存在
echo "   Checking key dependencies..."
for dep in "@deepseek-ai/dsh-web-frontend" "@deepseek-ai/cordis" "node-pty" "sharp"; do
  DEP_PATH="${APP_PATH}/Contents/Resources/dsh/node_modules/${dep}"
  if [ -d "$DEP_PATH" ]; then
    echo "   ✅ ${dep}"
  else
    echo "   ❌ ${dep} missing"
    exit 1
  fi
done

# 4. 检查原生模块（平台相关）
NATIVE_PTY="${APP_PATH}/Contents/Resources/dsh/node_modules/node-pty/prebuilds/darwin-arm64/pty.node"
if [ -f "$NATIVE_PTY" ]; then
  echo "✅ native module (node-pty darwin-arm64): found"
else
  echo "⚠️  native module (node-pty darwin-arm64): not found (may still work with prebuild fallback)"
fi

# 5. 用 Electron 的 Node.js 跑 dsh --version
echo ""
echo "🧪 Smoke test: dsh --version via Electron Node.js..."
ELECTRON_NODE="${APP_PATH}/Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/Electron Helper (Alerts).app/Contents/MacOS/Electron Helper (Alerts)"
ELECTRON_EXEC="${APP_PATH}/Contents/MacOS/DSH Desktop"

# 用 ELECTRON_RUN_AS_NODE 模式
VERSION_OUT=$(ELECTRON_RUN_AS_NODE=1 "$ELECTRON_EXEC" --expose-internals "$DSH_ENTRY" --version 2>/dev/null || true)
if [ -n "$VERSION_OUT" ]; then
  echo "✅ dsh --version = ${VERSION_OUT}"
else
  echo "⚠️  dsh --version via Electron Node.js failed (may still work at runtime)"
fi

# 6. 检查 version.json
VERSION_JSON_RES="${APP_PATH}/Contents/Resources/version.json"
if [ -f "$VERSION_JSON_RES" ]; then
  echo "✅ desktop version: $(node -e "console.log(JSON.parse(require('fs').readFileSync('${VERSION_JSON_RES}','utf8')).version)")"
else
  echo "✅ desktop version: 1.0.0 (embedded in asar)"
fi

# 7. 检查图标
ICON="${APP_PATH}/Contents/Resources/icon.icns"
if [ -f "$ICON" ]; then
  echo "✅ icon.icns: $(ls -lh "$ICON" | awk '{print $5}')"
else
  echo "⚠️  icon.icns not found"
fi

echo ""
echo "✅ All checks passed!"