export type TenantProviderPointRow = {
  providerId: string;
  providerName: string;
  providerStatus: string;
  upstreamPoint: string;
  platformMarkup: string;
  downstreamPoint: string;
  customPoint: string | null;
  effectivePoint: string;
  effectivePlatformMarkup?: string;
  isCustom?: boolean;
};

export type TenantPointMutationResponse = {
  success?: boolean;
  customPoint?: string | null;
  effectivePoint?: string;
  effectivePlatformMarkup?: string;
  isCustom?: boolean;
  deleted?: boolean;
  row?: TenantProviderPointRow;
  error?: string;
};
