import { connection } from "next/server";

/**
 * 极简心跳接口：`GET /api/ping` → 200 pong。
 *
 * 只做一件事：证明「这台服务器此刻还能回包」。
 * 因此**禁止**在这里查库、读 cookie、鉴权或做任何 IO ——
 * 前台 `<DomainGuard />` 每 30 秒打一次，慢一点就会误判成线路故障，
 * 跟着触发「自动跳到备用域名」，等于把好好的站点踢下线。
 *
 * 两个细节：
 * - `await connection()`：cacheComponents 下显式声明「必须请求期执行」，
 *   避免这个响应被预渲染成静态文件后由 CDN 直接回 200（那样服务器挂了也测不出来）；
 * - `Cache-Control: no-store`：浏览器 / 中间代理不许缓存，否则心跳变成读缓存，
 *   永远返回上次的 200。
 */
export async function GET() {
  await connection();

  return new Response("pong", {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
