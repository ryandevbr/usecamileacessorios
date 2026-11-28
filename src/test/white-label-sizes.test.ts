import { describe, expect, it } from "vitest";
import {
  QUICK_SIZES,
  STORE_CONFIG,
  applyStoreTheme,
  buildRootThemeCss,
  getMaterialLabel,
  getMaterialLabelPlural,
  getPhysicalStoreMapsUrl,
  getWhatsappUrl,
  hasActivePhysicalStore,
  toggleQuickSize,
} from "@/config/store.config";
import { mapProductRow, parseProductSizes, toProductPayload } from "@/lib/supabase";

describe("White-label STORE_CONFIG and product sizes", () => {
  it("switches Material/Tecido labels dynamically by niche", () => {
    expect(getMaterialLabel("moda")).toBe("Tecido");
    expect(getMaterialLabelPlural("moda")).toBe("Tecidos");
    expect(getMaterialLabel("acessorios")).toBe("Material");
    expect(getMaterialLabelPlural("acessorios")).toBe("Materiais");
  });

  it("generates CSS variables and applies theme onto :root", () => {
    const css = buildRootThemeCss(STORE_CONFIG.theme);
    expect(css).toContain(`--primary:${STORE_CONFIG.theme.primary};`);
    expect(css).toContain(`--primary-hover:${STORE_CONFIG.theme.primaryHover};`);
    expect(css).toContain(`--surface:${STORE_CONFIG.theme.surface};`);

    applyStoreTheme(STORE_CONFIG.theme, STORE_CONFIG.name);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      STORE_CONFIG.theme.primary,
    );
    expect(document.documentElement.style.getPropertyValue("--foreground")).toBe(
      STORE_CONFIG.theme.foreground,
    );
  });

  it("handles physicalStore active toggle and URL builders", () => {
    expect(hasActivePhysicalStore({ ...STORE_CONFIG, physicalStore: undefined })).toBe(false);
    expect(
      hasActivePhysicalStore({
        ...STORE_CONFIG,
        physicalStore: {
          active: true,
          title: "Loja Centro",
          address: "Rua A, 10",
          cityState: "BH - MG",
          mapsQuery: "Rua A, 10, BH",
        },
      }),
    ).toBe(true);
    expect(getWhatsappUrl("Olá", "55 (31) 99999-9999")).toBe(
      "https://wa.me/5531999999999?text=Ol%C3%A1",
    );
    expect(
      getPhysicalStoreMapsUrl({
        active: true,
        title: "Loja",
        address: "Rua A, 10",
        cityState: "BH - MG",
        mapsQuery: "Rua A, 10, BH",
      }),
    ).toContain("google.com/maps/search/?api=1&query=");
  });

  it("toggles quick sizes in canonical order and maps Supabase product rows", () => {
    let sizes: string[] = [];
    sizes = toggleQuickSize(sizes, "G");
    sizes = toggleQuickSize(sizes, "P");
    sizes = toggleQuickSize(sizes, "M");
    expect(sizes).toEqual(["P", "M", "G"]);

    sizes = toggleQuickSize(sizes, "M");
    expect(sizes).toEqual(["P", "G"]);
    expect(QUICK_SIZES).toContain("Tamanho Único");

    expect(parseProductSizes([" P ", "M", "P", "", 123])).toEqual(["P", "M"]);
    expect(parseProductSizes(null)).toEqual([]);

    const mapped = mapProductRow({
      id: "p1",
      name: "Vestido Midi",
      sku: "V01",
      category: "Vestidos",
      material: "Linho",
      price: 199.9,
      sale_price: 0,
      is_on_sale: false,
      sale_label: "",
      image_url: "/logo.png",
      description: "Leve e elegante",
      active: true,
      featured: false,
      in_stock: true,
      characteristics: [],
      sizes: ["P", "M", "G"],
    });
    expect(mapped.sizes).toEqual(["P", "M", "G"]);
    expect(toProductPayload(mapped).sizes).toEqual(["P", "M", "G"]);
  });
});
