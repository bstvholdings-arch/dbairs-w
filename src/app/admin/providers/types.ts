export type ProviderRow = {
  id: string;
  name: string;
  upstreamPoint: string;
  platformMarkup: string;
  downstreamPoint: string;
  status: string;
  /** 大厅排序权重，越大越靠前 */
  sortOrder: number;
  /** 是否在大厅上架 */
  isActive: boolean;
  /** 已同步的游戏数量 */
  gameCount: number;
  tenantOverrideCount: number;
  betRecordCount: number;
  updatedAt: string;
};

export type ProviderMutationResponse = {
  success?: boolean;
  provider?: ProviderRow;
  error?: string;
};

export type ProviderSyncResponse = {
  success?: boolean;
  scope?: "provider" | "all";
  result?: {
    providerId: string;
    providerName: string;
    fetched: number;
    created: number;
    updated: number;
  };
  totals?: {
    providers: number;
    created: number;
    updated: number;
  };
  error?: string;
};

export type ProviderFormValues = {
  name: string;
  upstreamPoint: string;
  platformMarkup: string;
};

export type Banner = {
  type: "success" | "error";
  text: string;
};
