import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  STORE_MEDIA_BUCKET: "store-media",
  isSupabaseConfigured: false,
  supabase: null,
  requireSupabase: () => {
    throw new Error("Supabase mockado no teste local");
  },
}));

import {
  addCatalogOption,
  deleteCatalogOption,
  listCatalogOptions,
  mergeOptionValues,
  normalizeOptionName,
} from "@/services/catalogOptionsService";

describe("Catalog options service (fallback local)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("seeds default categories and materials", async () => {
    const options = await listCatalogOptions();
    const categories = options.filter((o) => o.type === "category").map((o) => o.name);
    const materials = options.filter((o) => o.type === "material").map((o) => o.name);

    expect(categories).toEqual(
      expect.arrayContaining([
        "Anéis",
        "Colares",
        "Brincos",
        "Pulseiras",
        "Tornozeleiras",
        "Conjuntos",
      ]),
    );
    expect(materials).toEqual(expect.arrayContaining(["Prata 925", "Semijoia"]));
  });

  it("trims whitespace, blocks empty values, and prevents case-insensitive duplicates", async () => {
    expect(normalizeOptionName("  Aço   Inox  ")).toBe("Aço Inox");
    await expect(addCatalogOption("category", "   ")).rejects.toThrow();
    await expect(addCatalogOption("category", "anéis")).rejects.toThrow();

    const added = await addCatalogOption("material", "  Aço Inox ");
    expect(added.name).toBe("Aço Inox");
    await expect(addCatalogOption("material", "aço inox")).rejects.toThrow();

    await deleteCatalogOption(added.id);
    const afterDelete = await listCatalogOptions();
    expect(afterDelete.some((o) => o.id === added.id)).toBe(false);
  });

  it("merges and deduplicates option lists case-insensitively", () => {
    expect(
      mergeOptionValues(["Prata 925", "Semijoia"], ["semijoia", "Aço Inox", "  PRATA 925 "]),
    ).toEqual(["Prata 925", "Semijoia", "Aço Inox"]);
  });
});
