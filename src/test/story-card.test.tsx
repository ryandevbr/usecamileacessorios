import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/data/catalog";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import {
  cleanDisplayStoreUrl,
  formatBrlPrice,
  generateProductStoryCard,
} from "@/utils/generateStoryCard";
import { StoryCardModal } from "@/components/admin/StoryCardModal";

const SAMPLE_PRODUCT: Product = {
  id: "prod-story-1",
  name: "Colar Veneziana Ponto de Luz",
  sku: "COL-001",
  category: "Colares",
  material: "Prata 925",
  price: 129.9,
  sale_price: 99.9,
  is_on_sale: true,
  sale_label: "OFERTA",
  image_url: "https://example.com/colar.webp",
  description: "Colar delicado em prata 925.",
  active: true,
  featured: true,
  in_stock: true,
  characteristics: [],
  sizes: [],
};

function createMockCanvasContext() {
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 16 })),
  };
}

describe("Story Card 9:16 generator and modal", () => {
  let mockCtx: ReturnType<typeof createMockCanvasContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = createMockCanvasContext();

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      mockCtx as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,iVBORw0KGgo=",
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => {
      cb(new Blob(["png"], { type: "image/png" }));
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network disabled in test")),
    );

    vi.stubGlobal(
      "Image",
      class MockImage {
        crossOrigin = "";
        naturalWidth = 800;
        naturalHeight = 1000;
        width = 800;
        height = 1000;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_v: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );

    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:mock-story"),
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      writable: true,
    });
  });

  it("cleans store URL and formats BRL price", () => {
    expect(cleanDisplayStoreUrl("https://usecamile.vercel.app///")).toBe("usecamile.vercel.app");
    expect(cleanDisplayStoreUrl("http://minhaloja.com.br/")).toBe("minhaloja.com.br");
    expect(formatBrlPrice(89.9)).toMatch(/89,90/);
  });

  it("generates a 1080x1920 PNG story card with OFERTA badge and hides price when showPrice is false", async () => {
    const withPrice = await generateProductStoryCard({
      productName: SAMPLE_PRODUCT.name,
      price: 99.9,
      originalPrice: 129.9,
      category: "Colares",
      imageUrl: SAMPLE_PRODUCT.image_url,
      storeName: "Use Camile",
      storeUrl: "https://usecamile.vercel.app/",
      showPrice: true,
    });

    expect(withPrice.dataUrl).toContain("data:image/png;base64");
    expect(withPrice.blob).toBeInstanceOf(Blob);
    expect(withPrice.filename).toBe("story-colar-veneziana-ponto-de-luz.png");

    const drawnTextsWithPrice = mockCtx.fillText.mock.calls.map((c) => String(c[0]));
    expect(drawnTextsWithPrice).toContain("OFERTA");
    expect(drawnTextsWithPrice.some((t) => t.includes("99,90"))).toBe(true);
    expect(drawnTextsWithPrice.some((t) => t.includes("129,90"))).toBe(true);
    expect(drawnTextsWithPrice).toContain("usecamile.vercel.app");

    mockCtx.fillText.mockClear();

    await generateProductStoryCard({
      productName: SAMPLE_PRODUCT.name,
      price: 99.9,
      originalPrice: 129.9,
      category: "Colares",
      imageUrl: SAMPLE_PRODUCT.image_url,
      storeName: "Use Camile",
      storeUrl: "usecamile.vercel.app",
      showPrice: false,
    });

    const drawnTextsNoPrice = mockCtx.fillText.mock.calls.map((c) => String(c[0]));
    expect(drawnTextsNoPrice).not.toContain("OFERTA");
    expect(drawnTextsNoPrice.some((t) => t.includes("99,90"))).toBe(false);
  });

  it("renders StoryCardModal, regenerates on price toggle, and invokes navigator.share when supported", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    const canShareMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "share", { value: shareMock, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: canShareMock, configurable: true });

    render(
      <StoryCardModal
        open={true}
        product={SAMPLE_PRODUCT}
        storeName="Use Camile"
        storeUrl="usecamile.vercel.app"
        onClose={vi.fn()}
      />,
    );

    const previewImg = await screen.findByAltText(/Card para Stories de Colar Veneziana/i);
    expect(previewImg).toBeInTheDocument();

    const initialCalls = mockCtx.fillRect.mock.calls.length;
    fireEvent.click(screen.getByRole("switch", { name: /Mostrar preço na arte/i }));

    await waitFor(() => {
      expect(mockCtx.fillRect.mock.calls.length).toBeGreaterThan(initialCalls);
    });

    fireEvent.click(screen.getByRole("button", { name: /Compartilhar nos Stories/i }));
    await waitFor(() => {
      expect(canShareMock).toHaveBeenCalled();
      expect(shareMock).toHaveBeenCalledTimes(1);
    });
  });
});
