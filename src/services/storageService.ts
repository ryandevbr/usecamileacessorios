import { ACTIVE_STORE_SLUG } from "@/config/store.config";
import { STORE_MEDIA_BUCKET, isSupabaseConfigured, supabase } from "@/lib/supabase";
import { compressImage } from "@/utils/imageCompressor";

export { STORE_MEDIA_BUCKET };

export type MediaFolder = "products" | "banners" | "profiles";

export interface UploadedStoreImage {
  url: string;
  original: number;
  compressed: number;
  wasCompressed: boolean;
}

export const MAX_BANNER_IMAGE_BYTES = 15 * 1024 * 1024;

const PUBLIC_BUCKET_SEGMENT = `/storage/v1/object/public/${STORE_MEDIA_BUCKET}/`;
const LEGACY_FOLDER_PREFIX_RE = /^(products|banners|profiles)\//;

export function buildStoreMediaPath(
  folder: MediaFolder,
  fileName: string,
  storeSlug: string = ACTIVE_STORE_SLUG,
): string {
  const cleanSlug = storeSlug.trim().toLowerCase() || ACTIVE_STORE_SLUG;
  return `${cleanSlug}/${folder}/${fileName}`;
}

export function isStoreMediaPathOwned(
  storagePath: string,
  storeSlug: string = ACTIVE_STORE_SLUG,
): boolean {
  const cleanSlug = storeSlug.trim().toLowerCase() || ACTIVE_STORE_SLUG;
  return storagePath.startsWith(`${cleanSlug}/`) || LEGACY_FOLDER_PREFIX_RE.test(storagePath);
}

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

function resolveOriginalExtension(file: File): string {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(file.name.trim())?.[1]?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) {
    return fromName;
  }
  const mime = file.type.trim().toLowerCase();
  return MIME_TO_EXT[mime] ?? "jpg";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Falha ao ler o arquivo de imagem."));
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo de imagem."));
    reader.readAsDataURL(file);
  });
}

export function extractStoragePath(imageUrl: string): string | null {
  if (!imageUrl || imageUrl.startsWith("data:")) return null;
  const idx = imageUrl.indexOf(PUBLIC_BUCKET_SEGMENT);
  if (idx === -1) return null;
  const rawPath = imageUrl.slice(idx + PUBLIC_BUCKET_SEGMENT.length).split(/[?#]/)[0] ?? "";
  if (!rawPath) return null;
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return rawPath;
  }
}

export async function uploadOriginalBannerImage(file: File): Promise<UploadedStoreImage> {
  if (file.type && !file.type.startsWith("image/")) {
    throw new Error("Selecione um arquivo de imagem válido (JPG, PNG, WebP ou AVIF).");
  }

  if (file.size > MAX_BANNER_IMAGE_BYTES) {
    throw new Error(
      "A imagem do banner ultrapassa o limite de 15 MB. Escolha um arquivo menor para enviar.",
    );
  }

  if (!isSupabaseConfigured || !supabase) {
    const dataUrl = await readFileAsDataUrl(file);
    return {
      url: dataUrl,
      original: file.size,
      compressed: file.size,
      wasCompressed: false,
    };
  }

  const ext = resolveOriginalExtension(file);
  const filePath = buildStoreMediaPath("banners", `${crypto.randomUUID()}.${ext}`);
  const { error: uploadError } = await supabase.storage
    .from(STORE_MEDIA_BUCKET)
    .upload(filePath, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "31536000",
      upsert: false,
    });

  if (uploadError) {
    const msg = uploadError.message.toLowerCase();
    if (
      msg.includes("maximum allowed size") ||
      msg.includes("payload too large") ||
      msg.includes("size")
    ) {
      throw new Error(
        "A imagem excede o limite de tamanho do bucket no Supabase Storage. Reduza o arquivo ou ajuste o limite do bucket 'store-media' para 15 MB.",
      );
    }
    throw new Error(`Falha ao enviar o banner para o Storage: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(STORE_MEDIA_BUCKET).getPublicUrl(filePath);
  return {
    url: data.publicUrl,
    original: file.size,
    compressed: file.size,
    wasCompressed: false,
  };
}

export async function uploadStoreImage(
  file: File,
  folder: MediaFolder,
): Promise<UploadedStoreImage> {
  if (folder === "banners") {
    return uploadOriginalBannerImage(file);
  }

  const compressed = await compressImage(file);

  if (!isSupabaseConfigured || !supabase) {
    return {
      url: compressed.url,
      original: compressed.original,
      compressed: compressed.compressed,
      wasCompressed: true,
    };
  }

  const filePath = buildStoreMediaPath(folder, `${crypto.randomUUID()}.webp`);
  const { error: uploadError } = await supabase.storage
    .from(STORE_MEDIA_BUCKET)
    .upload(filePath, compressed.blob, {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Falha ao enviar a imagem para o Storage: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(STORE_MEDIA_BUCKET).getPublicUrl(filePath);
  return {
    url: data.publicUrl,
    original: compressed.original,
    compressed: compressed.compressed,
    wasCompressed: true,
  };
}

export async function deleteStoreImage(imageUrl: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase || !imageUrl) return;
  const storagePath = extractStoragePath(imageUrl);
  if (!storagePath || !isStoreMediaPathOwned(storagePath)) return;

  const { error } = await supabase.storage.from(STORE_MEDIA_BUCKET).remove([storagePath]);
  if (error) {
    console.warn("Não foi possível remover a imagem antiga do Storage:", error.message);
  }
}

export async function deleteStoreImages(imageUrls: string[]): Promise<void> {
  if (!isSupabaseConfigured || !supabase || imageUrls.length === 0) return;
  const uniquePaths = Array.from(
    new Set(
      imageUrls
        .map((url) => extractStoragePath(url))
        .filter((path): path is string => path !== null && path !== "" && isStoreMediaPathOwned(path)),
    ),
  );
  if (uniquePaths.length === 0) return;

  const { error } = await supabase.storage.from(STORE_MEDIA_BUCKET).remove(uniquePaths);
  if (error) {
    console.warn("Não foi possível remover imagens antigas do Storage:", error.message);
  }
}
