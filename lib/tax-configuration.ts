export type TaxConfiguration = {
  enabled: boolean;
  rate_bps: number;
};

export type TaxConfigurationResult = {
  configuration: TaxConfiguration;
  fallbackApplied: boolean;
};

type TaxConfigurationRpcRow = TaxConfiguration & {
  fallback_applied: boolean;
};

export function resolveTaxConfigurationResult(data: unknown): TaxConfigurationResult {
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error("Tax configuration RPC returned an invalid result");
  }

  const row: unknown = data[0];
  if (typeof row !== "object" || row === null ||
    !("enabled" in row) || typeof row.enabled !== "boolean" ||
    !("rate_bps" in row) || typeof row.rate_bps !== "number" ||
    !Number.isInteger(row.rate_bps) || row.rate_bps < 0 || row.rate_bps > 10000 ||
    !("fallback_applied" in row) || typeof row.fallback_applied !== "boolean") {
    throw new Error("Tax configuration RPC returned an invalid result");
  }

  const configuration: TaxConfigurationRpcRow = {
    enabled: row.enabled,
    rate_bps: row.rate_bps,
    fallback_applied: row.fallback_applied,
  };
  if (configuration.fallback_applied &&
    (configuration.enabled || configuration.rate_bps !== 0)) {
    throw new Error("Tax configuration RPC returned an invalid fallback");
  }

  return {
    configuration: {
      enabled: configuration.enabled,
      rate_bps: configuration.rate_bps,
    },
    fallbackApplied: configuration.fallback_applied,
  };
}

export function resolveTaxConfigurationRpcResult(
  data: unknown,
  error: unknown,
): TaxConfigurationResult {
  if (error) throw error;
  return resolveTaxConfigurationResult(data);
}

export function taxConfigurationErrorCategory(error: unknown) {
  const value = typeof error === "object" && error !== null
    ? error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown }
    : {};
  const code = typeof value.code === "string" ? value.code : "";
  const status = typeof value.status === "number" ? value.status : undefined;

  if (code === "42501" || code === "PGRST301" || status === 401 || status === 403) {
    return "permission_or_authentication_error";
  }
  if (code.startsWith("08") || code === "28P01" || value.name === "TypeError" ||
    (typeof value.message === "string" && /fetch failed|network|supabase is not configured|invalid url/i.test(value.message))) {
    return "connection_or_environment_error";
  }
  if (["42P01", "42703", "42883", "3F000", "PGRST202", "PGRST203", "PGRST204", "PGRST205"].includes(code)) {
    return "schema_or_table_error";
  }
  return "database_query_error";
}

export function getSupabaseProjectHost() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configuredUrl) return "missing";
  try {
    const hostname = new URL(configuredUrl).hostname.toLowerCase();
    return /^[a-z0-9.-]+$/.test(hostname) ? hostname : "invalid";
  } catch {
    return "invalid";
  }
}
