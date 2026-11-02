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
  return configuration ?? { enabled: false, rate_bps: 0 };
}
