-- ============================================================================
-- Migração incremental 005: Grade de Tamanhos em public.products
-- Seguro para executar em bancos já em produção (não apaga nem altera produtos).
-- ============================================================================

alter table public.products
  add column if not exists sizes jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_sizes_is_array_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_sizes_is_array_check
      check (jsonb_typeof(sizes) = 'array');
  end if;
end
$$;

notify pgrst, 'reload schema';
