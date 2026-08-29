#!/bin/bash
# 用 macOS hdiutil 制作 DMG 安装包
# 替代 electron-builder 的 DMG 目标（因 @electron/get 兼容性问题）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$APP_DIR/../.." && pwd)"

APP_NAME="DSH Desktop"
# 自动识别打包架构：electron-builder --dir --mac 在 arm64 机器产出 mac-arm64，x64 机器产出 mac
if [ -d "${PROJECT_DIR}/dist/mac-arm64" ]; then
  BUILD_ARCH="mac-arm64"
  DMG_ARCH="arm64"
elif [ -d "${PROJECT_DIR}/dist/mac" ]; then
  BUILD_ARCH="mac"
  DMG_ARCH="x64"
else
  echo "❌ 未找到 .app：dist/mac-arm64 或 dist/mac 均不存在"
  echo "   请先运行 electron-builder --dir --mac"
  exit 1
fi
APP_PATH="${PROJECT_DIR}/dist/${BUILD_ARCH}/${APP_NAME}.app"
VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${APP_DIR}/resources/version.json" | head -1)"
[ -z "$VERSION" ] && VERSION="1.0.0"
DMG_NAME="${APP_NAME}-${VERSION}-${DMG_ARCH}"
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

# 自签名证书深度签名（避免 ad-hoc 签名被 macOS 判为「已损坏」）
# ad-hoc 签名（--sign -）在较新的 macOS（尤其 Sequoia 15）上会把下载的安装包判为
# 「已损坏」且右键也无法打开；改用自签名证书后签名是「真实证书」，Gatekeeper
# 显示「无法验证开发者 / 安全性阻止打开」，用户「右键 → 打开」即可运行；
# 只有将来配置 Apple Developer ID + 公证，才能双击直达。
SIGN_IDENTITY="DSH Desktop Developer"
SIGN_PASS="${DSH_DESKTOP_SIGN_PASS:-dsh-signing}"
SIGN_CERT="/tmp/dsh-desktop-signing.crt"
SIGN_KEY="/tmp/dsh-desktop-signing.key"
SIGN_P12="/tmp/dsh-desktop-signing.p12"

ensure_signing_identity() {
  if security find-identity -p codesigning login.keychain 2>/dev/null | grep -q "${SIGN_IDENTITY}"; then
    return 0
  fi
  rm -f "${SIGN_CERT}" "${SIGN_KEY}" "${SIGN_P12}"
  openssl req -x509 -newkey rsa:2048 -keyout "${SIGN_KEY}" -out "${SIGN_CERT}" -days 3650 -nodes \
    -subj "/CN=${SIGN_IDENTITY}" \
    -addext "extendedKeyUsage=codeSigning" -addext "keyUsage=digitalSignature" 2>/dev/null
  openssl pkcs12 -export -legacy -inkey "${SIGN_KEY}" -in "${SIGN_CERT}" -out "${SIGN_P12}" -passout pass:"${SIGN_PASS}" 2>/dev/null
  security import "${SIGN_P12}" -k login.keychain -P "${SIGN_PASS}" -T /usr/bin/codesign >/dev/null 2>&1 || return 1
  rm -f "${SIGN_CERT}" "${SIGN_KEY}" "${SIGN_P12}"
}

ensure_signing_identity
echo "   Signing app bundle with self-signed identity..."
codesign --force --deep --sign "${SIGN_IDENTITY}" "${STAGING_DIR}/${APP_NAME}.app"

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

# 清理中间产物：只保留最终 DMG
# electron-builder --dir 留下的 unpacked .app（dist/mac、dist/mac-arm64）与
# debug/effective-config yml、.DS_Store 都不是交付物，在此一并删除。
echo ""
echo "   Cleaning intermediate build artifacts..."
rm -rf "${PROJECT_DIR}/dist/mac" "${PROJECT_DIR}/dist/mac-arm64"
rm -f "${PROJECT_DIR}/dist/builder-debug.yml" \
      "${PROJECT_DIR}/dist/builder-effective-config.yaml" \
      "${PROJECT_DIR}/dist/.DS_Store"
echo "✅ Done. Remaining files in dist/:"
ls -1 "${PROJECT_DIR}/dist" 2>/dev/null || true
