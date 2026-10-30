export const WITHDRAWAL_APPROVAL_OPTIONS = [1, 2, 3] as const;

export const TENANT_STATUS_OPTIONS = [
  { value: "active", labelKey: "tenant.status.active" },
  { value: "trial", labelKey: "tenant.status.trial" },
  { value: "suspended", labelKey: "tenant.status.suspended" },
] as const;

export type TenantRow = {
  id: string;
  name: string;
  domain: string;
  subdomain: string;
  status: string;
  withdrawalRequiredApprovals: number;
  createdAt: string;
};

export type TenantMutationResponse = {
  success?: boolean;
  tenant?: TenantRow;
  error?: string;
};

export type TenantFormValues = {
  name: string;
  domain: string;
  subdomain: string;
  status: string;
  withdrawalRequiredApprovals: number;
};
