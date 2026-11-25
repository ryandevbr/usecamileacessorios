import { createClient } from "@supabase/supabase-js";

export type AiProviderName = "groq" | "gemini" | "openrouter";

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

export interface AnalyzeProductMeta {
  provider: AiProviderName;
  model: string;
}

interface ProviderAttempt {
  provider: AiProviderName;
  model: string;
  apiKey: string;
}

interface AttemptFailure {
  kind: "demand" | "auth" | "other";
  reason: string;
}

const DEFAULT_PROVIDER_ORDER: AiProviderName[] = ["groq", "gemini", "openrouter"];
const DEFAULT_GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_GEMINI_FALLBACK_MODELS = ["gemini-3.8-flash"];
const DEFAULT_OPENROUTER_MODELS = ["openrouter/free"];

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const PER_ATTEMPT_TIMEOUT_MS = 4_500;
const TOTAL_BUDGET_MS = 8_500;
const MIN_REMAINING_MS = 500;

const OVERLOADED_MESSAGE =
  "A IA está sobrecarregada no momento. Aguarde alguns segundos e toque novamente em 'Preencher detalhes com IA', ou preencha os campos manualmente.";
const NOT_CONFIGURED_MESSAGE =
  "Nenhum provedor de IA está configurado no servidor. Adicione ao menos uma chave (GROQ_API_KEY, GEMINI_API_KEY ou OPENROUTER_API_KEY) no arquivo .env local ou nas variáveis de ambiente da Vercel.";
const AUTH_ERROR_MESSAGE =
  "As chaves de IA configuradas no servidor não foram aceitas pelo provedor. Verifique as credenciais no .env local ou na Vercel.";
const GENERIC_AI_ERROR_MESSAGE =
  "Não foi possível analisar a peça com IA neste momento. Tente novamente em instantes ou preencha os campos manualmente.";

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

