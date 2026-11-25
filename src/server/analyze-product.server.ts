import { createClient } from "@supabase/supabase-js";

export interface AnalyzeProductRequestBody {
  imageBase64?: string;
  mimeType?: string;
  imageUrl?: string;
  availableCategories?: string[];
  availableMaterials?: string[];
}

export interface AnalyzedProductCharacteristic {
  label: string;
  value: string;
}

export interface AnalyzedProductPayload {
  name: string;
  category: string;
  material: string;
  description: string;
  characteristics: AnalyzedProductCharacteristic[];
}

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/webp",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
]);

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function normalizeMimeType(raw: string | undefined): string {
  const clean = (raw ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return clean === "image/jpg" ? "image/jpeg" : clean;
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31)
    ) {
      return true;
    }
  }
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) {
    return true;
  }
  return false;
}

async function verifyAdminAuth(request: Request): Promise<Response | null> {
  const supabaseUrl = (
    process.env["SUPABASE_URL"] ??
    process.env["VITE_SUPABASE_URL"] ??
    ""
  ).trim();
  const supabaseAnonKey = (
    process.env["SUPABASE_ANON_KEY"] ??
    process.env["VITE_SUPABASE_ANON_KEY"] ??
    ""
  ).trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const token = match?.[1]?.trim();

  if (!token) {
    return jsonResponse(
      { code: "UNAUTHORIZED", error: "Autenticação obrigatória. Faça login novamente." },
      401,
    );
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    return jsonResponse(
      { code: "UNAUTHORIZED", error: "Sessão inválida ou expirada. Faça login novamente." },
      401,
    );
  }

  return null;
}

async function resolveImageData(
  body: AnalyzeProductRequestBody,
): Promise<{ base64: string; mimeType: string } | Response> {
  if (typeof body.imageBase64 === "string" && body.imageBase64.trim() !== "") {
    let rawBase64 = body.imageBase64.trim();
    let mimeType = normalizeMimeType(body.mimeType);

    const dataUrlMatch = /^data:([^;]+);base64,(.+)$/i.exec(rawBase64);
    if (dataUrlMatch) {
      mimeType = normalizeMimeType(dataUrlMatch[1]);
      rawBase64 = (dataUrlMatch[2] ?? "").trim();
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return jsonResponse(
        { code: "INVALID_IMAGE", error: "Formato de imagem não suportado para análise." },
        400,
      );
    }

    const estimatedBytes = Math.ceil((rawBase64.length * 3) / 4);
    if (estimatedBytes > MAX_IMAGE_BYTES) {
      return jsonResponse(
        { code: "IMAGE_TOO_LARGE", error: "A imagem é muito grande. Tente uma foto menor." },
        413,
      );
    }

    return { base64: rawBase64, mimeType };
  }

  if (typeof body.imageUrl === "string" && body.imageUrl.trim() !== "") {
    const rawUrl = body.imageUrl.trim();
    const dataUrlMatch = /^data:([^;]+);base64,(.+)$/i.exec(rawUrl);
    if (dataUrlMatch) {
      const mimeType = normalizeMimeType(dataUrlMatch[1]);
      const base64 = (dataUrlMatch[2] ?? "").trim();
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        return jsonResponse(
          { code: "INVALID_IMAGE", error: "Formato de imagem não suportado para análise." },
          400,
        );
      }
      return { base64, mimeType };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return jsonResponse(
        { code: "INVALID_URL", error: "Informe uma URL de imagem válida (https://...)." },
        400,
      );
    }

    if (
      (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") ||
      isPrivateOrLocalHostname(parsedUrl.hostname)
    ) {
      return jsonResponse(
        { code: "INVALID_URL", error: "URL de imagem inválida ou não permitida." },
        400,
      );
    }

    let upstream: Response;
    try {
      upstream = await fetch(parsedUrl.toString(), {
        signal: AbortSignal.timeout(15_000),
        headers: { accept: "image/*" },
      });
    } catch {
      return jsonResponse(
        {
          code: "IMAGE_FETCH_FAILED",
          error: "Não foi possível baixar a imagem pela URL informada.",
        },
        400,
      );
    }

    if (!upstream.ok) {
      return jsonResponse(
        {
          code: "IMAGE_FETCH_FAILED",
          error: "Não foi possível acessar a imagem da URL informada.",
        },
        400,
      );
    }

    const mimeType = normalizeMimeType(upstream.headers.get("content-type") ?? "");
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return jsonResponse(
        {
          code: "INVALID_IMAGE",
          error: "A URL informada não aponta para uma imagem compatível.",
        },
        400,
      );
    }

    const contentLength = Number(upstream.headers.get("content-length") ?? "0");
    if (contentLength > MAX_IMAGE_BYTES) {
      return jsonResponse(
        { code: "IMAGE_TOO_LARGE", error: "A imagem da URL excede o limite de 6 MB." },
        413,
      );
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
      return jsonResponse(
        { code: "IMAGE_TOO_LARGE", error: "A imagem da URL está vazia ou excede 6 MB." },
        413,
      );
    }

    return { base64: buffer.toString("base64"), mimeType };
  }

  return jsonResponse(
    { code: "MISSING_IMAGE", error: "Envie uma foto ou informe uma URL válida antes de analisar." },
    400,
  );
}

