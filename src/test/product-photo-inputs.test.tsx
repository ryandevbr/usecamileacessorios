import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/normalize-image", () => ({
  normalizeImageFile: async (file: File) => file,
}));

vi.mock("@/services/aiProductService", () => ({
  analyzeProductWithAi: vi.fn(),
}));

vi.mock("@/services/storageService", () => ({
  uploadStoreImage: vi.fn(),
  deleteStoreImage: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { BatchImportDialog } from "@/components/batch-import-dialog";

describe("Product photo gallery and camera inputs", () => {
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

  it("renders separate Gallery (multiple) and Camera (capture=environment) inputs in BatchImportDialog and allows consecutive camera shots", async () => {
    render(
      <BatchImportDialog
        open={true}
        onOpenChange={() => {}}
        categoryNames={["Vestidos"]}
        materialNames={["Linho"]}
        saveProduct={vi.fn()}
        enableAiDemoPricing={false}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Ex.: 79.90"), { target: { value: "99.90" } });
    fireEvent.click(screen.getByRole("button", { name: /Próximo: Selecionar fotos/i }));

    expect(screen.getByRole("button", { name: /Galeria/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tirar Foto/i })).toBeInTheDocument();

    const galleryInput = screen.getByLabelText(/Escolher fotos da galeria/i) as HTMLInputElement;
    const cameraInput = screen.getByLabelText(/Tirar foto com a câmera/i) as HTMLInputElement;

    expect(galleryInput.multiple).toBe(true);
    expect(galleryInput.accept).toBe("image/*");
    expect(galleryInput.className).toContain("hidden");
    expect(galleryInput.getAttribute("capture")).toBeNull();
    expect(cameraInput.accept).toBe("image/*");
    expect(cameraInput.className).toContain("hidden");
    expect(cameraInput.getAttribute("capture")).toBe("environment");

    // 1st camera capture
    fireEvent.change(cameraInput, {
      target: { files: [new File(["1"], "frente.jpg", { type: "image/jpeg" })] },
    });
    expect(cameraInput.value).toBe("");

    await waitFor(() => {
      expect(screen.getByText(/1 foto selecionada/i)).toBeInTheDocument();
    });

    // 2nd consecutive camera capture
    fireEvent.change(cameraInput, {
      target: { files: [new File(["2"], "costas.jpg", { type: "image/jpeg" })] },
    });
    expect(cameraInput.value).toBe("");

    await waitFor(() => {
      expect(screen.getByText(/2 fotos selecionadas/i)).toBeInTheDocument();
    });

    // Plus gallery multi-select
    fireEvent.change(galleryInput, {
      target: {
        files: [
          new File(["3"], "detalhe.jpg", { type: "image/jpeg" }),
          new File(["4"], "extra.jpg", { type: "image/jpeg" }),
        ],
      },
    });
    expect(galleryInput.value).toBe("");

    await waitFor(() => {
      expect(screen.getByText(/4 fotos selecionadas/i)).toBeInTheDocument();
    });
  });
});
