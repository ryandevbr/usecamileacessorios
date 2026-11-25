import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_CATEGORIES, DEFAULT_MATERIALS } from "@/data/catalog";
import { isSupabaseConfigured, requireSupabase, supabase } from "@/lib/supabase";

export type CatalogOptionType = "category" | "material";

export interface CatalogOption {
  id: string;
  type: CatalogOptionType;
  name: string;
  created_at: string;
}

const STORAGE_KEY = "use-camile-catalog-options-v1";
const OPTIONS_EVENT = "camile-catalog-options";

export function normalizeOptionName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function optionLookupKey(name: string): string {
  return normalizeOptionName(name).toLocaleLowerCase("pt-BR");
}

function buildDefaultOptions(): CatalogOption[] {
  const now = new Date(0).toISOString();
  return [
    ...DEFAULT_CATEGORIES.map((name, index) => ({
      id: `default-category-${index + 1}`,
      type: "category" as const,
      name,
      created_at: now,
    })),
    ...DEFAULT_MATERIALS.map((name, index) => ({
      id: `default-material-${index + 1}`,
      type: "material" as const,
      name,
      created_at: now,
    })),
  ];
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
    .order("created_at", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Erro ao carregar categorias e materiais: ${error.message}`);
  }

  return ((data ?? []) as CatalogOption[]).map((row) => ({
    id: row.id,
    type: row.type === "material" ? "material" : "category",
    name: normalizeOptionName(row.name),
    created_at: row.created_at,
  }));
}

export async function addCatalogOption(
  type: CatalogOptionType,
  rawName: string,
): Promise<CatalogOption> {
  const name = normalizeOptionName(rawName);
  const label = type === "category" ? "categoria" : "material";
  if (!name) {
    throw new Error(`Informe o nome ${type === "category" ? "da categoria" : "do material"}.`);
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
          : "Este material já está cadastrado.",
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
        : "Este material já está cadastrado.",
    );
  }

  const { data, error } = await client
    .from("catalog_options")
    .insert({ type, name })
    .select("id, type, name, created_at")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      throw new Error(
        type === "category"
          ? "Esta categoria já está cadastrada."
          : "Este material já está cadastrado.",
      );
    }
    throw new Error(`Erro ao salvar ${label}: ${error?.message ?? "resposta vazia"}`);
  }

  notifyOptionsChanged();
  const row = data as CatalogOption;
  return {
    id: row.id,
    type: row.type === "material" ? "material" : "category",
    name: normalizeOptionName(row.name),
    created_at: row.created_at,
  };
}

export async function deleteCatalogOption(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    const current = loadLocalCatalogOptions();
    saveLocalCatalogOptions(current.filter((item) => item.id !== id));
    return;
  }

  const client = requireSupabase();
  const { error } = await client.from("catalog_options").delete().eq("id", id);
  if (error) {
    throw new Error(`Erro ao excluir opção: ${error.message}`);
  }
  notifyOptionsChanged();
}

export function useCatalogOptions(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const [items, setItems] = useState<CatalogOption[]>(() =>
    isSupabaseConfigured ? [] : buildDefaultOptions(),
  );
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured && enabled);
  const [error, setError] = useState<string | null>(null);

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
      setItems(remote);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar opções do catálogo.");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

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
  };
}
