const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const HEIC_EXTENSION_RE = /\.(heic|heif)$/i;

let heicConversionQueue: Promise<unknown> = Promise.resolve();

function enqueueHeicConversion<T>(task: () => Promise<T>): Promise<T> {
  const next = heicConversionQueue.then(task, task);
  heicConversionQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function replaceExtensionWithJpg(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) return "imagem.jpg";
  if (HEIC_EXTENSION_RE.test(trimmed)) {
    return trimmed.replace(HEIC_EXTENSION_RE, ".jpg");
  }
  const dotIdx = trimmed.lastIndexOf(".");
  if (dotIdx > 0) {
    return `${trimmed.slice(0, dotIdx)}.jpg`;
  }
  return `${trimmed}.jpg`;
}

export function isHeicFile(file: File): boolean {
  const mime = file.type.trim().toLowerCase();
  if (mime && HEIC_MIME_TYPES.has(mime)) {
    return true;
  }
  return HEIC_EXTENSION_RE.test(file.name.trim());
}

async function tryNativeHeicToJpeg(file: File): Promise<File | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return null;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, bitmap.width);
    canvas.height = Math.max(1, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.92);
    });
    if (!blob) return null;

    return new File([blob], replaceExtensionWithJpg(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified || Date.now(),
    });
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

export async function normalizeImageFile(file: File): Promise<File> {
  if (!isHeicFile(file)) {
    return file;
  }

  const nativeConverted = await tryNativeHeicToJpeg(file);
  if (nativeConverted) {
    return nativeConverted;
  }

  return enqueueHeicConversion(async () => {
    try {
      const { heicTo } = await import("heic-to");
      const blob = await heicTo({
        blob: file,
        type: "image/jpeg",
        quality: 0.9,
      });
      return new File([blob], replaceExtensionWithJpg(file.name), {
        type: "image/jpeg",
        lastModified: file.lastModified || Date.now(),
      });
    } catch (err) {
      const reason = err instanceof Error && err.message ? ` (${err.message})` : "";
      throw new Error(`Não foi possível converter a imagem HEIC "${file.name}" para JPG.${reason}`);
    }
  });
}
