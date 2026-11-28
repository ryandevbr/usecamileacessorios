import { STORE_CONFIG, type StoreNiche } from "@/config/store.config";
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
  estimatedPrice?: number | null | undefined;
}

export interface AiProductMeta {
  provider: "groq" | "gemini" | "openrouter";
  model: string;
}

export interface AnalyzeProductParams {
  file?: File | null;
  imageUrl?: string;
  availableCategories: string[];
  availableMaterials: string[];
  niche?: StoreNiche;
  estimatePrice?: boolean;
}

interface AnalyzeApiResponse {
  data?: AiProductAnalysis;
  meta?: AiProductMeta;
  error?: string;
  code?: string;
}

const KNOWN_FRIENDLY_CODES = new Set([
  "UNAUTHORIZED",
  "AI_NOT_CONFIGURED",
  "AI_OVERLOADED",
  "AI_AUTH_ERROR",
  "AI_UNAVAILABLE",
  "INVALID_BODY",
  "INVALID_IMAGE",
  "IMAGE_TOO_LARGE",
  "INVALID_URL",
  "IMAGE_FETCH_FAILED",
  "MISSING_IMAGE",
]);

const OVERLOADED_MESSAGE =
  "A IA está sobrecarregada no momento. Aguarde alguns segundos e toque novamente em 'Preencher detalhes com IA', ou preencha os campos manualmente.";
const NOT_CONFIGURED_MESSAGE =
  "Nenhum provedor de IA está configurado no servidor. Adicione ao menos uma chave (GROQ_API_KEY, GEMINI_API_KEY ou OPENROUTER_API_KEY) no arquivo .env local ou nas variáveis de ambiente da Vercel.";
const GENERIC_ERROR_MESSAGE =
  "Não foi possível analisar a peça com IA neste momento. Tente novamente em instantes ou preencha os campos manualmente.";

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
    niche: StoreNiche;
    estimatePrice?: boolean;
  } = {
    availableCategories: params.availableCategories,
    availableMaterials: params.availableMaterials,
    niche: params.niche ?? STORE_CONFIG.niche,
    ...(params.estimatePrice ? { estimatePrice: true } : {}),
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
    if (result.code === "AI_NOT_CONFIGURED") {
      throw new Error(result.error || NOT_CONFIGURED_MESSAGE);
    }
    if (
      response.status === 429 ||
      response.status === 503 ||
      response.status === 504 ||
      result.code === "AI_OVERLOADED"
    ) {
      throw new Error(OVERLOADED_MESSAGE);
    }
    if (result.code && KNOWN_FRIENDLY_CODES.has(result.code) && result.error) {
      throw new Error(result.error);
    }
    throw new Error(GENERIC_ERROR_MESSAGE);
  }

  return result.data;
}
