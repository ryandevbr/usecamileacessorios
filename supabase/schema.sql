-- ============================================================================
-- Template Mestre White-Label Multi-Tenant — Schema completo para Supabase
-- Isolamento por store_slug (PostgreSQL + Auth + Storage)
-- Execute este arquivo no SQL Editor do projeto Supabase Central.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Função utilitária para atualizar updated_at automaticamente
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Tabelas principais (isoladas por store_slug)
-- ----------------------------------------------------------------------------

-- Produtos do catálogo (1 foto principal + características e tamanhos em jsonb)
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_slug text not null default 'default',
  name text not null check (btrim(name) <> ''),
  sku text not null default '',
  category text not null,
  material text not null,
  price numeric(10, 2) not null check (price > 0),
  sale_price numeric(10, 2) not null default 0 check (sale_price >= 0),
  is_on_sale boolean not null default false,
  sale_label text not null default '',
  image_url text not null default '',
  description text not null default '',
  active boolean not null default true,
  featured boolean not null default false,
  in_stock boolean not null default true,
  characteristics jsonb not null default '[]'::jsonb
    check (jsonb_typeof(characteristics) = 'array'),
  sizes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(sizes) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_sale_price_valid
    check (not is_on_sale or (sale_price > 0 and sale_price < price))
);