function sanitizeOptionList(input: unknown, fallback: string[]): string[] {
  if (!Array.isArray(input)) return fallback;
  const seen = new Set<string>();
  const list: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const clean = item.trim();
    if (!clean) continue;
    const key = clean.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(clean);
  }
  return list.length > 0 ? list : fallback;
}

function matchAllowedOption(value: unknown, allowed: string[]): string {
  if (typeof value !== "string") return "";
  const clean = value.trim();
  if (!clean) return "";
  const exact = allowed.find(
    (option) => option.toLocaleLowerCase("pt-BR") === clean.toLocaleLowerCase("pt-BR"),
  );
  return exact ?? "";
}

function buildPrompt(categories: string[], materials: string[]): string {
  return [
    "Você é a especialista em curadoria e copywriting da loja brasileira de joias e acessórios femininos 'Use Camile Acessórios'.",
    "Analise cuidadosamente a foto do acessório enviada e preencha os campos em português do Brasil (pt-BR) retornando exclusivamente JSON válido conforme o schema.",
    "",
    "Regras obrigatórias:",
    "- name: nome comercial elegante, curto e atrativo em português (ex.: 'Brinco Argola Cravejada Zircônias'). Não inclua SKU, preço ou o nome da loja.",
    `- category: escolha EXATAMENTE uma opção desta lista: ${categories.join(", ")}.`,
    `- material: escolha EXATAMENTE uma opção desta lista: ${materials.join(", ")}. Orientação visual: peças douradas ou com banho de ouro tendem a ser 'Semijoia' e peças prateadas tendem a ser 'Prata 925', respeitando estritamente as opções disponíveis na lista.`,
    "- description: escreva de 2 a 3 frases elegantes, femininas e persuasivas no tom delicado da Use Camile Acessórios, destacando estilo, brilho e versatilidade. NUNCA invente medidas em cm/mm, peso em gramas ou prazos de garantia.",
    "- characteristics: liste de 3 a 5 características visíveis e úteis no formato { label, value } (ex.: Acabamento, Cor, Pedra, Fecho, Estilo, Ocasião). Descreva apenas o que é visível na foto e NUNCA invente tamanhos numéricos.",
  ].join("\n");
}

