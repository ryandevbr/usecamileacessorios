import { useCallback, useEffect, useState } from "react";
import { ACTIVE_STORE_SLUG, getDefaultBannerAlt } from "@/config/store.config";
import {
  defaultPromotion,
  emptyStoreData,
  initialData,
  type AdminProfile,
  type Banner,
  type Coupon,
  type Product,
  type StoreAnnouncement,
  type StoreData,
  type StorePromotion,
} from "@/data/catalog";
import {
  PRODUCT_SELECT_COLUMNS,
  PRODUCT_SELECT_COLUMNS_LEGACY,
  isSupabaseConfigured,
  mapProductRow,
  parseProductSizes,
  requireSupabase,
  supabase,
  toProductPayload,
  type ProductRow,
} from "@/lib/supabase";
import { normalizeCode } from "@/services/couponService";
import { deleteStoreImage, deleteStoreImages } from "@/services/storageService";

const KEY = `store-template-v1-${ACTIVE_STORE_SLUG}`;
const STORE_EVENT = "store-template-changed";
const DEFAULT_BANNER_ALT = getDefaultBannerAlt();

export type StoreScope = "public" | "admin";

interface HeroBannerRow {
  id: string;
  image_url: string;
  mobile_image_url?: string | null;
  alt: string;
  active: boolean;
  filter: string | null;
  display_order: number | null;
}

interface StoreSettingsRow {
  id: string;
  store_slug?: string | null;
  announcement_active: boolean;
  announcement_text: string | null;
  announcement_link: string | null;
  promo_active?: boolean | null;
  promo_badge?: string | null;
  promo_title?: string | null;
  promo_description?: string | null;
  promo_highlight?: string | null;
  promo_cta_label?: string | null;
  promo_cta_type?: string | null;
}

const STORE_SETTINGS_COLUMNS =
  "id, store_slug, announcement_active, announcement_text, announcement_link, promo_active, promo_badge, promo_title, promo_description, promo_highlight, promo_cta_label, promo_cta_type";

function mapPromotionRow(row: StoreSettingsRow | null): StorePromotion {
  if (!row) return { ...defaultPromotion };
  return {
    promo_active: Boolean(row.promo_active),
    promo_badge: row.promo_badge?.trim() || defaultPromotion.promo_badge,
    promo_title: row.promo_title ?? "",
    promo_description: row.promo_description ?? "",
    promo_highlight: row.promo_highlight ?? "",
    promo_cta_label: row.promo_cta_label ?? "",
    promo_cta_type: row.promo_cta_type === "whatsapp" ? "whatsapp" : "vitrine",
  };
}

interface CouponRow {
  id: string;
  code: string;
  type: string;
  value: number | string;
  min_order_value: number | string | null;
  expires_at: string | null;
  active: boolean;
  allow_on_sale: boolean;
}

interface AdminProfileRow {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

function mapBannerRow(row: HeroBannerRow, fallbackIndex: number): Banner {
  return {
    id: row.id,
    image_url: row.image_url,
    mobile_image_url: row.mobile_image_url ?? null,
    alt: row.alt?.trim() || DEFAULT_BANNER_ALT,
    active: Boolean(row.active),
    filter: row.filter ?? "",
    display_order: row.display_order ?? fallbackIndex,
  };
}

function mapCouponRow(row: CouponRow): Coupon {
  return {
    id: row.id,
    code: normalizeCode(row.code),
    type: row.type === "fixed" ? "fixed" : "percent",
    value: Number(row.value),
    min_order_value: Number(row.min_order_value ?? 0),
    expires_at: row.expires_at ?? "",
    active: Boolean(row.active),
    allow_on_sale: Boolean(row.allow_on_sale),
  };
}

function toBannerPayload(banner: Banner, displayOrder: number) {
  return {
    id: banner.id || crypto.randomUUID(),
    store_slug: ACTIVE_STORE_SLUG,
    image_url: banner.image_url.trim(),
    mobile_image_url: null,
    alt: banner.alt.trim() || DEFAULT_BANNER_ALT,
    active: Boolean(banner.active),
    filter: banner.filter.trim(),
    display_order: displayOrder,
  };
}

function toCouponPayload(coupon: Coupon) {
  const normalizedExpiresAt = coupon.expires_at.trim();
  return {
    id: coupon.id || crypto.randomUUID(),
    store_slug: ACTIVE_STORE_SLUG,
    code: normalizeCode(coupon.code),
    type: coupon.type === "fixed" ? "fixed" : "percent",
    value: Number(coupon.value),
    min_order_value: Math.max(0, Number(coupon.min_order_value || 0)),
    expires_at: normalizedExpiresAt ? normalizedExpiresAt : null,
    active: Boolean(coupon.active),
    allow_on_sale: Boolean(coupon.allow_on_sale),
  };
}

function notifyStoreChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(STORE_EVENT));
  }
}