-- Banners do Hero com ordem de exibição, imagem mobile opcional e filtro opcional
create table if not exists public.hero_banners (
  id uuid primary key default gen_random_uuid(),
  store_slug text not null default 'default',
  image_url text not null check (btrim(image_url) <> ''),
  mobile_image_url text,
  alt text not null default 'Banner da Loja' check (btrim(alt) <> ''),
  active boolean not null default true,
  filter text not null default '',
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Configurações públicas por loja (barra de avisos e espaço de promoções)
create table if not exists public.store_settings (
  id uuid primary key default gen_random_uuid(),
  store_slug text not null unique,
  announcement_active boolean not null default true,
  announcement_text text not null default '',
  announcement_link text not null default '#vitrine',
  promo_active boolean not null default false,
  promo_badge text not null default 'CAMPANHA ESPECIAL',
  promo_title text not null default '',
  promo_description text not null default '',
  promo_highlight text not null default '',
  promo_cta_label text not null default 'Aproveitar promoção',
  promo_cta_type text not null default 'vitrine'
    constraint store_settings_promo_cta_type_check
    check (promo_cta_type in ('vitrine', 'whatsapp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cupons de desconto por loja
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  store_slug text not null default 'default',
  code text not null,
  type text not null check (type in ('percent', 'fixed')),
  value numeric(10, 2) not null check (value > 0),
  min_order_value numeric(10, 2) not null default 0 check (min_order_value >= 0),
  expires_at date,
  active boolean not null default true,
  allow_on_sale boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_code_normalized
    check (code = upper(btrim(code)) and code <> '' and position(' ' in code) = 0),
  constraint coupons_percent_max
    check (type <> 'percent' or value <= 100)
);

-- Perfil privado da administradora (vinculado ao Supabase Auth + store_slug)
create table if not exists public.admin_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  store_slug text not null default 'default',
  name text not null default 'Administradora',
  email text not null default '',
  avatar_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Opções dinâmicas do catálogo por loja (categorias e tecidos/materiais)
create table if not exists public.catalog_options (
  id uuid primary key default gen_random_uuid(),
  store_slug text not null default 'default',
  type text not null check (type in ('category', 'material')),
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. Índices compostos com store_slug
-- ----------------------------------------------------------------------------
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

create unique index if not exists idx_coupons_store_code_upper_unique
  on public.coupons (store_slug, upper(code));

create index if not exists idx_coupons_store_active
  on public.coupons (store_slug, active)
  where active = true;

create unique index if not exists idx_catalog_options_store_type_name_unique
  on public.catalog_options (store_slug, type, lower(btrim(name)));

create index if not exists idx_catalog_options_store_type_created
  on public.catalog_options (store_slug, type, created_at asc);

create index if not exists idx_admin_profiles_store_slug
  on public.admin_profiles (store_slug);

-- ----------------------------------------------------------------------------
-- 4. Triggers de updated_at
-- ----------------------------------------------------------------------------
drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists trg_hero_banners_updated_at on public.hero_banners;
create trigger trg_hero_banners_updated_at
  before update on public.hero_banners
  for each row execute function public.set_updated_at();

drop trigger if exists trg_store_settings_updated_at on public.store_settings;
create trigger trg_store_settings_updated_at
  before update on public.store_settings
  for each row execute function public.set_updated_at();

drop trigger if exists trg_coupons_updated_at on public.coupons;
create trigger trg_coupons_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();

drop trigger if exists trg_admin_profiles_updated_at on public.admin_profiles;
create trigger trg_admin_profiles_updated_at
  before update on public.admin_profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Registros iniciais padrão (configurações da loja padrão)
--    A tabela public.catalog_options permanece vazia na criação do banco para
--    receber o auto-seed da aplicação conforme STORE_CONFIG.niche e store_slug.
-- ----------------------------------------------------------------------------
insert into public.store_settings (
  store_slug,
  announcement_active,
  announcement_text,
  announcement_link
)
values (
  'default',
  true,
  'Sua primeira compra merece um brilho extra: 10% OFF com PRIMEIRACOMPRA',
  '#vitrine'
)
on conflict (store_slug) do nothing;

-- ----------------------------------------------------------------------------
-- 6. Permissões de schema e Row Level Security (RLS) nas tabelas
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on
  public.products,
  public.hero_banners,
  public.store_settings,
  public.coupons,
  public.catalog_options
to anon;
grant select, insert, update, delete on
  public.products,
  public.hero_banners,
  public.store_settings,
  public.coupons,
  public.admin_profiles,
  public.catalog_options
to authenticated;

alter table public.products enable row level security;
alter table public.hero_banners enable row level security;
alter table public.store_settings enable row level security;
alter table public.coupons enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.catalog_options enable row level security;

-- products
drop policy if exists "Anon pode ler produtos ativos" on public.products;
create policy "Anon pode ler produtos ativos"
  on public.products
  for select
  to anon
  using (active = true);

drop policy if exists "Admin tem acesso total em produtos" on public.products;
create policy "Admin tem acesso total em produtos"
  on public.products
  for all
  to authenticated
  using (true)
  with check (true);

-- hero_banners
drop policy if exists "Anon pode ler banners ativos" on public.hero_banners;
create policy "Anon pode ler banners ativos"
  on public.hero_banners
  for select
  to anon
  using (active = true);

drop policy if exists "Admin tem acesso total em banners" on public.hero_banners;
create policy "Admin tem acesso total em banners"
  on public.hero_banners
  for all
  to authenticated
  using (true)
  with check (true);

-- store_settings
drop policy if exists "Anon pode ler configuracoes publicas da loja" on public.store_settings;
create policy "Anon pode ler configuracoes publicas da loja"
  on public.store_settings
  for select
  to anon
  using (true);

drop policy if exists "Admin tem acesso total em configuracoes da loja" on public.store_settings;
create policy "Admin tem acesso total em configuracoes da loja"
  on public.store_settings
  for all
  to authenticated
  using (true)
  with check (true);

-- coupons
drop policy if exists "Anon pode ler cupons ativos" on public.coupons;
create policy "Anon pode ler cupons ativos"
  on public.coupons
  for select
  to anon
  using (active = true);

drop policy if exists "Admin tem acesso total em cupons" on public.coupons;
create policy "Admin tem acesso total em cupons"
  on public.coupons
  for all
  to authenticated
  using (true)
  with check (true);

-- admin_profiles (somente usuários autenticados; nunca exposto a anon)
drop policy if exists "Admin tem acesso total em perfis" on public.admin_profiles;
create policy "Admin tem acesso total em perfis"
  on public.admin_profiles
  for all
  to authenticated
  using (true)
  with check (true);

-- catalog_options
drop policy if exists "Publico pode ler opcoes do catalogo" on public.catalog_options;
create policy "Publico pode ler opcoes do catalogo"
  on public.catalog_options
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Admin pode inserir opcoes do catalogo" on public.catalog_options;
create policy "Admin pode inserir opcoes do catalogo"
  on public.catalog_options
  for insert
  to authenticated
  with check (true);

drop policy if exists "Admin pode atualizar opcoes do catalogo" on public.catalog_options;
create policy "Admin pode atualizar opcoes do catalogo"
  on public.catalog_options
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Admin pode excluir opcoes do catalogo" on public.catalog_options;
create policy "Admin pode excluir opcoes do catalogo"
  on public.catalog_options
  for delete
  to authenticated
  using (true);

-- ----------------------------------------------------------------------------
-- 7. Storage: bucket público store-media e políticas em storage.objects
--    Arquivos organizados por loja: {store_slug}/products/..., {store_slug}/banners/...
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'store-media',
  'store-media',
  true,
  15728640,
  array['image/webp', 'image/jpeg', 'image/png', 'image/avif', 'image/gif']
)
on conflict (id) do nothing;

drop policy if exists "Leitura publica das imagens da loja" on storage.objects;
create policy "Leitura publica das imagens da loja"
  on storage.objects
  for select
  to public
  using (bucket_id = 'store-media');

drop policy if exists "Admin pode enviar imagens para a loja" on storage.objects;
create policy "Admin pode enviar imagens para a loja"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'store-media');

drop policy if exists "Admin pode atualizar imagens da loja" on storage.objects;
create policy "Admin pode atualizar imagens da loja"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'store-media')
  with check (bucket_id = 'store-media');

drop policy if exists "Admin pode excluir imagens da loja" on storage.objects;
create policy "Admin pode excluir imagens da loja"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'store-media');

notify pgrst, 'reload schema';
