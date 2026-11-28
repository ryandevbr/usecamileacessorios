import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIVE_STORE_SLUG,
  NICHE_CATALOG_DEFAULTS,
  STORE_CONFIG,
  getMaterialLabel,
  getMaterialLabelPlural,
  type StoreNiche,
} from "@/config/store.config";
import { isSupabaseConfigured, requireSupabase, supabase } from "@/lib/supabase";

export type CatalogOptionType = "category" | "material";

export interface CatalogOption {
  id: string;
  type: CatalogOptionType;
  name: string;
  created_at: string;
}

const STORAGE_KEY = `store-catalog-options-v1-${ACTIVE_STORE_SLUG}-${STORE_CONFIG.niche}`;
const OPTIONS_EVENT = "store-catalog-options-changed";

export function normalizeOptionName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function optionLookupKey(name: string): string {
  return normalizeOptionName(name).toLocaleLowerCase("pt-BR");
}

const LEGACY_ACCESSORY_CATEGORY_KEYS = new Set(
  NICHE_CATALOG_DEFAULTS.acessorios.categories.map(optionLookupKey),
);
const LEGACY_ACCESSORY_MATERIAL_KEYS = new Set(
  NICHE_CATALOG_DEFAULTS.acessorios.materials.map(optionLookupKey),
);
const LEGACY_ACCESSORY_SIGNATURE_KEYS = new Set(
  ["Anéis", "Colares", "Brincos", "Prata 925", "Semijoia"].map(optionLookupKey),
);

/**
 * Detecta se a lista de catalog_options vinda do Supabase contém apenas
 * o seed padrão antigo de acessórios (ex.: Anéis, Colares, Brincos, Prata 925, Semijoia).
 */
export function isLegacyAccessoriesOnlyOptions(options: CatalogOption[]): boolean {
  if (options.length === 0) return false;

  const allBelongToAccessoriesDefaults = options.every((item) => {
    const key = optionLookupKey(item.name);
    return item.type === "category"
      ? LEGACY_ACCESSORY_CATEGORY_KEYS.has(key)
      : LEGACY_ACCESSORY_MATERIAL_KEYS.has(key);
  });
  if (!allBelongToAccessoriesDefaults) return false;

  const conjuntosKey = optionLookupKey("Conjuntos");
  return options.some((item) => {
    const key = optionLookupKey(item.name);
    return (
      LEGACY_ACCESSORY_SIGNATURE_KEYS.has(key) ||
      (item.type === "material" && LEGACY_ACCESSORY_MATERIAL_KEYS.has(key)) ||
      (item.type === "category" && key !== conjuntosKey && LEGACY_ACCESSORY_CATEGORY_KEYS.has(key))
    );
  });
}

async function hasAnyProductInDatabase(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  const { count, error } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("store_slug", ACTIVE_STORE_SLUG);
  if (error) {
    // Em caso de falha na checagem de contagem, evita substituir opções existentes por segurança
    return true;
  }
  return (count ?? 0) > 0;
}

export function buildDefaultOptions(niche: StoreNiche = STORE_CONFIG.niche): CatalogOption[] {
  const now = new Date(0).toISOString();
  const defaults = NICHE_CATALOG_DEFAULTS[niche];
  return [
    ...defaults.categories.map((name, index) => ({
      id: `default-${niche}-category-${index + 1}`,
      type: "category" as const,
      name,
      created_at: now,
    })),
    ...defaults.materials.map((name, index) => ({
      id: `default-${niche}-material-${index + 1}`,
      type: "material" as const,
      name,
      created_at: now,
    })),
  ];
}

function buildSeedPayload(niche: StoreNiche = STORE_CONFIG.niche) {
  const defaults = NICHE_CATALOG_DEFAULTS[niche];
  return [
    ...defaults.categories.map((name) => ({
      store_slug: ACTIVE_STORE_SLUG,
      type: "category" as const,
      name,
    })),
    ...defaults.materials.map((name) => ({
      store_slug: ACTIVE_STORE_SLUG,
      type: "material" as const,
      name,
    })),
  ];
}

function mapCatalogOptionRow(row: CatalogOption): CatalogOption {
  return {
    id: row.id,
    type: row.type === "material" ? "material" : "category",
    name: normalizeOptionName(row.name),
    created_at: row.created_at,
  };
}

function notifyOptionsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OPTIONS_EVENT));
  }
}

