import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const analyzeMock = vi.fn();
const uploadMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("@/lib/normalize-image", () => ({
  normalizeImageFile: async (file: File) => file,
}));

vi.mock("@/services/aiProductService", () => ({
  analyzeProductWithAi: (...args: unknown[]) => analyzeMock(...args),
}));

vi.mock("@/services/storageService", () => ({
  uploadStoreImage: (...args: unknown[]) => uploadMock(...args),
  deleteStoreImage: (...args: unknown[]) => deleteMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { BatchImportDialog } from "@/components/batch-import-dialog";
import {
  BATCH_RETRY_ROUNDS,
  buildDemoPromoPricing,
  formatRetryCountdownMessage,
  toCommercialPrice,
} from "@/lib/batch-retry";
import type { Product } from "@/data/catalog";

describe("BatchImportDialog smart auto-retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (!URL.createObjectURL) {
      Object.defineProperty(URL, "createObjectURL", {
        value: vi.fn(() => "blob:mock-preview"),
        writable: true,
      });
    } else {
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-preview");
    }
    if (!URL.revokeObjectURL) {
      Object.defineProperty(URL, "revokeObjectURL", {
        value: vi.fn(),
        writable: true,
      });
    } else {
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    }
  });

  it("defines the exact 3-attempt schedule (800ms -> 5s/1200ms -> 8s/1500ms) and messages", () => {
    expect(BATCH_RETRY_ROUNDS).toEqual([
      { attempt: 1, maxAttempts: 3, waitSecondsBeforeRound: 0, itemDelayMs: 800 },
      { attempt: 2, maxAttempts: 3, waitSecondsBeforeRound: 5, itemDelayMs: 1200 },
      { attempt: 3, maxAttempts: 3, waitSecondsBeforeRound: 8, itemDelayMs: 1500 },
    ]);

    expect(
      formatRetryCountdownMessage({
        nextAttempt: 2,
        maxAttempts: 3,
        secondsLeft: 5,
        failedCount: 2,
      }),
    ).toBe(
      "A IA estava ocupada em 2 foto(s). Aguardando 5s para tentar novamente automaticamente...",
    );

    expect(
      formatRetryCountdownMessage({
        nextAttempt: 3,
        maxAttempts: 3,
        secondsLeft: 8,
        failedCount: 1,
      }),
    ).toBe("Aguardando 8s para última tentativa automática em 1 foto(s)...");
  });

  it("automatically retries failed items across rounds 2 and 3 without duplicating published items and reuses uploaded image", async () => {
    const savedProducts: Product[] = [];
    const saveProductMock = vi.fn(async (product: Product) => {
      // Simulate transient save failure on photo-2 first attempt (after upload already succeeded)
      if (product.name === "Peça 2" && saveProductMock.mock.calls.length === 2) {
        throw new Error("Timeout temporário no banco");
      }
      savedProducts.push(product);
    });

    const aiAttempts: Record<string, number> = {};
    analyzeMock.mockImplementation(async ({ file }: { file: File }) => {
      aiAttempts[file.name] = (aiAttempts[file.name] ?? 0) + 1;
      const attempt = aiAttempts[file.name] ?? 1;

      if (file.name === "foto-1.jpg") {
        return {
          name: "Peça 1",
          category: "Vestidos",
          material: "Linho",
          description: "Descrição 1",
          characteristics: [],
        };
      }
      if (file.name === "foto-2.jpg") {
        return {
          name: "Peça 2",
          category: "Vestidos",
          material: "Linho",
          description: "Descrição 2",
          characteristics: [],
        };
      }
      // foto-3 fails on attempt 1 and 2, succeeds on attempt 3
      if (file.name === "foto-3.jpg" && attempt < 3) {
        throw new Error("A IA está sobrecarregada no momento.");
      }
      return {
        name: "Peça 3",
        category: "Vestidos",
        material: "Crepe",
        description: "Descrição 3",
        characteristics: [],
      };
    });

    uploadMock.mockImplementation(async (file: File) => ({
      url: `https://storage.example/products/${file.name}`,
      original: 1000,
      compressed: 500,
      wasCompressed: true,
    }));

    render(
      <BatchImportDialog
        open={true}
        onOpenChange={() => {}}
        categoryNames={["Vestidos"]}
        materialNames={["Linho", "Crepe"]}
        saveProduct={saveProductMock}
        timingScale={0}
        enableAiDemoPricing={false}
      />,
    );

    expect(screen.queryByText(/Modo Prévia \(Demonstração\)/i)).not.toBeInTheDocument();

    // Step 1: set price and advance
    fireEvent.change(screen.getByPlaceholderText("Ex.: 79.90"), { target: { value: "129.90" } });
    fireEvent.click(screen.getByRole("button", { name: /Próximo: Selecionar fotos/i }));

    // Step 2: add 3 files (Radix Dialog renders inside a portal on document.body)
    const fileInput = screen.getByLabelText(/Escolher fotos/i) as HTMLInputElement;
    const files = [
      new File(["a"], "foto-1.jpg", { type: "image/jpeg" }),
      new File(["b"], "foto-2.jpg", { type: "image/jpeg" }),
      new File(["c"], "foto-3.jpg", { type: "image/jpeg" }),
    ];
    fireEvent.change(fileInput, { target: { files } });

    await waitFor(() => {
      expect(screen.getByText(/3 fotos selecionadas/i)).toBeInTheDocument();
    });

    // Step 3: start batch
    fireEvent.click(screen.getByRole("button", { name: /Iniciar importação \(3\)/i }));

    await waitFor(() => {
      expect(screen.getByText(/Processamento finalizado \(3 de 3 publicados\)/i)).toBeInTheDocument();
    });

    // foto-1 published once (never duplicated)
    expect(aiAttempts["foto-1.jpg"]).toBe(1);
    // foto-2 failed save on attempt 1, succeeded on attempt 2, AND reused its already-uploaded image!
    expect(aiAttempts["foto-2.jpg"]).toBe(2);
    expect(uploadMock.mock.calls.filter(([f]) => (f as File).name === "foto-2.jpg")).toHaveLength(1);
    // foto-3 succeeded on attempt 3
    expect(aiAttempts["foto-3.jpg"]).toBe(3);

    expect(savedProducts.map((p) => p.name)).toEqual(["Peça 1", "Peça 2", "Peça 3"]);
    expect(screen.queryByRole("button", { name: /Reprocessar falhas/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Concluir" })).toBeEnabled();
  });

  it("shows manual Reprocessar falhas button only after all 3 automatic attempts fail", async () => {
    analyzeMock.mockRejectedValue(new Error("API indisponível"));
    const saveProductMock = vi.fn();

    render(
      <BatchImportDialog
        open={true}
        onOpenChange={() => {}}
        categoryNames={["Vestidos"]}
        materialNames={["Linho"]}
        saveProduct={saveProductMock}
        timingScale={0}
        enableAiDemoPricing={false}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Ex.: 79.90"), { target: { value: "89.90" } });
    fireEvent.click(screen.getByRole("button", { name: /Próximo: Selecionar fotos/i }));

    const fileInput = screen.getByLabelText(/Escolher fotos/i) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["x"], "falha.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => {
      expect(screen.getByText(/1 foto selecionada/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Iniciar importação \(1\)/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Reprocessar falhas \(1\)/i })).toBeInTheDocument();
    });

    expect(analyzeMock).toHaveBeenCalledTimes(3);
    expect(saveProductMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Concluir" })).toBeEnabled();
  });

  it("normalizes commercial .90 prices and simulates ~25% promo in Modo Prévia", async () => {
    expect(toCommercialPrice(134.37)).toBe(134.9);
    expect(toCommercialPrice(12)).toBe(19.9);
    expect(toCommercialPrice(Number.NaN)).toBe(19.9);

    const promoAt1 = buildDemoPromoPricing(159.9, 1);
    expect(promoAt1.is_on_sale).toBe(true);
    expect(promoAt1.sale_price).toBeLessThan(159.9);
    expect(promoAt1.sale_price.toFixed(2).endsWith(".90")).toBe(true);
    expect(buildDemoPromoPricing(159.9, 0).is_on_sale).toBe(false);

    const savedProducts: Product[] = [];
    const saveProductMock = vi.fn(async (product: Product) => {
      savedProducts.push(product);
    });

    const estimates: Record<string, number | null> = {
      "p1.jpg": 134.37,
      "p2.jpg": 179.9,
      "p3.jpg": 89.45,
      "p4.jpg": null, // tests fallback when AI omits estimate
    };

    analyzeMock.mockImplementation(async ({ file }: { file: File }) => ({
      name: `Item ${file.name}`,
      category: "Vestidos",
      material: "Linho",
      description: "Descrição",
      characteristics: [],
      estimatedPrice: estimates[file.name] ?? null,
    }));

    uploadMock.mockImplementation(async (file: File) => ({
      url: `https://storage.example/products/${file.name}`,
      original: 1000,
      compressed: 500,
      wasCompressed: true,
    }));

    render(
      <BatchImportDialog
        open={true}
        onOpenChange={() => {}}
        categoryNames={["Vestidos"]}
        materialNames={["Linho"]}
        saveProduct={saveProductMock}
        timingScale={0}
        enableAiDemoPricing={true}
      />,
    );

    expect(screen.getByText(/Modo Prévia \(Demonstração\)/i)).toBeInTheDocument();

    // Advance without entering any batch price (optional when AI pricing is active)
    const nextBtn = screen.getByRole("button", { name: /Próximo: Selecionar fotos/i });
    expect(nextBtn).toBeEnabled();
    fireEvent.click(nextBtn);

    const fileInput = screen.getByLabelText(/Escolher fotos/i) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["1"], "p1.jpg", { type: "image/jpeg" }),
          new File(["2"], "p2.jpg", { type: "image/jpeg" }),
          new File(["3"], "p3.jpg", { type: "image/jpeg" }),
          new File(["4"], "p4.jpg", { type: "image/jpeg" }),
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/4 fotos selecionadas/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Iniciar importação \(4\)/i }));

    await waitFor(() => {
      expect(screen.getByText(/Processamento finalizado \(4 de 4 publicados\)/i)).toBeInTheDocument();
    });

    expect(analyzeMock).toHaveBeenCalledWith(expect.objectContaining({ estimatePrice: true }));
    expect(savedProducts).toHaveLength(4);
    expect(savedProducts[0]?.price).toBe(134.9);
    expect(savedProducts[1]?.price).toBe(179.9);
    expect(savedProducts[2]?.price).toBe(89.9);
    expect(savedProducts[3]?.price.toFixed(2).endsWith(".90")).toBe(true);

    const onSale = savedProducts.filter((p) => p.is_on_sale);
    expect(onSale).toHaveLength(1);
    expect(onSale[0]?.sale_price).toBeLessThan(onSale[0]?.price ?? 0);
    expect(onSale[0]?.sale_price.toFixed(2).endsWith(".90")).toBe(true);
  });
});
