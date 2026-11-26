import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchImportDialog } from "@/components/batch-import-dialog";
import type { Product } from "@/data/catalog";

const analyzeMock = vi.fn();
const uploadMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("@/services/aiProductService", () => ({
  analyzeProductWithAi: (...args: unknown[]) => analyzeMock(...args),
}));

vi.mock("@/services/storageService", () => ({
  uploadStoreImage: (...args: unknown[]) => uploadMock(...args),
  deleteStoreImage: (...args: unknown[]) => deleteMock(...args),
}));

vi.mock("@/lib/normalize-image", () => ({
  normalizeImageFile: async (file: File) => file,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe("BatchImportDialog — auto-retry em rodadas", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    analyzeMock.mockReset();
    uploadMock.mockReset();
    deleteMock.mockReset();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reprocessa automaticamente fotos com falha após 5s (2/3) e 8s (3/3) sem duplicar itens publicados", async () => {
    const savedProducts: Product[] = [];
    const saveProduct = vi.fn(async (product: Product) => {
      savedProducts.push(product);
    });

    const f1 = new File(["img1"], "brinco-1.jpg", { type: "image/jpeg" });
    const f2 = new File(["img2"], "colar-2.jpg", { type: "image/jpeg" });

    let f2Attempts = 0;
    analyzeMock.mockImplementation(async ({ file }: { file: File }) => {
      if (file.name === "brinco-1.jpg") {
        return {
          name: "Brinco Dourado",
          category: "Brincos",
          material: "Semijoia",
          description: "Delicado.",
          characteristics: [],
        };
      }
      f2Attempts += 1;
      if (f2Attempts < 3) {
        throw new Error("A IA está sobrecarregada no momento.");
      }
      return {
        name: "Colar Prata",
        category: "Colares",
        material: "Prata 925",
        description: "Brilho sutil.",
        characteristics: [],
      };
    });

    uploadMock.mockImplementation(async (file: File) => ({
      url: `https://storage.example/${file.name}.webp`,
      original: 1000,
      compressed: 400,
      wasCompressed: true,
    }));

    render(
      <BatchImportDialog
        open
        onOpenChange={vi.fn()}
        categoryNames={["Brincos", "Colares"]}
        materialNames={["Semijoia", "Prata 925"]}
        saveProduct={saveProduct}
      />,
    );

    // Etapa 1: preço do lote
    const priceInput = screen.getByPlaceholderText("Ex.: 79.90");
    fireEvent.change(priceInput, { target: { value: "89.90" } });
    fireEvent.click(screen.getByRole("button", { name: /Próximo: Selecionar fotos/i }));

    // Etapa 2: selecionar 2 fotos
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [f1, f2] } });
      await Promise.resolve();
    });

    // Etapa 3: iniciar importação
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Iniciar importação \(2\)/i }));
      await Promise.resolve();
    });

    // Avança o intervalo inicial de 800ms entre f1 e f2
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    // Deve entrar na contagem regressiva de 5s para a rodada automática 1 (2/3)
    expect(
      screen.getByText(
        /A IA estava ocupada em 1 foto\(s\)\. Aguardando \ds para tentar novamente automaticamente/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Processando lote..." })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Reprocessar falhas/i })).not.toBeInTheDocument();

    // Avança 5s para executar a tentativa 2/3 (que falha novamente)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5200);
    });

    // Deve entrar na contagem regressiva de 8s para a rodada automática 2 (3/3)
    expect(
      screen.getByText(/Aguardando \ds para última tentativa automática em 1 foto\(s\)/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Processando lote..." })).toBeDisabled();

    // Avança 8s para executar a tentativa 3/3 (que agora funciona!)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8500);
    });

    expect(screen.getByRole("button", { name: "Concluir" })).toBeEnabled();
    expect(savedProducts.map((p) => p.name)).toEqual(["Brinco Dourado", "Colar Prata"]);
    expect(saveProduct).toHaveBeenCalledTimes(2);
    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(f2Attempts).toBe(3);
  });

  it("reutiliza a imagem já enviada ao store-media se falhar apenas ao salvar no banco e libera botão manual após 3 tentativas", async () => {
    let saveCalls = 0;
    const saveProduct = vi.fn(async () => {
      saveCalls += 1;
      if (saveCalls <= 3) {
        throw new Error("Erro temporário no Supabase");
      }
    });

    const f1 = new File(["img1"], "anel-1.jpg", { type: "image/jpeg" });

    analyzeMock.mockResolvedValue({
      name: "Anel Solitário",
      category: "Anéis",
      material: "Prata 925",
      description: "Elegante.",
      characteristics: [],
    });

    uploadMock.mockResolvedValue({
      url: "https://storage.example/anel-1.webp",
      original: 1000,
      compressed: 350,
      wasCompressed: true,
    });

    render(
      <BatchImportDialog
        open
        onOpenChange={vi.fn()}
        categoryNames={["Anéis"]}
        materialNames={["Prata 925"]}
        saveProduct={saveProduct}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Ex.: 79.90"), { target: { value: "99.90" } });
    fireEvent.click(screen.getByRole("button", { name: /Próximo: Selecionar fotos/i }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [f1] } });
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Iniciar importação \(1\)/i }));
      await vi.advanceTimersByTimeAsync(15000);
    });

    // Após as 3 tentativas automáticas falharem, o botão manual deve estar liberado
    expect(screen.getByRole("button", { name: /Reprocessar falhas \(1\)/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Concluir" })).toBeEnabled();
    // Upload ocorreu apenas 1 vez e foi reutilizado nas tentativas 2 e 3
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(analyzeMock).toHaveBeenCalledTimes(3);
    expect(saveProduct).toHaveBeenCalledTimes(3);

    // Clique manual no fallback agora conclui com sucesso sem reenviar a imagem
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Reprocessar falhas \(1\)/i }));
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(saveProduct).toHaveBeenCalledTimes(4);
    expect(screen.getByText("Publicado ✓")).toBeInTheDocument();
  });
});
