#!/bin/bash
# 用 macOS hdiutil 制作 DMG 安装包
# 替代 electron-builder 的 DMG 目标（因 @electron/get 兼容性问题）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$APP_DIR/../.." && pwd)"

APP_NAME="DSH Desktop"
APP_PATH="${PROJECT_DIR}/dist/mac-arm64/${APP_NAME}.app"
VERSION="1.0.0"
DMG_NAME="${APP_NAME}-${VERSION}-arm64"
DMG_OUTPUT="${PROJECT_DIR}/dist/${DMG_NAME}.dmg"
STAGING_DIR="/tmp/dsh-dmg-staging"

echo "📦 Packaging DMG for ${APP_NAME} ${VERSION}..."

# 检查 .app
if [ ! -d "$APP_PATH" ]; then
  echo "❌ .app not found at ${APP_PATH}"
  echo "   Run 'pnpm run build && npx electron-builder --dir --mac --config apps/desktop/electron-builder.config.cjs' first"
  exit 1
fi

# 清理临时目录
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

# 复制 .app
echo "   Copying .app..."
cp -R "$APP_PATH" "$STAGING_DIR/"

# 复制移除安全验证脚本
echo "   Copying 移除安全验证.command..."
cp "$APP_DIR/resources/移除安全验证.command" "$STAGING_DIR/"

# 创建 Applications 链接
ln -s /Applications "$STAGING_DIR/Applications"

# 创建 DMG
echo "   Creating DMG with hdiutil..."
rm -f "$DMG_OUTPUT"
hdiutil create -volname "DSH Desktop ${VERSION}" \
  -srcfolder "$STAGING_DIR" \
  -ov -format UDZO -size 2g \
  "$DMG_OUTPUT"

# 清理
rm -rf "$STAGING_DIR"

echo "✅ DMG created: ${DMG_OUTPUT}"
ls -lh "$DMG_OUTPUT"
