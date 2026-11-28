import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  STORE_MEDIA_BUCKET: "store-media",
  isSupabaseConfigured: false,
  supabase: null,
  requireSupabase: () => {
    throw new Error("Supabase mockado no teste local");
  },
}));

import { NICHE_CATALOG_DEFAULTS, STORE_CONFIG } from "@/config/store.config";
import {
  addCatalogOption,
  buildDefaultOptions,
  deleteCatalogOption,
  isLegacyAccessoriesOnlyOptions,
  listCatalogOptions,
  mergeOptionValues,
  normalizeOptionName,
  resetCatalogOptionsToNicheDefaults,
} from "@/services/catalogOptionsService";

describe("Catalog options service (fallback local)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("seeds default categories and materials matching STORE_CONFIG.niche", async () => {
    const options = await listCatalogOptions();
    const categories = options.filter((o) => o.type === "category").map((o) => o.name);
    const materials = options.filter((o) => o.type === "material").map((o) => o.name);
    const expected = NICHE_CATALOG_DEFAULTS[STORE_CONFIG.niche];

    expect(categories).toEqual([...expected.categories]);
    expect(materials).toEqual([...expected.materials]);
  });

  it("resets options cleanly when applying moda or acessorios defaults", async () => {
    const modaOptions = await resetCatalogOptionsToNicheDefaults("moda");
    expect(modaOptions.filter((o) => o.type === "category").map((o) => o.name)).toEqual([
      ...NICHE_CATALOG_DEFAULTS.moda.categories,
    ]);
    expect(modaOptions.filter((o) => o.type === "material").map((o) => o.name)).toEqual([
      ...NICHE_CATALOG_DEFAULTS.moda.materials,
    ]);
    expect(modaOptions.some((o) => o.name === "Anéis" || o.name === "Prata 925")).toBe(false);

    const accOptions = await resetCatalogOptionsToNicheDefaults("acessorios");
    expect(accOptions.filter((o) => o.type === "category").map((o) => o.name)).toEqual([
      ...NICHE_CATALOG_DEFAULTS.acessorios.categories,
    ]);
    expect(accOptions.filter((o) => o.type === "material").map((o) => o.name)).toEqual([
      ...NICHE_CATALOG_DEFAULTS.acessorios.materials,
    ]);

    const calcadosOptions = await resetCatalogOptionsToNicheDefaults("calcados");
    expect(calcadosOptions.filter((o) => o.type === "category").map((o) => o.name)).toEqual([
      ...NICHE_CATALOG_DEFAULTS.calcados.categories,
    ]);
    expect(calcadosOptions.filter((o) => o.type === "material").map((o) => o.name)).toEqual([
      ...NICHE_CATALOG_DEFAULTS.calcados.materials,
    ]);
    expect(calcadosOptions.some((o) => o.name === "Anéis" || o.name === "Prata 925")).toBe(false);
  });

  it("detects legacy accessories-only options accurately without false positives", () => {
    const legacyRows = [
      { id: "1", type: "category" as const, name: "Anéis", created_at: "" },
      { id: "2", type: "category" as const, name: "Colares", created_at: "" },
      { id: "3", type: "category" as const, name: "Brincos", created_at: "" },
      { id: "4", type: "category" as const, name: "Conjuntos", created_at: "" },
      { id: "5", type: "material" as const, name: "Prata 925", created_at: "" },
      { id: "6", type: "material" as const, name: "Semijoia", created_at: "" },
    ];
    expect(isLegacyAccessoriesOnlyOptions(legacyRows)).toBe(true);
    expect(isLegacyAccessoriesOnlyOptions(buildDefaultOptions("acessorios"))).toBe(true);
    expect(isLegacyAccessoriesOnlyOptions(buildDefaultOptions("moda"))).toBe(false);
    expect(isLegacyAccessoriesOnlyOptions(buildDefaultOptions("calcados"))).toBe(false);
    expect(
      isLegacyAccessoriesOnlyOptions([
        { id: "1", type: "category", name: "Conjuntos", created_at: "" },
      ]),
    ).toBe(false);
    expect(
      isLegacyAccessoriesOnlyOptions([
        ...legacyRows,
        { id: "7", type: "category", name: "Vestidos", created_at: "" },
      ]),
    ).toBe(false);
  });

  it("trims whitespace, blocks empty values, and prevents case-insensitive duplicates", async () => {
    const firstCategory = NICHE_CATALOG_DEFAULTS[STORE_CONFIG.niche].categories[0] ?? "Vestidos";
    expect(normalizeOptionName("  Linho   Puro  ")).toBe("Linho Puro");
    await expect(addCatalogOption("category", "   ")).rejects.toThrow();
    await expect(addCatalogOption("category", firstCategory.toLowerCase())).rejects.toThrow();

    const added = await addCatalogOption("material", "  Seda Pura ");
    expect(added.name).toBe("Seda Pura");
    await expect(addCatalogOption("material", "seda pura")).rejects.toThrow();

    await deleteCatalogOption(added.id);
    const afterDelete = await listCatalogOptions();
    expect(afterDelete.some((o) => o.id === added.id)).toBe(false);
  });

  it("merges and deduplicates option lists case-insensitively", () => {
    expect(
      mergeOptionValues(["Linho", "Alfaiataria"], ["alfaiataria", "Crepe", "  LINHO "]),
    ).toEqual(["Linho", "Alfaiataria", "Crepe"]);
  });
});
