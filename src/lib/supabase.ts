import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_STORE_SLUG } from "@/config/store.config";
import type { Product, ProductCharacteristic } from "@/types";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

export const STORE_MEDIA_BUCKET = "store-media";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      "Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env.",
    );
  }
  return supabase;
}

export const PRODUCT_SELECT_COLUMNS =
  "id, name, sku, category, material, price, sale_price, is_on_sale, sale_label, image_url, description, active, featured, in_stock, characteristics, sizes";

export const PRODUCT_SELECT_COLUMNS_LEGACY =
  "id, name, sku, category, material, price, sale_price, is_on_sale, sale_label, image_url, description, active, featured, in_stock, characteristics";

export interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  material: string;
  price: number | string;
  sale_price: number | string | null;
  is_on_sale: boolean;
  sale_label: string | null;
  image_url: string | null;
  description: string | null;
  active: boolean;
  featured: boolean;
  in_stock: boolean;
  characteristics: unknown;
  sizes?: unknown;
}

export function parseProductCharacteristics(raw: unknown): ProductCharacteristic[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is { attribute?: unknown; value?: unknown } =>
        item != null && typeof item === "object",
    )
    .map((item) => ({
      attribute: typeof item.attribute === "string" ? item.attribute : "",
      value: typeof item.value === "string" ? item.value : "",
    }));
}

export function parseProductSizes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const clean = item.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result;
}

export function mapProductRow(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku ?? "",
    category: row.category,
    material: row.material,
    price: Number(row.price),
    sale_price: Number(row.sale_price ?? 0),
    is_on_sale: Boolean(row.is_on_sale),
    sale_label: row.sale_label ?? "",
    image_url: row.image_url ?? "",
    description: row.description ?? "",
    active: Boolean(row.active),
    featured: Boolean(row.featured),
    in_stock: Boolean(row.in_stock),
    characteristics: parseProductCharacteristics(row.characteristics),
    sizes: parseProductSizes(row.sizes),
  };
}

export function toProductPayload(product: Product) {
  return {
    id: product.id || crypto.randomUUID(),
    store_slug: ACTIVE_STORE_SLUG,
    name: product.name.trim(),
    sku: product.sku.trim(),
    category: product.category,
    material: product.material,
    price: Number(product.price),
    sale_price: product.is_on_sale
      ? Number(product.sale_price)
      : Math.max(0, Number(product.sale_price || 0)),
    is_on_sale: Boolean(product.is_on_sale),
    sale_label: product.sale_label.trim(),
    image_url: product.image_url.trim(),
    description: product.description.trim(),
    active: Boolean(product.active),
    featured: Boolean(product.featured),
    in_stock: Boolean(product.in_stock),
    characteristics: product.characteristics
      .map((item) => ({ attribute: item.attribute.trim(), value: item.value.trim() }))
      .filter((item) => item.attribute !== "" || item.value !== ""),
    sizes: parseProductSizes(product.sizes),
  };
}
