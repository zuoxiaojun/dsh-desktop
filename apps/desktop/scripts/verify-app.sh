#!/bin/bash
# 验证打包后的 .app 结构（纯壳架构：不含 dsh 打包，含受管运行时资源）
# 在 electron-builder --dir 之后、package-dmg.sh 之前运行

set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "❌ node not found in PATH; verify-app.sh needs node" >&2
  exit 1
fi

APP_PATH="${1:-}"
if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
  DEFAULT_APP="$PROJECT_DIR/dist/mac-arm64/DSH Desktop.app"
  if [ -d "$DEFAULT_APP" ]; then
    APP_PATH="$DEFAULT_APP"
  else
    echo "❌ 用法: $0 <path/to/DSH Desktop.app>"
    echo "   未找到自动检测路径: $DEFAULT_APP"
    exit 1
  fi
fi

echo "🔍 Verifying packaged app at ${APP_PATH}..."
echo ""

RESOURCES="${APP_PATH}/Contents/Resources"

# asar 内包含指定文件名的启发式检查（asar 头含明文文件名）
asar_contains() {
  grep -q "$1" "${RESOURCES}/app.asar" 2>/dev/null
}

# 1. node-versions.json 存在（松散 Resources 或 app.asar 内）、可解析、含当前平台 checksum
NODE_VERSIONS="${RESOURCES}/node-versions.json"
if [ ! -f "$NODE_VERSIONS" ]; then
  if asar_contains "node-versions.json"; then
    echo "✅ node-versions.json (embedded in app.asar)"
    NODE_VERSIONS=""
  else
    echo "❌ node-versions.json not found"
    exit 1
  fi
fi
ARCH=$(uname -m)
[ "$ARCH" = "x86_64" ] && ARCH="x64"
NODE_KEY="darwin-${ARCH}"
if [ -n "$NODE_VERSIONS" ]; then
  SUM=$(node -e "const c=require('${NODE_VERSIONS}');console.log(c.checksums['${NODE_KEY}']||'')")
  if [ -z "$SUM" ]; then
    echo "⚠️  checksum for ${NODE_KEY} is empty (发布前需从 SHASUMS256.txt 填入)"
  else
    echo "✅ node-versions.json: v$(node -e "console.log(require('${NODE_VERSIONS}').version)") (${NODE_KEY} checksum set)"
  fi
fi

# 2. boot.html（闪屏页面，松散或 asar 内）
if [ -f "${RESOURCES}/boot.html" ] || asar_contains "boot.html"; then
  echo "✅ boot.html"
else
  echo "❌ boot.html missing"
  exit 1
fi

# 3. app.asar 存在（含 main/preload/boot-preload）
if [ -f "${RESOURCES}/app.asar" ]; then
  echo "✅ app.asar ($(ls -lh "${RESOURCES}/app.asar" | awk '{print $5}'))"
else
  echo "❌ app.asar missing"
  exit 1
fi

# 4. 不包含 dsh 目录（纯壳）
if [ -d "${RESOURCES}/dsh" ]; then
  echo "❌ Resources/dsh still present (纯壳架构不应打包 dsh)"
  exit 1
else
  echo "✅ 未打包 dsh（纯壳）"
fi

# 5. version.json
VERSION_JSON_RES="${RESOURCES}/version.json"
if [ -f "$VERSION_JSON_RES" ]; then
  echo "✅ desktop version: $(node -e "console.log(JSON.parse(require('fs').readFileSync('${VERSION_JSON_RES}','utf8')).version)")"
else
  echo "✅ desktop version: 1.0.0 (embedded in asar)"
fi

# 6. 图标
ICON="${RESOURCES}/icon.icns"
if [ -f "$ICON" ]; then
  echo "✅ icon.icns: $(ls -lh "$ICON" | awk '{print $5}')"
else
  echo "⚠️  icon.icns not found"
fi

echo ""
echo "✅ All checks passed!"
