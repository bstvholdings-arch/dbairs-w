import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Next 的 dev server 默认只信任 localhost 这个来源。用 http://127.0.0.1:3000
  // 或局域网 IP 打开时，它会拒绝自己的资源/端点（HMR WebSocket 握手失败），
  // 结果是页面 HTML 正常、但客户端脚本不 hydrate —— 表现为「所有按钮点了都没反应」。
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