export function loadStore(): StoreData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(initialData);
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    const normalizedProducts = Array.isArray(parsed.products)
      ? parsed.products.map((item) => ({
          ...item,
          sizes: parseProductSizes((item as { sizes?: unknown }).sizes),
        }))
      : structuredClone(initialData.products);
    return {
      ...structuredClone(initialData),
      ...parsed,
      products: normalizedProducts,
      announcement: {
        ...initialData.announcement,
        ...(parsed.announcement ?? {}),
      },
      promotion: {
        ...defaultPromotion,
        ...(parsed.promotion ?? {}),
        promo_cta_type: parsed.promotion?.promo_cta_type === "whatsapp" ? "whatsapp" : "vitrine",
      },
      profile: {
        ...initialData.profile,
        ...(parsed.profile ?? {}),
      },
    };
  } catch {
    return structuredClone(initialData);
  }
}

export function saveStore(data: StoreData) {
  localStorage.setItem(KEY, JSON.stringify(data));
  notifyStoreChanged();
}

export async function fetchStoreData(scope: StoreScope = "public"): Promise<StoreData> {
  if (!isSupabaseConfigured || !supabase) {
    return loadStore();
  }

  let productsQuery = supabase
    .from("products")
    .select(PRODUCT_SELECT_COLUMNS)
    .eq("store_slug", ACTIVE_STORE_SLUG)
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false });

  let bannersQuery = supabase
    .from("hero_banners")
    .select("id, image_url, mobile_image_url, alt, active, filter, display_order")
    .eq("store_slug", ACTIVE_STORE_SLUG)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  let couponsQuery = supabase
    .from("coupons")
    .select("id, code, type, value, min_order_value, expires_at, active, allow_on_sale")
    .eq("store_slug", ACTIVE_STORE_SLUG)
    .order("created_at", { ascending: false });

  if (scope === "public") {
    productsQuery = productsQuery.eq("active", true);
    bannersQuery = bannersQuery.eq("active", true);
    couponsQuery = couponsQuery.eq("active", true);
  }

  const settingsQuery = supabase
    .from("store_settings")
    .select(STORE_SETTINGS_COLUMNS)
    .eq("store_slug", ACTIVE_STORE_SLUG)
    .maybeSingle();

  const [productsRes, bannersRes, couponsRes, settingsRes] = await Promise.all([
    productsQuery,
    bannersQuery,
    couponsQuery,
    settingsQuery,
  ]);

  let productRows = (productsRes.data ?? []) as ProductRow[];
  if (productsRes.error) {
    if (productsRes.error.code === "42703" || productsRes.error.message.includes("sizes")) {
      let fallbackProductsQuery = supabase
        .from("products")
        .select(PRODUCT_SELECT_COLUMNS_LEGACY)
        .eq("store_slug", ACTIVE_STORE_SLUG)
        .order("featured", { ascending: false })
        .order("created_at", { ascending: false });
      if (scope === "public") {
        fallbackProductsQuery = fallbackProductsQuery.eq("active", true);
      }
      const fallbackRes = await fallbackProductsQuery;
      if (fallbackRes.error) {
        throw new Error(`Erro ao carregar produtos: ${fallbackRes.error.message}`);
      }
      productRows = (fallbackRes.data ?? []) as ProductRow[];
    } else {
      throw new Error(`Erro ao carregar produtos: ${productsRes.error.message}`);
    }
  }
  let bannersRows = (bannersRes.data ?? []) as HeroBannerRow[];
  if (bannersRes.error) {
    if (
      bannersRes.error.code === "42703" ||
      bannersRes.error.message.includes("mobile_image_url")
    ) {
      let fallbackBannersQuery = supabase
        .from("hero_banners")
        .select("id, image_url, alt, active, filter, display_order")
        .eq("store_slug", ACTIVE_STORE_SLUG)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (scope === "public") {
        fallbackBannersQuery = fallbackBannersQuery.eq("active", true);
      }
      const fallbackRes = await fallbackBannersQuery;
      if (fallbackRes.error) {
        throw new Error(`Erro ao carregar banners: ${fallbackRes.error.message}`);
      }
      bannersRows = (fallbackRes.data ?? []) as HeroBannerRow[];
    } else {
      throw new Error(`Erro ao carregar banners: ${bannersRes.error.message}`);
    }
  }
  if (couponsRes.error) {
    throw new Error(`Erro ao carregar cupons: ${couponsRes.error.message}`);
  }
  let settingsRow = settingsRes.data as StoreSettingsRow | null;
  if (settingsRes.error) {
    if (settingsRes.error.code === "42703" || settingsRes.error.message.includes("promo_")) {
      const fallbackSettingsRes = await supabase
        .from("store_settings")
        .select("id, store_slug, announcement_active, announcement_text, announcement_link")
        .eq("store_slug", ACTIVE_STORE_SLUG)
        .maybeSingle();
      if (fallbackSettingsRes.error) {
        throw new Error(`Erro ao carregar configurações: ${fallbackSettingsRes.error.message}`);
      }
      settingsRow = fallbackSettingsRes.data as StoreSettingsRow | null;
    } else {
      throw new Error(`Erro ao carregar configurações: ${settingsRes.error.message}`);
    }
  }

  const announcement: StoreAnnouncement = settingsRow
    ? {
        active: Boolean(settingsRow.announcement_active),
        text: settingsRow.announcement_text ?? "",
        link: settingsRow.announcement_link ?? "#vitrine",
      }
    : { ...emptyStoreData.announcement };
  const promotion: StorePromotion = mapPromotionRow(settingsRow);

  let profile: AdminProfile = { ...emptyStoreData.profile };
  if (scope === "admin") {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (user) {
      const profileRes = await supabase
        .from("admin_profiles")
        .select("id, store_slug, name, email, avatar_url")
        .eq("id", user.id)
        .eq("store_slug", ACTIVE_STORE_SLUG)
        .maybeSingle();

      if (profileRes.error) {
        throw new Error(`Erro ao carregar perfil: ${profileRes.error.message}`);
      }

      const row = profileRes.data as AdminProfileRow | null;
      profile = {
        name: row?.name?.trim() || "Administradora",
        email: row?.email?.trim() || user.email || "",
        avatar: row?.avatar_url ?? "",
      };
    }
  }

  return {
    products: productRows.map(mapProductRow),
    banners: bannersRows.map(mapBannerRow),
    coupons: ((couponsRes.data ?? []) as CouponRow[]).map(mapCouponRow),
    announcement,
    promotion,
    profile,
  };
}

