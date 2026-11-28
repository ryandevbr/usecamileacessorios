import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/data/catalog";

const navigateMock = vi.fn();
const bulkUpdateMock = vi.fn();
const bulkDeleteMock = vi.fn();
const deleteProductMock = vi.fn();

const sampleProducts: Product[] = [
  {
    id: "p1",
    name: "Vestido Linho Natural",
    sku: "V01",
    category: "Vestidos",
    material: "Linho",
    price: 159.9,
    sale_price: 0,
    is_on_sale: false,
    sale_label: "",
    image_url: "https://example.supabase.co/storage/v1/object/public/store-media/products/p1.webp",
    description: "Elegante",
    active: true,
    featured: false,
    in_stock: true,
    characteristics: [],
    sizes: ["P", "M"],
  },
  {
    id: "p2",
    name: "Conjunto Alfaiataria",
    sku: "C02",
    category: "Conjuntos",
    material: "Alfaiataria",
    price: 189.9,
    sale_price: 0,
    is_on_sale: false,
    sale_label: "",
    image_url: "https://example.supabase.co/storage/v1/object/public/store-media/products/p2.webp",
    description: "Estruturado",
    active: true,
    featured: false,
    in_stock: false,
    characteristics: [],
    sizes: ["M", "G"],
  },
];

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/services/authService", () => ({
  WRONG_STORE_ACCOUNT_ERROR: "Esta conta administrativa pertence a outra loja.",
  getAuthState: async () => ({
    authenticated: true,
    email: "admin@loja.com",
    userId: "u1",
    mode: "demo",
  }),
  signOutAdmin: vi.fn(),
  subscribeAuthChanges: () => () => {},
}));

vi.mock("@/services/catalogOptionsService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/catalogOptionsService")>();
  return {
    ...actual,
    useCatalogOptions: () => ({
      options: [],
      categories: [],
      materials: [],
      categoryNames: ["Vestidos", "Conjuntos"],
      materialNames: ["Linho", "Alfaiataria"],
      loading: false,
      error: null,
      refresh: vi.fn(),
      addOption: vi.fn(),
      removeOption: vi.fn(),
      applyNicheDefaults: vi.fn(),
    }),
  };
});

const mockStoreData = {
  products: sampleProducts,
  coupons: [],
  banners: [],
  announcement: { active: false, text: "", link: "#vitrine" },
  promotion: {
    promo_active: false,
    promo_badge: "",
    promo_title: "",
    promo_description: "",
    promo_highlight: "",
    promo_cta_label: "",
    promo_cta_type: "vitrine" as const,
  },
  profile: { name: "Admin", email: "admin@loja.com", avatar: "" },
};

const mockStoreReturn = {
  data: mockStoreData,
  loading: false,
  error: null,
  isRemote: false,
  refresh: vi.fn(),
  update: vi.fn(),
  saveProduct: vi.fn(),
  toggleProductField: vi.fn(),
  duplicateProduct: vi.fn(),
  deleteProduct: deleteProductMock,
  bulkUpdateProducts: bulkUpdateMock,
  bulkDeleteProducts: bulkDeleteMock,
  saveBanner: vi.fn(),
  reorderBanners: vi.fn(),
  deleteBanner: vi.fn(),
  saveAnnouncement: vi.fn(),
  savePromotion: vi.fn(),
  saveCoupon: vi.fn(),
  deleteCoupon: vi.fn(),
  saveProfile: vi.fn(),
};

vi.mock("@/services/storeService", () => ({
  useStore: () => mockStoreReturn,
}));

import { AdminPanel } from "@/components/admin-panel";

describe("AdminPanel bulk selection and batch actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkUpdateMock.mockResolvedValue(undefined);
    bulkDeleteMock.mockResolvedValue(undefined);
  });

  it("supports selecting all visible products, bulk status updates, tab-change cleanup, and confirmed bulk delete", async () => {
    render(<AdminPanel />);

    await waitFor(() => {
      expect(screen.getByText("Vestido Linho Natural")).toBeInTheDocument();
    });

    // Barra de ações oculta inicialmente
    expect(
      screen.queryByRole("region", { name: /Ações em lote para produtos selecionados/i }),
    ).not.toBeInTheDocument();

    // Selecionar todos os visíveis (2)
    fireEvent.click(screen.getByLabelText("Selecionar todos"));

    const bar = screen.getByRole("region", { name: /Ações em lote para produtos selecionados/i });
    expect(within(bar).getByText("2 selecionado(s)")).toBeInTheDocument();

    // Ação em lote: Indisponível
    fireEvent.click(within(bar).getByRole("button", { name: "Indisponível" }));
    await waitFor(() => {
      expect(bulkUpdateMock).toHaveBeenCalledWith(["p1", "p2"], { in_stock: false });
    });

    // Seleção limpa após conclusão da ação
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: /Ações em lote para produtos selecionados/i }),
      ).not.toBeInTheDocument();
    });

    // Seleciona apenas 1 item e troca de aba -> deve limpar a seleção
    fireEvent.click(screen.getByLabelText("Selecionar Vestido Linho Natural"));
    expect(screen.getByText("1 selecionado(s)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Banners" }));
    fireEvent.click(screen.getByRole("button", { name: "Produtos" }));
    expect(
      screen.queryByRole("region", { name: /Ações em lote para produtos selecionados/i }),
    ).not.toBeInTheDocument();

    // Seleciona 2 itens e testa exclusão em lote com confirmação
    fireEvent.click(screen.getByLabelText("Selecionar todos"));
    const barAgain = screen.getByRole("region", {
      name: /Ações em lote para produtos selecionados/i,
    });
    fireEvent.click(within(barAgain).getByRole("button", { name: "Excluir" }));

    expect(
      screen.getByText(
        /Tem certeza que deseja excluir 2 produto\(s\) selecionado\(s\)\? Essa ação não pode ser desfeita\./i,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Excluir \(2\)/i }));
    await waitFor(() => {
      expect(bulkDeleteMock).toHaveBeenCalledWith(["p1", "p2"]);
    });
  });
});
