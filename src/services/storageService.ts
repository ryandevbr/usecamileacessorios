import { STORE_MEDIA_BUCKET, isSupabaseConfigured, supabase } from "@/lib/supabase";
import { compressImage } from "@/utils/imageCompressor";

export { STORE_MEDIA_BUCKET };

export type MediaFolder = "products" | "banners" | "profiles";

export interface UploadedStoreImage {
  url: string;
  original: number;
  compressed: number;
}

const PUBLIC_BUCKET_SEGMENT = `/storage/v1/object/public/${STORE_MEDIA_BUCKET}/`;

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

export async function uploadStoreImage(
  file: File,
  folder: MediaFolder,
): Promise<UploadedStoreImage> {
  const compressed = await compressImage(file);

  if (!isSupabaseConfigured || !supabase) {
    return {
      url: compressed.url,
      original: compressed.original,
      compressed: compressed.compressed,
    };
  }

  const filePath = `${folder}/${crypto.randomUUID()}.webp`;
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
  };
}

export async function deleteStoreImage(imageUrl: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase || !imageUrl) return;
  const storagePath = extractStoragePath(imageUrl);
  if (!storagePath) return;

  const { error } = await supabase.storage.from(STORE_MEDIA_BUCKET).remove([storagePath]);
  if (error) {
    console.warn("Não foi possível remover a imagem antiga do Storage:", error.message);
  }
}
