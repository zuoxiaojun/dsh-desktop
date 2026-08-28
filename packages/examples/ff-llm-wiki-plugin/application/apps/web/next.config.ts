import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 允许 Next 直接编译 workspace 内以 TypeScript 源码发布的 contracts 包。
  transpilePackages: ["@llmwiki/contracts"],
  // 不自动生成 AGENTS.md / CLAUDE.md，保持工作区干净。
  agentRules: false,
  // 允许通过 127.0.0.1 直连访问 dev 资源（Staging 验收走 127.0.0.1 而非 localhost）。
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
