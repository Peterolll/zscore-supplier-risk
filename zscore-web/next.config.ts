import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite 是 Node 内置模块（实验性），不可被打包，需标记为外部依赖
  serverExternalPackages: ["node:sqlite"],
};

export default nextConfig;
