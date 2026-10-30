/**
 * 兼容旧调用路径：/api/admin/providers/[id]
 * 实际实现位于 /api/providers/[id]，包含 GET / PATCH / PUT / DELETE。
 */
export {
  DELETE,
  GET,
  PATCH,
  PUT,
} from "@/app/api/providers/[id]/route";
