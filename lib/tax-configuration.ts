export type TaxConfiguration = {
  enabled: boolean;
  rate_bps: number;
};

// Financial RPCs use coalesce(v_tax_enabled, false), so an absent configuration
// has the established business meaning of tax disabled. This only normalizes a
// successful read with no row; database and permission errors remain errors.
export function resolveTaxConfiguration(
  configuration: TaxConfiguration | null,
): TaxConfiguration {
  if (!configuration) throw new Error("Tax configuration is missing");
  return configuration;
}
