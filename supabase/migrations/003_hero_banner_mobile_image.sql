-- ============================================================================
-- Migração incremental 003: Imagem opcional para celular nos Banners do Hero
-- Use Camile Acessórios — Seguro para executar em bancos já em produção.
-- ============================================================================

alter table public.hero_banners
  add column if not exists mobile_image_url text;
