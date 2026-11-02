export type AdminGameRow = {
  id: string;
  name: string;
  externalId: string;
  providerId: string;
  providerName: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
  syncedAt: string;
};

export type AdminProviderOption = {
  id: string;
  name: string;
  isActive: boolean;
};

export type GameListResponse = {
  games?: AdminGameRow[];
  error?: string;
};

export type GameMutationResponse = {
  success?: boolean;
  game?: AdminGameRow;
  error?: string;
};

export type GameSyncResponse = {
  success?: boolean;
  scope?: "provider" | "all";
  results?: Array<{
    providerId: string;
    providerName: string;
    fetched: number;
    created: number;
    updated: number;
    /** 真实接口接入前恒为 mock */
    mode?: "mock";
    /** 游戏商 API 凭据（endpoint + merchantId + apiSecret）是否齐全 */
    configured?: boolean;
    /** 配置缺失 / 非法提示 */
    warnings?: string[];
    /** 本次「会发出去的请求」描述（不含密钥明文） */
    request?: {
      mode: "mock";
      method: "POST";
      url: string;
      merchantId: string;
      signaturePreview: string;
      signedAt: string;
    };
  }>;
  totals?: {
    providers: number;
    created: number;
    updated: number;
  };
  error?: string;
};

export type Banner = {
  type: "success" | "error";
  text: string;
};