function isImageStillReferenced(
  imageUrl: string,
  state: StoreData,
  exclude?: { kind: "products" | "banners"; id?: string; ids?: Set<string> },
): boolean {
  if (!imageUrl) return false;
  const isExcluded = (kind: "products" | "banners", id: string) =>
    exclude?.kind === kind && (exclude.id === id || Boolean(exclude.ids?.has(id)));
  const usedInProducts = state.products.some(
    (p) => p.image_url === imageUrl && !isExcluded("products", p.id),
  );
  if (usedInProducts) return true;
  const usedInBanners = state.banners.some(
    (b) =>
      (b.image_url === imageUrl || (b.mobile_image_url ?? "") === imageUrl) &&
      !isExcluded("banners", b.id),
  );
  if (usedInBanners) return true;
  return state.profile.avatar === imageUrl;
}

export async function upsertProduct(product: Product, previousImageUrl?: string): Promise<Product> {
  const client = requireSupabase();
  const payload = toProductPayload(product);
  const { data, error } = await client
    .from("products")
    .upsert(payload, { onConflict: "id" })
    .select(PRODUCT_SELECT_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Erro ao salvar produto: ${error?.message ?? "resposta vazia"}`);
  }

  if (previousImageUrl && previousImageUrl !== payload.image_url) {
    await deleteStoreImage(previousImageUrl);
  }

  return mapProductRow(data as ProductRow);
}

export async function removeProduct(id: string, imageUrlToClean?: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from("products")
    .delete()
    .eq("id", id)
    .eq("store_slug", ACTIVE_STORE_SLUG);
  if (error) {
    throw new Error(`Erro ao excluir produto: ${error.message}`);
  }
  if (imageUrlToClean) {
    await deleteStoreImage(imageUrlToClean);
  }
}

export type BulkProductPatch = Partial<Pick<Product, "in_stock" | "active">>;

export async function bulkUpdateProductsInDb(
  ids: string[],
  patch: BulkProductPatch,
): Promise<void> {
  if (ids.length === 0) return;
  const client = requireSupabase();
  const { error } = await client
    .from("products")
    .update(patch)
    .in("id", ids)
    .eq("store_slug", ACTIVE_STORE_SLUG);
  if (error) {
    throw new Error(`Erro ao atualizar produtos em lote: ${error.message}`);
  }
}

export async function bulkRemoveProductsInDb(
  ids: string[],
  imageUrlsToClean: string[] = [],
): Promise<void> {
  if (ids.length === 0) return;
  const client = requireSupabase();
  const { error } = await client
    .from("products")
    .delete()
    .in("id", ids)
    .eq("store_slug", ACTIVE_STORE_SLUG);
  if (error) {
    throw new Error(`Erro ao excluir produtos em lote: ${error.message}`);
  }
  if (imageUrlsToClean.length > 0) {
    await deleteStoreImages(imageUrlsToClean);
  }
}

export async function upsertBanner(
  banner: Banner,
  displayOrder: number,
  previousImageUrls: string[] = [],
): Promise<Banner> {
  const client = requireSupabase();
  const payload = toBannerPayload(banner, displayOrder);
  const { data, error } = await client
    .from("hero_banners")
    .upsert(payload, { onConflict: "id" })
    .select("id, image_url, mobile_image_url, alt, active, filter, display_order")
    .single();

  if (error || !data) {
    throw new Error(`Erro ao salvar banner: ${error?.message ?? "resposta vazia"}`);
  }

  const kept = new Set([payload.image_url]);
  for (const prevUrl of previousImageUrls) {
    if (prevUrl && !kept.has(prevUrl)) {
      await deleteStoreImage(prevUrl);
    }
  }

  return mapBannerRow(data as HeroBannerRow, displayOrder);
}

export async function saveBannersOrder(banners: Banner[]): Promise<Banner[]> {
  const client = requireSupabase();
  const payloads = banners.map((banner, index) => toBannerPayload(banner, index));
  const { data, error } = await client
    .from("hero_banners")
    .upsert(payloads, { onConflict: "id" })
    .select("id, image_url, mobile_image_url, alt, active, filter, display_order")
    .order("display_order", { ascending: true });

  if (error) {
    throw new Error(`Erro ao reordenar banners: ${error.message}`);
  }

  return ((data ?? []) as HeroBannerRow[]).map(mapBannerRow);
}

export async function removeBanner(id: string, imageUrlsToClean: string[] = []): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from("hero_banners")
    .delete()
    .eq("id", id)
    .eq("store_slug", ACTIVE_STORE_SLUG);
  if (error) {
    throw new Error(`Erro ao excluir banner: ${error.message}`);
  }
  for (const url of imageUrlsToClean) {
    if (url) {
      await deleteStoreImage(url);
    }
  }
}

export async function saveStoreAnnouncement(
  announcement: StoreAnnouncement,
): Promise<StoreAnnouncement> {
  const client = requireSupabase();
  const payload = {
    store_slug: ACTIVE_STORE_SLUG,
    announcement_active: Boolean(announcement.active),
    announcement_text: announcement.text.trim(),
    announcement_link: announcement.link.trim() || "#vitrine",
  };

  const { data, error } = await client
    .from("store_settings")
    .upsert(payload, { onConflict: "store_slug" })
    .select("id, store_slug, announcement_active, announcement_text, announcement_link")
    .single();

  if (error || !data) {
    throw new Error(`Erro ao salvar barra de avisos: ${error?.message ?? "resposta vazia"}`);
  }

  const row = data as StoreSettingsRow;
  return {
    active: Boolean(row.announcement_active),
    text: row.announcement_text ?? "",
    link: row.announcement_link ?? "#vitrine",
  };
}

export async function saveStorePromotion(promotion: StorePromotion): Promise<StorePromotion> {
  const client = requireSupabase();
  const payload = {
    store_slug: ACTIVE_STORE_SLUG,
    promo_active: Boolean(promotion.promo_active),
    promo_badge: promotion.promo_badge.trim() || defaultPromotion.promo_badge,
    promo_title: promotion.promo_title.trim(),
    promo_description: promotion.promo_description.trim(),
    promo_highlight: promotion.promo_highlight.trim(),
    promo_cta_label: promotion.promo_cta_label.trim(),
    promo_cta_type: promotion.promo_cta_type === "whatsapp" ? "whatsapp" : "vitrine",
  };

  const { data, error } = await client
    .from("store_settings")
    .upsert(payload, { onConflict: "store_slug" })
    .select(STORE_SETTINGS_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Erro ao salvar espaço de promoções: ${error?.message ?? "resposta vazia"}`);
  }

  return mapPromotionRow(data as StoreSettingsRow);
}