export function loadLocalCatalogOptions(): CatalogOption[] {
  if (typeof window === "undefined") {
    return buildDefaultOptions();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const defaults = buildDefaultOptions();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
      return defaults;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return buildDefaultOptions();
    return parsed.filter(
      (item): item is CatalogOption =>
        item != null &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        (item.type === "category" || item.type === "material") &&
        typeof item.name === "string" &&
        normalizeOptionName(item.name) !== "",
    );
  } catch {
    return buildDefaultOptions();
  }
}

function saveLocalCatalogOptions(options: CatalogOption[]) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
    notifyOptionsChanged();
  }
}

export function mergeOptionValues(primary: string[], extras: string[] = []): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of [...primary, ...extras]) {
    const clean = normalizeOptionName(raw);
    if (!clean) continue;
    const key = optionLookupKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }

  return result;
}

export async function listCatalogOptions(): Promise<CatalogOption[]> {
  if (!isSupabaseConfigured || !supabase) {
    return loadLocalCatalogOptions();
  }

  const { data, error } = await supabase
    .from("catalog_options")
    .select("id, type, name, created_at")
    .eq("store_slug", ACTIVE_STORE_SLUG)
    .order("created_at", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(
      `Erro ao carregar categorias e ${getMaterialLabelPlural().toLowerCase()}: ${error.message}`,
    );
  }

  return ((data ?? []) as CatalogOption[]).map(mapCatalogOptionRow);
}

export async function seedCatalogOptionsForNiche(
  niche: StoreNiche = STORE_CONFIG.niche,
): Promise<CatalogOption[]> {
  if (!isSupabaseConfigured || !supabase) {
    const defaults = buildDefaultOptions(niche);
    saveLocalCatalogOptions(defaults);
    return defaults;
  }

  const client = requireSupabase();
  const payload = buildSeedPayload(niche);
  const { data, error } = await client
    .from("catalog_options")
    .insert(payload)
    .select("id, type, name, created_at");

  if (error) {
    if (error.code === "23505") {
      return listCatalogOptions();
    }
    throw new Error(`Erro ao inicializar padrões do catálogo: ${error.message}`);
  }

  notifyOptionsChanged();
  return ((data ?? []) as CatalogOption[]).map(mapCatalogOptionRow);
}

export async function resetCatalogOptionsToNicheDefaults(
  niche: StoreNiche = STORE_CONFIG.niche,
): Promise<CatalogOption[]> {
  if (!isSupabaseConfigured || !supabase) {
    const defaults = buildDefaultOptions(niche);
    saveLocalCatalogOptions(defaults);
    return defaults;
  }

  const client = requireSupabase();
  const existing = await listCatalogOptions();
  if (existing.length > 0) {
    const { error: deleteError } = await client
      .from("catalog_options")
      .delete()
      .in(
        "id",
        existing.map((item) => item.id),
      )
      .eq("store_slug", ACTIVE_STORE_SLUG);
    if (deleteError) {
      throw new Error(`Erro ao limpar opções anteriores: ${deleteError.message}`);
    }
  }

  return seedCatalogOptionsForNiche(niche);
}

export async function addCatalogOption(
  type: CatalogOptionType,
  rawName: string,
): Promise<CatalogOption> {
  const name = normalizeOptionName(rawName);
  const materialWord = getMaterialLabel().toLowerCase();
  const label = type === "category" ? "categoria" : materialWord;
  if (!name) {
    throw new Error(
      `Informe o nome ${type === "category" ? "da categoria" : `do ${materialWord}`}.`,
    );
  }

  if (!isSupabaseConfigured || !supabase) {
    const current = loadLocalCatalogOptions();
    const duplicate = current.some(
      (item) => item.type === type && optionLookupKey(item.name) === optionLookupKey(name),
    );
    if (duplicate) {
      throw new Error(
        type === "category"
          ? "Esta categoria já está cadastrada."
          : `Este ${materialWord} já está cadastrado.`,
      );
    }

    const created: CatalogOption = {
      id: crypto.randomUUID(),
      type,
      name,
      created_at: new Date().toISOString(),
    };
    saveLocalCatalogOptions([...current, created]);
    return created;
  }

  const client = requireSupabase();
  const existing = await listCatalogOptions();
  const duplicate = existing.some(
    (item) => item.type === type && optionLookupKey(item.name) === optionLookupKey(name),
  );
  if (duplicate) {
    throw new Error(
      type === "category"
        ? "Esta categoria já está cadastrada."
        : `Este ${materialWord} já está cadastrado.`,
    );
  }

  const { data, error } = await client
    .from("catalog_options")
    .insert({ store_slug: ACTIVE_STORE_SLUG, type, name })
    .select("id, type, name, created_at")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      throw new Error(
        type === "category"
          ? "Esta categoria já está cadastrada."
          : `Este ${materialWord} já está cadastrado.`,
      );
    }
    throw new Error(`Erro ao salvar ${label}: ${error?.message ?? "resposta vazia"}`);
  }

  notifyOptionsChanged();
  return mapCatalogOptionRow(data as CatalogOption);
}

