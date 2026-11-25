-- ============================================================================
-- Migração incremental 002: Categorias e Materiais dinâmicos
-- Use Camile Acessórios — Seguro para executar em bancos já em produção
-- (não apaga nem altera produtos existentes).
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Garantir que products.category e products.material aceitem qualquer TEXT NOT NULL
--    Remove qualquer CHECK constraint nas colunas category/material e converte
--    ENUM para TEXT caso exista em alguma instância anterior.
-- ----------------------------------------------------------------------------
do $$
declare
  rec record;
begin
  -- Remove CHECK constraints associadas às colunas category ou material em public.products
  for rec in
    select distinct con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
    where nsp.nspname = 'public'
      and rel.relname = 'products'
      and con.contype = 'c'
      and att.attname in ('category', 'material')
  loop
    execute format('alter table public.products drop constraint if exists %I', rec.conname);
  end loop;

  -- Se category não for text (ex.: enum), converte preservando os dados
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'category'
      and data_type <> 'text'
  ) then
    execute 'alter table public.products alter column category type text using category::text';
  end if;

  -- Se material não for text (ex.: enum), converte preservando os dados
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'material'
      and data_type <> 'text'
  ) then
    execute 'alter table public.products alter column material type text using material::text';
  end if;
end
$$;

alter table public.products
  alter column category set not null,
  alter column material set not null;

-- ----------------------------------------------------------------------------
-- 2. Tabela catalog_options para gerenciar categorias e materiais dinamicamente
-- ----------------------------------------------------------------------------
create table if not exists public.catalog_options (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('category', 'material')),
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);

-- Índice único case-insensitive (ignora espaços nas extremidades) por tipo
create unique index if not exists idx_catalog_options_type_name_unique
  on public.catalog_options (type, lower(btrim(name)));

create index if not exists idx_catalog_options_type_created
  on public.catalog_options (type, created_at asc);

-- ----------------------------------------------------------------------------
-- 3. Seed inicial padrão + sincronização de valores já usados em public.products
-- ----------------------------------------------------------------------------
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

insert into public.catalog_options (type, name)
select distinct 'category', btrim(category)
from public.products
where btrim(category) <> ''
on conflict do nothing;

insert into public.catalog_options (type, name)
select distinct 'material', btrim(material)
from public.products
where btrim(material) <> ''
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 4. Permissões e políticas de Row Level Security (RLS)
-- ----------------------------------------------------------------------------
grant select on public.catalog_options to anon;
grant select, insert, update, delete on public.catalog_options to authenticated;

alter table public.catalog_options enable row level security;

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
