import { getAccessToken } from "@/services/authService";
import { compressImageForAi } from "@/utils/imageCompressor";

export interface AiProductCharacteristic {
  label: string;
  value: string;
}

export interface AiProductAnalysis {
  name: string;
  category: string;
  material: string;
  description: string;
  characteristics: AiProductCharacteristic[];
}

export interface AnalyzeProductParams {
  file?: File | null;
  imageUrl?: string;
  availableCategories: string[];
  availableMaterials: string[];
}

interface AnalyzeApiResponse {
  data?: AiProductAnalysis;
  error?: string;
  code?: string;
}

function parseDataUrl(url: string): { base64: string; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(url.trim());
  if (!match) return null;
  const mimeType = match[1]?.trim().toLowerCase() ?? "";
  const base64 = match[2]?.trim() ?? "";
  if (!mimeType || !base64) return null;
  return { base64, mimeType };
}

export function isAnalyzableImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("data:image/")) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export async function analyzeProductWithAi(
  params: AnalyzeProductParams,
): Promise<AiProductAnalysis> {
  const payload: {
    imageBase64?: string;
    mimeType?: string;
    imageUrl?: string;
    availableCategories: string[];
    availableMaterials: string[];
  } = {
    availableCategories: params.availableCategories,
    availableMaterials: params.availableMaterials,
  };

  if (params.file) {
    const compressed = await compressImageForAi(params.file);
    payload.imageBase64 = compressed.base64;
    payload.mimeType = compressed.mimeType;
  } else if (params.imageUrl) {
    const dataUrl = parseDataUrl(params.imageUrl);
    if (dataUrl) {
      payload.imageBase64 = dataUrl.base64;
      payload.mimeType = dataUrl.mimeType;
    } else {
      payload.imageUrl = params.imageUrl.trim();
    }
  } else {
    throw new Error("Envie uma foto ou informe uma URL válida antes de analisar.");
  }

  const token = await getAccessToken();
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) {
    headers["authorization"] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch("/api/analyze-product", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(
      "Falha de conexão ao consultar a IA. Verifique sua internet e tente novamente.",
    );
  }

  const result = (await response.json().catch(() => ({}))) as AnalyzeApiResponse;

  if (!response.ok || !result.data) {
    if (response.status === 429 || result.code === "RATE_LIMIT") {
      throw new Error(
        "Limite momentâneo da IA atingido. Aguarde alguns segundos e tente novamente.",
      );
    }
    if (result.code === "GEMINI_NOT_CONFIGURED") {
      throw new Error(
        result.error ??
          "Configure a variável GEMINI_API_KEY no arquivo .env local ou nas variáveis de ambiente da Vercel.",
      );
    }
    throw new Error(
      result.error ?? "Não foi possível analisar a peça com IA. Tente novamente em instantes.",
    );
  }

  return result.data;
}