function parseCsvList(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const clean = part.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function parseProviderOrder(raw: string | undefined): AiProviderName[] {
  const parsed = parseCsvList(raw)
    .map((item) => item.toLowerCase())
    .filter(
      (item): item is AiProviderName =>
        item === "groq" || item === "gemini" || item === "openrouter",
    );
  return parsed.length > 0 ? parsed : DEFAULT_PROVIDER_ORDER;
}

function buildProviderQueue(env: NodeJS.ProcessEnv): ProviderAttempt[] {
  const order = parseProviderOrder(env["AI_PROVIDER_ORDER"]);
  const queue: ProviderAttempt[] = [];

  for (const provider of order) {
    if (provider === "groq") {
      const apiKey = (env["GROQ_API_KEY"] ?? "").trim();
      if (!apiKey) continue;
      const primary = (env["GROQ_MODEL"] ?? "").trim() || DEFAULT_GROQ_MODEL;
      const fallbacks = parseCsvList(env["GROQ_FALLBACK_MODELS"]);
      const models = parseCsvList([primary, ...fallbacks].join(","));
      for (const model of models) {
        queue.push({ provider: "groq", model, apiKey });
      }
    } else if (provider === "gemini") {
      const apiKey = (env["GEMINI_API_KEY"] ?? "").trim();
      if (!apiKey) continue;
      const primary = (env["GEMINI_MODEL"] ?? "").trim() || DEFAULT_GEMINI_MODEL;
      const fallbacks =
        env["GEMINI_FALLBACK_MODELS"] !== undefined
          ? parseCsvList(env["GEMINI_FALLBACK_MODELS"])
          : DEFAULT_GEMINI_FALLBACK_MODELS;
      const models = parseCsvList([primary, ...fallbacks].join(","));
      for (const model of models) {
        queue.push({ provider: "gemini", model, apiKey });
      }
    } else if (provider === "openrouter") {
      const apiKey = (env["OPENROUTER_API_KEY"] ?? "").trim();
      if (!apiKey) continue;
      const configuredModels = parseCsvList(env["OPENROUTER_MODELS"]);
      const models = configuredModels.length > 0 ? configuredModels : DEFAULT_OPENROUTER_MODELS;
      for (const model of models) {
        queue.push({ provider: "openrouter", model, apiKey });
      }
    }
  }

  return queue;
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_500);
    let upstream: Response;
    try {
      upstream = await fetch(parsedUrl.toString(), {
        signal: controller.signal,
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
    } finally {
      clearTimeout(timer);
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

function matchAllowedOptionWithFallback(value: unknown, allowed: string[]): string {
  const fallback = allowed[0] ?? "";
  if (typeof value !== "string") return fallback;
  const clean = value.trim();
  if (!clean) return fallback;
  const exact = allowed.find(
    (option) => option.toLocaleLowerCase("pt-BR") === clean.toLocaleLowerCase("pt-BR"),
  );
  return exact ?? fallback;
}

function buildSystemPrompt(categories: string[], materials: string[]): string {
  return [
    "Você é a especialista em curadoria e copywriting da loja brasileira de joias e acessórios femininos 'Use Camile Acessórios'.",
    "Analise cuidadosamente a foto do acessório e responda EXCLUSIVAMENTE com um objeto JSON válido em português do Brasil (pt-BR), sem markdown, sem comentários e sem texto extra.",
    "",
    "Schema JSON obrigatório:",
    "{",
    '  "name": "string — nome comercial elegante, curto e atrativo em português (ex.: Brinco Argola Cravejada Zircônias), sem SKU, preço ou nome da loja",',
    `  "category": "string — EXATAMENTE uma opção de: ${categories.join(", ")}",`,
    `  "material": "string — EXATAMENTE uma opção de: ${materials.join(", ")} (peças douradas/banhadas a ouro tendem a ser Semijoia e peças prateadas tendem a ser Prata 925, respeitando estritamente as opções disponíveis)",`,
    '  "description": "string — 2 a 3 frases elegantes, femininas e persuasivas destacando estilo, brilho e versatilidade, SEM inventar medidas em cm/mm, peso ou garantia",',
    '  "characteristics": [',
    '    { "label": "string (ex.: Acabamento, Cor, Pedra, Fecho, Estilo, Ocasião)", "value": "string — apenas atributos visíveis, sem inventar tamanhos numéricos" }',
    "  ] // de 3 a 5 itens",
    "}",
  ].join("\n");
}

function buildGeminiResponseSchema(categories: string[], materials: string[]) {
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

function extractJsonObject(rawText: string): Record<string, unknown> | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const candidates: string[] = [];
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }
  candidates.push(trimmed);

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next extraction candidate
    }
  }

  return null;
}

export function parseAndNormalizeAiJson(
  rawText: string,
  availableCategories: string[],
  availableMaterials: string[],
): AnalyzedProductPayload | null {
  const parsed = extractJsonObject(rawText);
  if (!parsed) return null;

  const name = typeof parsed["name"] === "string" ? parsed["name"].trim() : "";
  const description = typeof parsed["description"] === "string" ? parsed["description"].trim() : "";
  if (!name || !description) return null;

  const rawCharacteristics = parsed["characteristics"];
  const characteristics: AnalyzedProductCharacteristic[] = Array.isArray(rawCharacteristics)
    ? rawCharacteristics
        .filter(
          (item): item is Record<string, unknown> =>
            item != null && typeof item === "object" && !Array.isArray(item),
        )
        .map((item) => {
          const rawLabel = item["label"] ?? item["attribute"] ?? item["name"];
          const rawValue = item["value"];
          return {
            label: typeof rawLabel === "string" ? rawLabel.trim() : "",
            value: typeof rawValue === "string" ? rawValue.trim() : "",
          };
        })
        .filter((item) => item.label !== "" && item.value !== "")
        .slice(0, 5)
    : [];

  return {
    name,
    category: matchAllowedOptionWithFallback(parsed["category"], availableCategories),
    material: matchAllowedOptionWithFallback(parsed["material"], availableMaterials),
    description,
    characteristics,
  };
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: { message?: string };
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
}

function classifyHttpFailure(status: number, providerMsg?: string): AttemptFailure {
  const suffix = providerMsg ? ` (${providerMsg.slice(0, 140)})` : "";
  if (status === 429 || status === 503 || status === 504 || status === 529) {
    return { kind: "demand", reason: `HTTP ${status}${suffix}` };
  }
  if (status === 401 || status === 403) {
    return { kind: "auth", reason: `HTTP ${status}${suffix}` };
  }
  return { kind: "other", reason: `HTTP ${status}${suffix}` };
}

async function callOpenAiCompatibleVision(params: {
  endpoint: string;
  attempt: ProviderAttempt;
  image: { base64: string; mimeType: string };
  categories: string[];
  materials: string[];
  signal: AbortSignal;
  referer?: string;
}): Promise<{ ok: true; text: string } | { ok: false; failure: AttemptFailure }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${params.attempt.apiKey}`,
  };
  if (params.attempt.provider === "openrouter") {
    if (params.referer) headers["http-referer"] = params.referer;
    headers["x-title"] = "Use Camile Acessorios";
  }

  let res: Response;
  try {
    res = await fetch(params.endpoint, {
      method: "POST",
      signal: params.signal,
      headers,
      body: JSON.stringify({
        model: params.attempt.model,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildSystemPrompt(params.categories, params.materials) },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analise esta peça de acessório e retorne apenas o JSON preenchido.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${params.image.mimeType};base64,${params.image.base64}`,
                },
              },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      failure: {
        kind: isAbort ? "demand" : "other",
        reason: isAbort ? "timeout" : err instanceof Error ? err.message : "network error",
      },
    };
  }

  const json = (await res.json().catch(() => ({}))) as OpenAiChatResponse;
  if (!res.ok) {
    return { ok: false, failure: classifyHttpFailure(res.status, json.error?.message) };
  }

  const content = json.choices?.[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => (typeof part.text === "string" ? part.text : "")).join("")
        : "";

  if (!text.trim()) {
    return { ok: false, failure: { kind: "other", reason: "resposta vazia" } };
  }

  return { ok: true, text };
}

