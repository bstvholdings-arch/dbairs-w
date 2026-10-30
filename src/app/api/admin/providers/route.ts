/**
 * 兼容旧调用路径：/api/admin/providers
 * 实际实现位于 /api/providers，前端与外部调用均可使用任一地址。
 */
export { GET, POST } from "@/app/api/providers/route";
