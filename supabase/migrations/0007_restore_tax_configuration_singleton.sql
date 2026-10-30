insert into public.tax_configuration (singleton, enabled, rate_bps)
values (true, false, 0)
on conflict (singleton) do nothing;
