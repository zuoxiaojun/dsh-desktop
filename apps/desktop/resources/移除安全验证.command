#!/bin/bash
# DSH Desktop - 移除安全验证（双击运行）
# 把 DSH Desktop.app 拖到 Applications 文件夹后，双击此脚本即可移除 Gatekeeper 安全验证
# 若 app 的 bundle 签名缺失/损坏（报"app 已损坏，无法打开"），脚本会自动重建 ad-hoc 签名后放行

set -euo pipefail

APP_NAME="DSH Desktop"
BUNDLE_ID="com.dsh.desktop"

# --- 自动定位 app（不写死路径） ---
find_app() {
  # 1. 已拖到 /Applications
  if [ -d "/Applications/${APP_NAME}.app" ]; then
    echo "/Applications/${APP_NAME}.app"; return 0
  fi
  # 2. 用户目录的 Applications
  if [ -d "${HOME}/Applications/${APP_NAME}.app" ]; then
    echo "${HOME}/Applications/${APP_NAME}.app"; return 0
  fi
  # 3. 脚本所在目录（DMG 内 / 解压目录）
  local here
  here="$(cd "$(dirname "$0")" && pwd)"
  if [ -d "${here}/${APP_NAME}.app" ]; then
    echo "${here}/${APP_NAME}.app"; return 0
  fi
  # 4. 用 Spotlight 按 bundle id 搜索
  local hit
  hit="$(mdfind "kMDItemCFBundleIdentifier == '${BUNDLE_ID}'" 2>/dev/null | head -n 1 || true)"
  if [ -n "$hit" ] && [ -d "$hit" ]; then
    echo "$hit"; return 0
  fi
  return 1
}

echo "🔍 正在定位 ${APP_NAME}.app ..."
APP_PATH=""
if ! APP_PATH="$(find_app)"; then
  echo ""
  echo "❌ 未找到 ${APP_NAME}.app"
  echo "   请先把 ${APP_NAME}.app 拖到 Applications 文件夹，再运行此脚本"
  echo ""
  if [ -t 0 ]; then read -r -p "按回车键退出..." _; fi
  exit 1
fi
echo "✅ 找到: ${APP_PATH}"
echo ""

echo "🔓 正在移除 ${APP_NAME} 的安全验证..."
echo ""

# 1) 移除 quarantine 等扩展属性（"来自未知开发者"提示的来源）
echo "   [1/2] 清理 quarantine 扩展属性..."
xattr -cr "$APP_PATH" 2>/dev/null || true

# 2) 若 bundle 签名缺失或无效，重建 ad-hoc 深度签名
#    否则 spctl 会判定为"已损坏"，只删 quarantine 打开不了
if [ ! -d "${APP_PATH}/Contents/_CodeSignature" ] || ! codesign --verify "$APP_PATH" >/dev/null 2>&1; then
  echo "   [2/2] 重建 ad-hoc 签名（修复缺失/损坏的 bundle 签名）..."
  codesign --force --deep --sign - "$APP_PATH"
else
  echo "   [2/2] bundle 签名有效，无需重建"
fi

echo ""
if codesign --verify "$APP_PATH" >/dev/null 2>&1; then
  echo "✅ 安全验证已移除！现在可以正常打开 ${APP_NAME} 了"
else
  echo "⚠️  处理完成，但签名校验仍异常，请尝试重新下载安装包"
fi

echo ""
echo "   打开方式："
echo "   1. 在 Launchpad 中找到 DSH Desktop"
echo "   2. 或在 Applications 文件夹中双击"
echo "   3. 或在终端中执行: open \"${APP_PATH}\""
echo ""
if [ -t 0 ]; then read -r -p "按回车键退出..." _; fi
