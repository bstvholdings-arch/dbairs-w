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
