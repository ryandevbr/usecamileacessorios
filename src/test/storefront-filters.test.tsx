import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Product, StoreData } from "@/types";

const mockUseStore = vi.fn();
const mockUseCatalogOptions = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to?: string }) => (
    <a href={to ?? "#"} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/services/storeService", () => ({
  useStore: (...args: unknown[]) => mockUseStore(...args),
}));

vi.mock("@/services/catalogOptionsService", async () => {
  const actual = await vi.importActual<typeof import("@/services/catalogOptionsService")>(
    "@/services/catalogOptionsService",
  );
  return {
    ...actual,
    useCatalogOptions: (...args: unknown[]) => mockUseCatalogOptions(...args),
  };
});

import { Storefront } from "@/components/storefront";

function makeProduct(overrides: Partial<Product>): Product {
  return {
    id: overrides.id ?? "p-1",
    name: overrides.name ?? "Peça Teste",
    sku: overrides.sku ?? "TST-001",
    category: overrides.category ?? "Vestidos",
    material: overrides.material ?? "Linho",
    price: overrides.price ?? 149.9,
    sale_price: overrides.sale_price ?? 0,
    is_on_sale: overrides.is_on_sale ?? false,
    sale_label: overrides.sale_label ?? "",
    image_url: overrides.image_url ?? "/logo.png",
    description: overrides.description ?? "Descrição teste",
    active: overrides.active ?? true,
    featured: overrides.featured ?? false,
    in_stock: overrides.in_stock ?? true,
    characteristics: overrides.characteristics ?? [],
    sizes: overrides.sizes ?? [],
  };
}

function makeStoreData(products: Product[]): StoreData {
  return {
    products,
    coupons: [],
    banners: [],
    announcement: { active: false, text: "", link: "" },
    promotion: {
      promo_active: false,
      promo_badge: "",
      promo_title: "",
      promo_description: "",
      promo_highlight: "",
      promo_cta_label: "",
      promo_cta_type: "vitrine",
    },
    profile: { name: "Admin", email: "admin@test.com", avatar: "" },
  };
}

function getFilterPillTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("button.filter-pill")).map((el) =>
    (el.textContent ?? "").trim(),
  );
}

describe("Storefront dynamic filter pills", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    mockUseCatalogOptions.mockReturnValue({
      categoryNames: ["Vestidos", "Conjuntos", "Calças", "Blusas"],
      materialNames: ["Linho", "Alfaiataria", "Jeans"],
    });
  });

  it("shows only Todos when there are no active products", () => {
    mockUseStore.mockReturnValue({
      data: makeStoreData([
        makeProduct({
          id: "inactive-1",
          category: "Vestidos",
          material: "Linho",
          is_on_sale: true,
          sale_price: 99.9,
          active: false,
        }),
      ]),
      loading: false,
      error: null,
    });

    const { container } = render(<Storefront />);
    expect(getFilterPillTexts(container)).toEqual(["Todos"]);
  });

  it("hides Promoções when is_on_sale is true but sale_price <= 0, and matches case/spaces", () => {
    mockUseStore.mockReturnValue({
      data: makeStoreData([
        makeProduct({
          id: "p1",
          category: "  vestidos  ",
          material: " LINHO ",
          is_on_sale: true,
          sale_price: 0,
          active: true,
        }),
        makeProduct({
          id: "p2",
          category: "Calças",
          material: "Jeans",
          is_on_sale: true,
          sale_price: 79.9,
          active: false,
        }),
      ]),
      loading: false,
      error: null,
    });

    const { container } = render(<Storefront />);
    expect(getFilterPillTexts(container)).toEqual(["Todos", "Linho", "Vestidos"]);
  });

  it("shows Promoções when at least one active product has is_on_sale && sale_price > 0 and resets filter to Todos when selected filter disappears", async () => {
    const dress = makeProduct({
      id: "p1",
      name: "Vestido Linho",
      category: "Vestidos",
      material: "Linho",
      is_on_sale: true,
      sale_price: 119.9,
      active: true,
    });
    const jeans = makeProduct({
      id: "p2",
      name: "Calça Jeans",
      category: "Calças",
      material: "Jeans",
      is_on_sale: false,
      sale_price: 0,
      active: true,
    });

    mockUseStore.mockReturnValue({
      data: makeStoreData([dress, jeans]),
      loading: false,
      error: null,
    });

    const { container, rerender, getByRole, queryByText } = render(<Storefront />);
    expect(getFilterPillTexts(container)).toEqual([
      "Todos",
      "Promoções",
      "Linho",
      "Jeans",
      "Vestidos",
      "Calças",
    ]);

    // Seleciona "Calças"
    fireEvent.click(getByRole("button", { name: "Calças" }));
    expect(queryByText("Calça Jeans")).not.toBeNull();
    expect(queryByText("Vestido Linho")).toBeNull();

    // Atualiza produtos removendo/desativando a única calça ativa
    mockUseStore.mockReturnValue({
      data: makeStoreData([dress, { ...jeans, active: false }]),
      loading: false,
      error: null,
    });

    rerender(<Storefront />);

    await waitFor(() => {
      expect(getFilterPillTexts(container)).toEqual(["Todos", "Promoções", "Linho", "Vestidos"]);
      // Voltou automaticamente para "Todos", exibindo o produto ativo restante
      expect(queryByText("Vestido Linho")).not.toBeNull();
    });
  });
});