export async function deleteCatalogOption(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    const current = loadLocalCatalogOptions();
    saveLocalCatalogOptions(current.filter((item) => item.id !== id));
    return;
  }

  const client = requireSupabase();
  const { error } = await client
    .from("catalog_options")
    .delete()
    .eq("id", id)
    .eq("store_slug", ACTIVE_STORE_SLUG);
  if (error) {
    throw new Error(`Erro ao excluir opção: ${error.message}`);
  }
  notifyOptionsChanged();
}

export function useCatalogOptions(options?: { enabled?: boolean; autoSeed?: boolean }) {
  const enabled = options?.enabled ?? true;
  const autoSeed = options?.autoSeed ?? false;
  const [items, setItems] = useState<CatalogOption[]>(() =>
    buildDefaultOptions(STORE_CONFIG.niche),
  );
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured && enabled);
  const [error, setError] = useState<string | null>(null);
  const autoSyncAttemptedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (!isSupabaseConfigured) {
      setItems(loadLocalCatalogOptions());
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const remote = await listCatalogOptions();
      const niche = STORE_CONFIG.niche;

      if (remote.length === 0) {
        if (autoSeed && !autoSyncAttemptedRef.current) {
          autoSyncAttemptedRef.current = true;
          const seeded = await seedCatalogOptionsForNiche(niche);
          setItems(seeded.length > 0 ? seeded : buildDefaultOptions(niche));
        } else {
          setItems(buildDefaultOptions(niche));
        }
      } else if (
        (niche === "moda" || niche === "calcados") &&
        isLegacyAccessoriesOnlyOptions(remote)
      ) {
        const hasProducts = await hasAnyProductInDatabase();
        if (!hasProducts) {
          if (autoSeed && !autoSyncAttemptedRef.current) {
            autoSyncAttemptedRef.current = true;
            const replaced = await resetCatalogOptionsToNicheDefaults(niche);
            setItems(replaced.length > 0 ? replaced : buildDefaultOptions(niche));
          } else {
            setItems(buildDefaultOptions(niche));
          }
        } else {
          setItems(remote);
        }
      } else {
        setItems(remote);
      }
      setError(null);
    } catch (err) {
      setItems(buildDefaultOptions(STORE_CONFIG.niche));
      setError(err instanceof Error ? err.message : "Erro ao carregar opções do catálogo.");
    } finally {
      setLoading(false);
    }
  }, [enabled, autoSeed]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const handleEvent = () => {
      void refresh();
    };
    window.addEventListener(OPTIONS_EVENT, handleEvent);
    if (!isSupabaseConfigured) {
      window.addEventListener("storage", handleEvent);
    }
    return () => {
      window.removeEventListener(OPTIONS_EVENT, handleEvent);
      if (!isSupabaseConfigured) {
        window.removeEventListener("storage", handleEvent);
      }
    };
  }, [refresh, enabled]);

  const categories = useMemo(() => items.filter((item) => item.type === "category"), [items]);
  const materials = useMemo(() => items.filter((item) => item.type === "material"), [items]);
  const categoryNames = useMemo(() => categories.map((item) => item.name), [categories]);
  const materialNames = useMemo(() => materials.map((item) => item.name), [materials]);

  const addOption = useCallback(async (type: CatalogOptionType, rawName: string) => {
    const created = await addCatalogOption(type, rawName);
    setItems((prev) => (prev.some((item) => item.id === created.id) ? prev : [...prev, created]));
    return created;
  }, []);

  const removeOption = useCallback(async (id: string) => {
    await deleteCatalogOption(id);
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const applyNicheDefaults = useCallback(async (niche: StoreNiche = STORE_CONFIG.niche) => {
    autoSyncAttemptedRef.current = true;
    const next = await resetCatalogOptionsToNicheDefaults(niche);
    setItems(next);
    return next;
  }, []);

  return {
    options: items,
    categories,
    materials,
    categoryNames,
    materialNames,
    loading,
    error,
    refresh,
    addOption,
    removeOption,
    applyNicheDefaults,
  };
}
