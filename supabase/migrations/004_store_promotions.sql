-- ============================================================================
-- Migração incremental 004: Espaço Dinâmico de Promoções e Campanhas
-- Use Camile Acessórios — Seguro para executar em bancos já em produção.
-- ============================================================================

alter table public.store_settings
  add column if not exists promo_active boolean not null default false,
  add column if not exists promo_badge text not null default 'CAMPANHA ESPECIAL',
  add column if not exists promo_title text not null default '',
  add column if not exists promo_description text not null default '',
  add column if not exists promo_highlight text not null default '',
  add column if not exists promo_cta_label text not null default 'Aproveitar promoção',
  add column if not exists promo_cta_type text not null default 'vitrine';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_settings_promo_cta_type_check'
      and conrelid = 'public.store_settings'::regclass
  ) then
    alter table public.store_settings
      add constraint store_settings_promo_cta_type_check
      check (promo_cta_type in ('vitrine', 'whatsapp'));
  end if;
end
$$;

insert into public.store_settings (id)
values (1)
on conflict (id) do nothing;