async function callGeminiVision(params: {
  attempt: ProviderAttempt;
  image: { base64: string; mimeType: string };
  categories: string[];
  materials: string[];
  signal: AbortSignal;
}): Promise<{ ok: true; text: string } | { ok: false; failure: AttemptFailure }> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.attempt.model)}:generateContent?key=${encodeURIComponent(params.attempt.apiKey)}`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      signal: params.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: buildSystemPrompt(params.categories, params.materials) },
              {
                inline_data: {
                  mime_type: params.image.mimeType,
                  data: params.image.base64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.4,
          responseSchema: buildGeminiResponseSchema(params.categories, params.materials),
        },
      }),
    });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      failure: {
        kind: isAbort ? "demand" : "other",
        reason: isAbort ? "timeout" : err instanceof Error ? err.message : "network error",
      },
    };
  }

  const json = (await res.json().catch(() => ({}))) as GeminiGenerateContentResponse;
  if (!res.ok) {
    return { ok: false, failure: classifyHttpFailure(res.status, json.error?.message) };
  }

  const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";

  if (!text.trim()) {
    return { ok: false, failure: { kind: "other", reason: "resposta vazia" } };
  }

  return { ok: true, text };
}

export async function handleAnalyzeProductRequest(request: Request): Promise<Response> {
  const startedAt = Date.now();

  const authError = await verifyAdminAuth(request);
  if (authError) return authError;

  const queue = buildProviderQueue(process.env);
  if (queue.length === 0) {
    return jsonResponse({ code: "AI_NOT_CONFIGURED", error: NOT_CONFIGURED_MESSAGE }, 503);
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
  const referer = request.headers.get("origin") ?? request.headers.get("referer") ?? undefined;

  let hadDemandFailure = false;
  let allAuthFailures = true;
  let attemptsRun = 0;

  for (const attempt of queue) {
    const elapsed = Date.now() - startedAt;
    const remaining = TOTAL_BUDGET_MS - elapsed;
    if (remaining < MIN_REMAINING_MS) {
      hadDemandFailure = true;
      console.warn(
        `[analyze-product] Tempo limite total atingido (${elapsed}ms); pulando ${attempt.provider}/${attempt.model}.`,
      );
      break;
    }

    attemptsRun += 1;
    const timeoutMs = Math.min(PER_ATTEMPT_TIMEOUT_MS, remaining);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const outcome =
        attempt.provider === "groq"
          ? await callOpenAiCompatibleVision({
              endpoint: "https://api.groq.com/openai/v1/chat/completions",
              attempt,
              image: resolvedImage,
              categories: availableCategories,
              materials: availableMaterials,
              signal: controller.signal,
            })
          : attempt.provider === "openrouter"
            ? await callOpenAiCompatibleVision({
                endpoint: "https://openrouter.ai/api/v1/chat/completions",
                attempt,
                image: resolvedImage,
                categories: availableCategories,
                materials: availableMaterials,
                signal: controller.signal,
                ...(referer ? { referer } : {}),
              })
            : await callGeminiVision({
                attempt,
                image: resolvedImage,
                categories: availableCategories,
                materials: availableMaterials,
                signal: controller.signal,
              });

      if (!outcome.ok) {
        if (outcome.failure.kind === "demand") hadDemandFailure = true;
        if (outcome.failure.kind !== "auth") allAuthFailures = false;
        console.warn(
          `[analyze-product] Falha em ${attempt.provider}/${attempt.model}: ${outcome.failure.reason}`,
        );
        continue;
      }

      const normalized = parseAndNormalizeAiJson(
        outcome.text,
        availableCategories,
        availableMaterials,
      );
      if (!normalized) {
        allAuthFailures = false;
        console.warn(
          `[analyze-product] JSON inválido retornado por ${attempt.provider}/${attempt.model}; tentando próximo.`,
        );
        continue;
      }

      const meta: AnalyzeProductMeta = {
        provider: attempt.provider,
        model: attempt.model,
      };
      return jsonResponse({ data: normalized, meta }, 200);
    } finally {
      clearTimeout(timer);
    }
  }

  if (attemptsRun > 0 && allAuthFailures) {
    return jsonResponse({ code: "AI_AUTH_ERROR", error: AUTH_ERROR_MESSAGE }, 502);
  }

  if (hadDemandFailure) {
    return jsonResponse({ code: "AI_OVERLOADED", error: OVERLOADED_MESSAGE }, 503);
  }

  return jsonResponse({ code: "AI_UNAVAILABLE", error: GENERIC_AI_ERROR_MESSAGE }, 502);
}