export async function upsertCoupon(coupon: Coupon): Promise<Coupon> {
  const client = requireSupabase();
  const payload = toCouponPayload(coupon);
  const { data, error } = await client
    .from("coupons")
    .upsert(payload, { onConflict: "id" })
    .select("id, code, type, value, min_order_value, expires_at, active, allow_on_sale")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      throw new Error("Já existe um cupom cadastrado com este código.");
    }
    throw new Error(`Erro ao salvar cupom: ${error?.message ?? "resposta vazia"}`);
  }

  return mapCouponRow(data as CouponRow);
}

export async function removeCoupon(id: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from("coupons")
    .delete()
    .eq("id", id)
    .eq("store_slug", ACTIVE_STORE_SLUG);
  if (error) {
    throw new Error(`Erro ao excluir cupom: ${error.message}`);
  }
}

export async function saveAdminProfile(
  profile: AdminProfile,
  previousAvatarUrl?: string,
): Promise<AdminProfile> {
  const client = requireSupabase();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  const payload = {
    id: userData.user.id,
    store_slug: ACTIVE_STORE_SLUG,
    name: profile.name.trim() || "Administradora",
    email: profile.email.trim() || userData.user.email || "",
    avatar_url: profile.avatar.trim(),
  };

  const { data, error } = await client
    .from("admin_profiles")
    .upsert(payload, { onConflict: "id" })
    .select("id, store_slug, name, email, avatar_url")
    .single();

  if (error || !data) {
    throw new Error(`Erro ao salvar perfil: ${error?.message ?? "resposta vazia"}`);
  }

  if (previousAvatarUrl && previousAvatarUrl !== payload.avatar_url) {
    await deleteStoreImage(previousAvatarUrl);
  }

  const row = data as AdminProfileRow;
  return {
    name: row.name ?? "Administradora",
    email: row.email ?? "",
    avatar: row.avatar_url ?? "",
  };
}

