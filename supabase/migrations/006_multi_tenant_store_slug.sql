-- ============================================================================
-- Migração incremental 006: Multi-Tenant isolado por store_slug
-- Seguro para atualizar bancos já existentes para o modelo Multi-Tenant.
-- ============================================================================

create extension if not exists pgcrypto;

-- 1. Adicionar store_slug nas tabelas principais
alter table public.products
  add column if not exists store_slug text not null default 'default';

alter table public.hero_banners
  add column if not exists store_slug text not null default 'default';

alter table public.coupons
  add column if not exists store_slug text not null default 'default';

alter table public.catalog_options
  add column if not exists store_slug text not null default 'default';

alter table public.admin_profiles
  add column if not exists store_slug text not null default 'default';

-- 2. Migrar store_settings de id = 1 (integer) para id uuid + store_slug unique
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_settings'
      and column_name = 'id'
      and data_type <> 'uuid'
  ) then
    alter table public.store_settings add column if not exists store_slug text;
    update public.store_settings set store_slug = 'default' where store_slug is null;
    alter table public.store_settings alter column store_slug set not null;

    alter table public.store_settings drop constraint if exists store_settings_id_check;
    alter table public.store_settings drop constraint if exists store_settings_pkey;
    alter table public.store_settings rename column id to legacy_id;
    alter table public.store_settings add column id uuid not null default gen_random_uuid();
    alter table public.store_settings add primary key (id);
    alter table public.store_settings drop column if exists legacy_id;
  else
    alter table public.store_settings
      add column if not exists store_slug text not null default 'default';
  end if;
end
$$;

create unique index if not exists idx_store_settings_store_slug_unique
  on public.store_settings (store_slug);

-- 3. Substituir índices únicos globais por índices únicos compostos com store_slug
drop index if exists public.idx_coupons_code_upper_unique;
create unique index if not exists idx_coupons_store_code_upper_unique
  on public.coupons (store_slug, upper(code));

drop index if exists public.idx_catalog_options_type_name_unique;
create unique index if not exists idx_catalog_options_store_type_name_unique
  on public.catalog_options (store_slug, type, lower(btrim(name)));

-- 4. Índices compostos de leitura por loja
create index if not exists idx_products_store_active_featured
  on public.products (store_slug, active, featured desc, created_at desc);

create index if not exists idx_products_store_active_category_material
  on public.products (store_slug, category, material)
  where active = true;

create index if not exists idx_products_store_sku
  on public.products (store_slug, sku)
  where sku <> '';

create index if not exists idx_hero_banners_store_display_order
  on public.hero_banners (store_slug, display_order asc, created_at asc);

create index if not exists idx_hero_banners_store_active_order
  on public.hero_banners (store_slug, display_order asc, created_at asc)
  where active = true;

create index if not exists idx_coupons_store_active
  on public.coupons (store_slug, active)
  where active = true;

create index if not exists idx_catalog_options_store_type_created
  on public.catalog_options (store_slug, type, created_at asc);

create index if not exists idx_admin_profiles_store_slug
  on public.admin_profiles (store_slug);

notify pgrst, 'reload schema';
