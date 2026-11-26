import { afterEach, describe, expect, it, vi } from "vitest";
import { isHeicFile, normalizeImageFile } from "@/lib/normalize-image";

const heicToMock = vi.fn();

vi.mock("heic-to", () => ({
  heicTo: (...args: unknown[]) => heicToMock(...args),
}));

afterEach(() => {
  heicToMock.mockReset();
  vi.unstubAllGlobals();
});

describe("normalizeImageFile", () => {
  it("detecta arquivos HEIC e HEIF por extensão ou MIME", () => {
    expect(isHeicFile(new File(["x"], "IMG_1234.HEIC", { type: "" }))).toBe(true);
    expect(isHeicFile(new File(["x"], "foto.heif", { type: "" }))).toBe(true);
    expect(isHeicFile(new File(["x"], "foto.bin", { type: "image/heic" }))).toBe(true);
    expect(isHeicFile(new File(["x"], "foto.jpg", { type: "image/jpeg" }))).toBe(false);
    expect(isHeicFile(new File(["x"], "banner.png", { type: "image/png" }))).toBe(false);
  });

  it("retorna imediatamente arquivos que não são HEIC/HEIF sem modificar", async () => {
    const original = new File(["jpg-bytes"], "peca.jpg", { type: "image/jpeg" });
    const result = await normalizeImageFile(original);
    expect(result).toBe(original);
    expect(heicToMock).not.toHaveBeenCalled();
  });

  it("usa heic-to em fila sequencial quando decodificação nativa falha", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("unsupported")));

    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    heicToMock
      .mockImplementationOnce(async ({ blob }: { blob: File }) => {
        order.push(`start:${blob.name}`);
        await firstGate;
        order.push(`end:${blob.name}`);
        return new Blob(["jpeg-1"], { type: "image/jpeg" });
      })
      .mockImplementationOnce(async ({ blob }: { blob: File }) => {
        order.push(`start:${blob.name}`);
        order.push(`end:${blob.name}`);
        return new Blob(["jpeg-2"], { type: "image/jpeg" });
      });

    const f1 = new File(["a"], "foto1.HEIC", { type: "image/heic" });
    const f2 = new File(["b"], "foto2.heif", { type: "image/heif" });

    const p1 = normalizeImageFile(f1);
    const p2 = normalizeImageFile(f2);

    await Promise.resolve();
    await Promise.resolve();
    releaseFirst();

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(order).toEqual([
      "start:foto1.HEIC",
      "end:foto1.HEIC",
      "start:foto2.heif",
      "end:foto2.heif",
    ]);
    expect(r1.name).toBe("foto1.jpg");
    expect(r1.type).toBe("image/jpeg");
    expect(r2.name).toBe("foto2.jpg");
    expect(r2.type).toBe("image/jpeg");
    expect(heicToMock).toHaveBeenNthCalledWith(1, {
      blob: f1,
      type: "image/jpeg",
      quality: 0.9,
    });
  });
});
