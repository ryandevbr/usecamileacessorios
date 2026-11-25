export interface CompressedImage {
  blob: Blob;
  url: string;
  original: number;
  compressed: number;
}

export interface CompressImageOptions {
  maxDimension?: number;
  quality?: number;
}

export async function compressImage(
  file: File,
  options?: CompressImageOptions,
): Promise<CompressedImage> {
  const maxDimension = options?.maxDimension ?? 1200;
  const quality = options?.quality ?? 0.82;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível preparar a foto.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Falha ao comprimir a foto."))),
      "image/webp",
      quality,
    ),
  );
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Falha na leitura"));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return { blob, url, original: file.size, compressed: blob.size };
}

export async function compressImageForAi(
  file: File,
): Promise<{ base64: string; mimeType: string }> {
  const result = await compressImage(file, { maxDimension: 800, quality: 0.78 });
  const commaIdx = result.url.indexOf(",");
  const base64 = commaIdx >= 0 ? result.url.slice(commaIdx + 1) : result.url;
  return {
    base64,
    mimeType: "image/webp",
  };
}