export function useStore(options?: { scope?: StoreScope; enabled?: boolean }) {
  const scope = options?.scope ?? "public";
  const enabled = options?.enabled ?? true;
  const [data, setData] = useState<StoreData>(() =>
    isSupabaseConfigured ? emptyStoreData : initialData,
  );
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured && enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (!isSupabaseConfigured) {
      setData(loadStore());
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const remoteData = await fetchStoreData(scope);
      setData(remoteData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar dados da loja.");
    } finally {
      setLoading(false);
    }
  }, [scope, enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const onStoreEvent = () => {
      void refresh();
    };
    window.addEventListener(STORE_EVENT, onStoreEvent);
    if (!isSupabaseConfigured) {
      window.addEventListener("storage", onStoreEvent);
    }
    return () => {
      window.removeEventListener(STORE_EVENT, onStoreEvent);
      if (!isSupabaseConfigured) {
        window.removeEventListener("storage", onStoreEvent);
      }
    };
  }, [refresh, enabled]);

  const update = useCallback((next: StoreData) => {
    if (!isSupabaseConfigured) {
      saveStore(next);
    }
    setData(next);
  }, []);

  const saveProduct = useCallback(
    async (product: Product) => {
      const existing = data.products.find((p) => p.id === product.id);
      if (!isSupabaseConfigured) {
        const current = loadStore();
        const existsLocally = current.products.some((p) => p.id === product.id);
        const next: StoreData = {
          ...current,
          products: existsLocally
            ? current.products.map((p) => (p.id === product.id ? product : p))
            : [product, ...current.products],
        };
        saveStore(next);
        setData(next);
        return;
      }

      const oldUrl =
        existing?.image_url &&
        existing.image_url !== product.image_url &&
        !isImageStillReferenced(existing.image_url, data, { kind: "products", id: existing.id })
          ? existing.image_url
          : undefined;

      const saved = await upsertProduct(product, oldUrl);
      setData((prev) => ({
        ...prev,
        products: prev.products.some((p) => p.id === saved.id)
          ? prev.products.map((p) => (p.id === saved.id ? saved : p))
          : [saved, ...prev.products],
      }));
      notifyStoreChanged();
    },
    [data],
  );

  const toggleProductField = useCallback(
    async (product: Product, key: "active" | "featured" | "in_stock") => {
      await saveProduct({ ...product, [key]: !product[key] });
    },
    [saveProduct],
  );

  const duplicateProduct = useCallback(
    async (product: Product) => {
      const copy: Product = {
        ...structuredClone(product),
        id: crypto.randomUUID(),
        name: `${product.name} (cópia)`,
        sku: "",
        active: false,
      };
      await saveProduct(copy);
    },
    [saveProduct],
  );

  const deleteProduct = useCallback(
    async (id: string) => {
      const existing = data.products.find((p) => p.id === id);
      if (!isSupabaseConfigured) {
        const next: StoreData = {
          ...data,
          products: data.products.filter((p) => p.id !== id),
        };
        saveStore(next);
        setData(next);
        return;
      }

      const cleanUrl =
        existing?.image_url &&
        !isImageStillReferenced(existing.image_url, data, { kind: "products", id })
          ? existing.image_url
          : undefined;

      await removeProduct(id, cleanUrl);
      setData((prev) => ({
        ...prev,
        products: prev.products.filter((p) => p.id !== id),
      }));
      notifyStoreChanged();
    },
    [data],
  );

  const bulkUpdateProducts = useCallback(
    async (ids: string[], patch: BulkProductPatch) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);

      if (!isSupabaseConfigured) {
        const next: StoreData = {
          ...data,
          products: data.products.map((p) => (idSet.has(p.id) ? { ...p, ...patch } : p)),
        };
        saveStore(next);
        setData(next);
        return;
      }

      await bulkUpdateProductsInDb(ids, patch);
      setData((prev) => ({
        ...prev,
        products: prev.products.map((p) => (idSet.has(p.id) ? { ...p, ...patch } : p)),
      }));
      notifyStoreChanged();
    },
    [data],
  );

  const bulkDeleteProducts = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);

      if (!isSupabaseConfigured) {
        const next: StoreData = {
          ...data,
          products: data.products.filter((p) => !idSet.has(p.id)),
        };
        saveStore(next);
        setData(next);
        return;
      }

      const urlsToClean = Array.from(
        new Set(
          data.products
            .filter((p) => idSet.has(p.id) && Boolean(p.image_url))
            .map((p) => p.image_url)
            .filter(
              (url) => !isImageStillReferenced(url, data, { kind: "products", ids: idSet }),
            ),
        ),
      );

      await bulkRemoveProductsInDb(ids, urlsToClean);
      setData((prev) => ({
        ...prev,
        products: prev.products.filter((p) => !idSet.has(p.id)),
      }));
      notifyStoreChanged();
    },
    [data],
  );

  const saveBanner = useCallback(
    async (banner: Banner) => {
      const existingIndex = data.banners.findIndex((b) => b.id === banner.id);
      const existing = existingIndex >= 0 ? data.banners[existingIndex] : undefined;
      const displayOrder =
        banner.display_order ?? (existingIndex >= 0 ? existingIndex : data.banners.length);

      if (!isSupabaseConfigured) {
        const bannerWithOrder: Banner = {
          ...banner,
          mobile_image_url: null,
          alt: banner.alt.trim() || DEFAULT_BANNER_ALT,
          display_order: displayOrder,
        };
        const next: StoreData = {
          ...data,
          banners: existing
            ? data.banners.map((b) => (b.id === banner.id ? bannerWithOrder : b))
            : [...data.banners, bannerWithOrder],
        };
        saveStore(next);
        setData(next);
        return;
      }

      const oldUrls: string[] = [];
      if (
        existing?.image_url &&
        existing.image_url !== banner.image_url &&
        !isImageStillReferenced(existing.image_url, data, { kind: "banners", id: existing.id })
      ) {
        oldUrls.push(existing.image_url);
      }
      if (
        existing?.mobile_image_url &&
        !isImageStillReferenced(existing.mobile_image_url, data, {
          kind: "banners",
          id: existing.id,
        })
      ) {
        oldUrls.push(existing.mobile_image_url);
      }

      const saved = await upsertBanner(banner, displayOrder, oldUrls);
      setData((prev) => ({
        ...prev,
        banners: prev.banners.some((b) => b.id === saved.id)
          ? prev.banners.map((b) => (b.id === saved.id ? saved : b))
          : [...prev.banners, saved],
      }));
      notifyStoreChanged();
    },
    [data],
  );

  const reorderBanners = useCallback(
    async (nextBanners: Banner[]) => {
      const ordered = nextBanners.map((b, index) => ({ ...b, display_order: index }));
      if (!isSupabaseConfigured) {
        const next: StoreData = { ...data, banners: ordered };
        saveStore(next);
        setData(next);
        return;
      }

      const saved = await saveBannersOrder(ordered);
      setData((prev) => ({ ...prev, banners: saved }));
      notifyStoreChanged();
    },
    [data],
  );

  const deleteBanner = useCallback(
    async (id: string) => {
      const existing = data.banners.find((b) => b.id === id);
      if (!isSupabaseConfigured) {
        const next: StoreData = {
          ...data,
          banners: data.banners.filter((b) => b.id !== id),
        };
        saveStore(next);
        setData(next);
        return;
      }

      const cleanUrls: string[] = [];
      if (
        existing?.image_url &&
        !isImageStillReferenced(existing.image_url, data, { kind: "banners", id })
      ) {
        cleanUrls.push(existing.image_url);
      }
      if (
        existing?.mobile_image_url &&
        !isImageStillReferenced(existing.mobile_image_url, data, { kind: "banners", id })
      ) {
        cleanUrls.push(existing.mobile_image_url);
      }

      await removeBanner(id, cleanUrls);
      setData((prev) => ({
        ...prev,
        banners: prev.banners.filter((b) => b.id !== id),
      }));
      notifyStoreChanged();
    },
    [data],
  );

  const saveAnnouncement = useCallback(
    async (announcement: StoreAnnouncement) => {
      if (!isSupabaseConfigured) {
        const next: StoreData = { ...data, announcement };
        saveStore(next);
        setData(next);
        return;
      }

      const saved = await saveStoreAnnouncement(announcement);
      setData((prev) => ({ ...prev, announcement: saved }));
      notifyStoreChanged();
    },
    [data],
  );

  const savePromotion = useCallback(
    async (promotion: StorePromotion) => {
      const normalized: StorePromotion = {
        promo_active: Boolean(promotion.promo_active),
        promo_badge: promotion.promo_badge.trim() || defaultPromotion.promo_badge,
        promo_title: promotion.promo_title.trim(),
        promo_description: promotion.promo_description.trim(),
        promo_highlight: promotion.promo_highlight.trim(),
        promo_cta_label: promotion.promo_cta_label.trim(),
        promo_cta_type: promotion.promo_cta_type === "whatsapp" ? "whatsapp" : "vitrine",
      };

      if (!isSupabaseConfigured) {
        const next: StoreData = { ...data, promotion: normalized };
        saveStore(next);
        setData(next);
        return;
      }

      const saved = await saveStorePromotion(normalized);
      setData((prev) => ({ ...prev, promotion: saved }));
      notifyStoreChanged();
    },
    [data],
  );

  const saveCoupon = useCallback(
    async (coupon: Coupon) => {
      const normalized = { ...coupon, code: normalizeCode(coupon.code) };
      if (!isSupabaseConfigured) {
        const exists = data.coupons.some((c) => c.id === normalized.id);
        const next: StoreData = {
          ...data,
          coupons: exists
            ? data.coupons.map((c) => (c.id === normalized.id ? normalized : c))
            : [...data.coupons, normalized],
        };
        saveStore(next);
        setData(next);
        return;
      }

      const saved = await upsertCoupon(normalized);
      setData((prev) => ({
        ...prev,
        coupons: prev.coupons.some((c) => c.id === saved.id)
          ? prev.coupons.map((c) => (c.id === saved.id ? saved : c))
          : [saved, ...prev.coupons],
      }));
      notifyStoreChanged();
    },
    [data],
  );

  const deleteCoupon = useCallback(
    async (id: string) => {
      if (!isSupabaseConfigured) {
        const next: StoreData = {
          ...data,
          coupons: data.coupons.filter((c) => c.id !== id),
        };
        saveStore(next);
        setData(next);
        return;
      }

      await removeCoupon(id);
      setData((prev) => ({
        ...prev,
        coupons: prev.coupons.filter((c) => c.id !== id),
      }));
      notifyStoreChanged();
    },
    [data],
  );

  const saveProfile = useCallback(
    async (profile: AdminProfile) => {
      if (!isSupabaseConfigured) {
        const next: StoreData = { ...data, profile };
        saveStore(next);
        setData(next);
        return;
      }

      const oldAvatar =
        data.profile.avatar && data.profile.avatar !== profile.avatar
          ? data.profile.avatar
          : undefined;

      const saved = await saveAdminProfile(profile, oldAvatar);
      setData((prev) => ({ ...prev, profile: saved }));
      notifyStoreChanged();
    },
    [data],
  );

  return {
    data,
    loading,
    error,
    isRemote: isSupabaseConfigured,
    refresh,
    update,
    saveProduct,
    toggleProductField,
    duplicateProduct,
    deleteProduct,
    bulkUpdateProducts,
    bulkDeleteProducts,
    saveBanner,
    reorderBanners,
    deleteBanner,
    saveAnnouncement,
    savePromotion,
    saveCoupon,
    deleteCoupon,
    saveProfile,
  };
}