function buildResponseSchema(categories: string[], materials: string[]) {
  return {
    type: "OBJECT",
    properties: {
      name: {
        type: "STRING",
        description: "Nome comercial elegante, curto e atrativo em português.",
      },
      category: {
        type: "STRING",
        enum: categories,
        description: "Categoria exata escolhida dentre as opções disponíveis.",
      },
      material: {
        type: "STRING",
        enum: materials,
        description: "Material exato escolhido dentre as opções disponíveis.",
      },
      description: {
        type: "STRING",
        description:
          "Descrição de 2 a 3 frases elegantes, femininas e persuasivas sem inventar medidas, peso ou garantia.",
      },
      characteristics: {
        type: "ARRAY",
        minItems: 3,
        maxItems: 5,
        items: {
          type: "OBJECT",
          properties: {
            label: { type: "STRING" },
            value: { type: "STRING" },
          },
          required: ["label", "value"],
        },
      },
    },
    required: ["name", "category", "material", "description", "characteristics"],
  };
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export async function handleAnalyzeProductRequest(request: Request): Promise<Response> {
  const authError = await verifyAdminAuth(request);
  if (authError) return authError;

  const apiKey = (process.env["GEMINI_API_KEY"] ?? "").trim();
  if (!apiKey) {
    return jsonResponse(
      {
        code: "GEMINI_NOT_CONFIGURED",
        error:
          "A chave GEMINI_API_KEY não está configurada no servidor. Adicione GEMINI_API_KEY no arquivo .env local ou nas variáveis de ambiente da Vercel.",
      },
      503,
    );
  }

  let body: AnalyzeProductRequestBody;
  try {
    body = (await request.json()) as AnalyzeProductRequestBody;
  } catch {
    return jsonResponse({ code: "INVALID_BODY", error: "Corpo da requisição inválido." }, 400);
  }

  const resolvedImage = await resolveImageData(body);
  if (resolvedImage instanceof Response) return resolvedImage;

  const availableCategories = sanitizeOptionList(body.availableCategories, [
    "Anéis",
    "Colares",
    "Brincos",
    "Pulseiras",
    "Tornozeleiras",
    "Conjuntos",
  ]);
  const availableMaterials = sanitizeOptionList(body.availableMaterials, ["Prata 925", "Semijoia"]);

  const model = (process.env["GEMINI_MODEL"] ?? "").trim() || DEFAULT_GEMINI_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let geminiRes: Response;
  try {
    geminiRes = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: buildPrompt(availableCategories, availableMaterials) },
              {
                inline_data: {
                  mime_type: resolvedImage.mimeType,
                  data: resolvedImage.base64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.4,
          responseSchema: buildResponseSchema(availableCategories, availableMaterials),
        },
      }),
    });
  } catch {
    return jsonResponse(
      {
        code: "GEMINI_NETWORK_ERROR",
        error: "Não foi possível conectar à IA no momento. Tente novamente em instantes.",
      },
      502,
    );
  }

  if (geminiRes.status === 429) {
    return jsonResponse(
      {
        code: "RATE_LIMIT",
        error: "Limite momentâneo da IA atingido. Aguarde alguns segundos e tente novamente.",
      },
      429,
    );
  }

  const geminiJson = (await geminiRes.json().catch(() => ({}))) as GeminiGenerateContentResponse;

  if (!geminiRes.ok) {
    if (geminiRes.status === 401 || geminiRes.status === 403) {
      return jsonResponse(
        {
          code: "GEMINI_AUTH_ERROR",
          error: "Chave GEMINI_API_KEY inválida ou sem permissão no Google AI Studio.",
        },
        502,
      );
    }
    return jsonResponse(
      {
        code: "GEMINI_API_ERROR",
        error:
          geminiJson.error?.message ??
          "A IA não conseguiu analisar esta imagem agora. Tente novamente.",
      },
      502,
    );
  }

  const rawText = geminiJson.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!rawText) {
    return jsonResponse(
      {
        code: "EMPTY_RESPONSE",
        error: "A IA não retornou detalhes para esta imagem. Tente outra foto mais nítida.",
      },
      502,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    const candidate = JSON.parse(rawText) as unknown;
    if (candidate == null || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("invalid");
    }
    parsed = candidate as Record<string, unknown>;
  } catch {
    return jsonResponse(
      {
        code: "INVALID_AI_JSON",
        error: "Não foi possível interpretar a resposta da IA. Tente novamente.",
      },
      502,
    );
  }

  const rawCharacteristics = parsed["characteristics"];
  const characteristics: AnalyzedProductCharacteristic[] = Array.isArray(rawCharacteristics)
    ? rawCharacteristics
        .filter(
          (item): item is { label?: unknown; value?: unknown } =>
            item != null && typeof item === "object",
        )
        .map((item) => ({
          label: typeof item.label === "string" ? item.label.trim() : "",
          value: typeof item.value === "string" ? item.value.trim() : "",
        }))
        .filter((item) => item.label !== "" && item.value !== "")
        .slice(0, 5)
    : [];

  const result: AnalyzedProductPayload = {
    name: typeof parsed["name"] === "string" ? parsed["name"].trim() : "",
    category: matchAllowedOption(parsed["category"], availableCategories),
    material: matchAllowedOption(parsed["material"], availableMaterials),
    description: typeof parsed["description"] === "string" ? parsed["description"].trim() : "",
    characteristics,
  };

  return jsonResponse({ data: result }, 200);
}
