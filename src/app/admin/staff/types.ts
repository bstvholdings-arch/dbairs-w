import { STAFF_ROLES, type StaffRole } from "@/lib/rbac";
import {
  STAFF_PASSWORD_MAX_LENGTH,
  STAFF_PASSWORD_MIN_LENGTH,
  STAFF_USERNAME_PATTERN,
} from "@/lib/staff-validation";

/** 员工管理页可选角色（顺序即下拉框顺序：权限从高到低）。 */
export const STAFF_ROLE_OPTIONS: readonly StaffRole[] = STAFF_ROLES;

/** 前端复用的校验规则（与 /api/admin/staff 完全一致）。 */
export { STAFF_PASSWORD_MAX_LENGTH, STAFF_PASSWORD_MIN_LENGTH, STAFF_USERNAME_PATTERN };

export type StaffRow = {
  id: string;
  username: string;
  role: StaffRole;
  createdAt: string;
};

export type StaffMutationResponse = {
  success?: boolean;
  staff?: StaffRow;
  error?: string;
};

export type StaffFormValues = {
  username: string;
  password: string;
  role: StaffRole;
};

