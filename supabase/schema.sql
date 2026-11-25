-- ============================================================================
-- Use Camile Acessórios — Schema completo para Supabase (PostgreSQL + Storage)
-- Execute este arquivo no SQL Editor do projeto Supabase.
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
-- 2. Tabelas principais
-- ----------------------------------------------------------------------------

-- Produtos do catálogo (1 foto principal + características em jsonb)
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_sale_price_valid
    check (not is_on_sale or (sale_price > 0 and sale_price < price))
);

-- Banners do Hero com ordem de exibição, imagem mobile opcional e filtro opcional
create table if not exists public.hero_banners (
  id uuid primary key default gen_random_uuid(),
  image_url text not null check (btrim(image_url) <> ''),
  mobile_image_url text,
  alt text not null default 'Banner Use Camile Acessórios' check (btrim(alt) <> ''),
  active boolean not null default true,
  filter text not null default '',
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Configurações públicas da loja e barra de avisos (registro único id = 1)
create table if not exists public.store_settings (
  id integer primary key default 1 check (id = 1),
  announcement_active boolean not null default true,
  announcement_text text not null default '',
  announcement_link text not null default '#vitrine',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cupons de desconto
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
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

-- Perfil privado da administradora (vinculado ao Supabase Auth)
create table if not exists public.admin_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default 'Administradora',
  email text not null default '',
  avatar_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Opções dinâmicas do catálogo (categorias e materiais gerenciáveis pelo /admin)
create table if not exists public.catalog_options (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('category', 'material')),
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. Índices
-- ----------------------------------------------------------------------------
create index if not exists idx_products_active_featured
  on public.products (active, featured desc, created_at desc);

create index if not exists idx_products_active_category_material
  on public.products (category, material)
  where active = true;

create index if not exists idx_products_sku
  on public.products (sku)
  where sku <> '';

create index if not exists idx_hero_banners_display_order
  on public.hero_banners (display_order asc, created_at asc);

create index if not exists idx_hero_banners_active_order
  on public.hero_banners (display_order asc, created_at asc)
  where active = true;

create unique index if not exists idx_coupons_code_upper_unique
  on public.coupons (upper(code));

create index if not exists idx_coupons_active
  on public.coupons (active)
  where active = true;

create unique index if not exists idx_catalog_options_type_name_unique
  on public.catalog_options (type, lower(btrim(name)));

create index if not exists idx_catalog_options_type_created
  on public.catalog_options (type, created_at asc);

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
-- 5. Registros iniciais padrão (configurações + categorias/materiais)
-- ----------------------------------------------------------------------------
insert into public.store_settings (id, announcement_active, announcement_text, announcement_link)
values (
  1,
  true,
  'Sua primeira compra merece um brilho extra: 10% OFF com PRIMEIRACOMPRA',
  '#vitrine'
)
on conflict (id) do nothing;

insert into public.catalog_options (type, name)
values
  ('category', 'Anéis'),
  ('category', 'Colares'),
  ('category', 'Brincos'),
  ('category', 'Pulseiras'),
  ('category', 'Tornozeleiras'),
  ('category', 'Conjuntos'),
  ('material', 'Prata 925'),
  ('material', 'Semijoia')
on conflict do nothing;

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
