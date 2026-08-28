#!/bin/bash
# DSH Desktop - 移除安全验证（双击运行）
# 把 DSH Desktop.app 拖到 Applications 文件夹后，双击此脚本即可移除安全验证提示

set -euo pipefail

APP_NAME="DSH Desktop"
APP_PATH="/Applications/${APP_NAME}.app"

if [ ! -d "$APP_PATH" ]; then
  echo "❌ 未找到 ${APP_NAME}.app"
  echo "   请先把 ${APP_NAME}.app 拖到 Applications 文件夹，再运行此脚本"
  echo ""
  read -p "按回车键退出..." _
  exit 1
fi

echo "🔓 正在移除 ${APP_NAME} 的安全验证..."
echo ""

# 移除 quarantine 属性（禁止 Gatekeeper 弹窗）
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true

# 移除所有扩展属性
xattr -cr "$APP_PATH" 2>/dev/null || true

echo "✅ 安全验证已移除！现在可以正常打开 ${APP_NAME} 了"
echo ""
echo "   打开方式："
echo "   1. 在 Launchpad 中找到 DSH Desktop"
echo "   2. 或在 Applications 文件夹中双击"
echo "   3. 或在终端中执行：open ${APP_PATH}"
echo ""
read -p "按回车键退出..." _