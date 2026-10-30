/**
 * 平台级租户接口别名：/api/admin/tenants/[id]
 * 实际实现位于 /api/tenants/[id]，包含 GET / PATCH / PUT / DELETE。
 */
export {
  DELETE,
  GET,
  PATCH,
  PUT,
} from "@/app/api/tenants/[id]/route";
