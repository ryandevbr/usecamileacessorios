import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleAnalyzeProductRequest,
  parseAndNormalizeAiJson,
} from "@/server/analyze-product.server";

const SAMPLE_BASE64 = "UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=";

describe("POST /api/analyze-product multi-provider cascade", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env["VITE_SUPABASE_URL"];
    delete process.env["VITE_SUPABASE_ANON_KEY"];
    delete process.env["SUPABASE_URL"];
    delete process.env["SUPABASE_ANON_KEY"];
    delete process.env["AI_PROVIDER_ORDER"];
    delete process.env["GROQ_API_KEY"];
    delete process.env["GROQ_MODEL"];
    delete process.env["GROQ_FALLBACK_MODELS"];
    delete process.env["GEMINI_API_KEY"];
    delete process.env["GEMINI_MODEL"];
    delete process.env["GEMINI_FALLBACK_MODELS"];
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["OPENROUTER_MODELS"];
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns 503 in Portuguese when no AI provider key is configured", async () => {
    const req = new Request("http://localhost/api/analyze-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: SAMPLE_BASE64, mimeType: "image/webp" }),
    });

    const res = await handleAnalyzeProductRequest(req);
    expect(res.status).toBe(503);
    const json = (await res.json()) as { code?: string; error?: string };
    expect(json.code).toBe("AI_NOT_CONFIGURED");
    expect(json.error).toContain("Nenhum provedor de IA");
  });

  it("returns 401 when Supabase is configured and Authorization header is missing", async () => {
    process.env["VITE_SUPABASE_URL"] = "https://example.supabase.co";
    process.env["VITE_SUPABASE_ANON_KEY"] = "anon-key";
    process.env["GROQ_API_KEY"] = "groq-test";

    const req = new Request("http://localhost/api/analyze-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: SAMPLE_BASE64, mimeType: "image/webp" }),
    });

    const res = await handleAnalyzeProductRequest(req);
    expect(res.status).toBe(401);
  });

  it("rejects private/loopback image URLs to prevent SSRF", async () => {
    process.env["GROQ_API_KEY"] = "groq-test";

    const req = new Request("http://localhost/api/analyze-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageUrl: "http://127.0.0.1/secret.png" }),
    });

    const res = await handleAnalyzeProductRequest(req);
    expect(res.status).toBe(400);
  });

  it("fails fast from Groq 503 to Gemini fallback and returns meta { provider, model }", async () => {
    process.env["AI_PROVIDER_ORDER"] = "groq,gemini,openrouter";
    process.env["GROQ_API_KEY"] = "groq-test";
    process.env["GEMINI_API_KEY"] = "gemini-test";
    process.env["GEMINI_MODEL"] = "gemini-3.1-flash-lite";
    process.env["GEMINI_FALLBACK_MODELS"] = "gemini-3.8-flash";

    const fetchMock = vi
      .fn()
      // 1. Groq returns 503 with raw English error
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Service temporarily overloaded" } }), {
          status: 503,
        }),
      )
      // 2. Gemini primary returns 429
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Resource exhausted" } }), {
          status: 429,
        }),
      )
      // 3. Gemini fallback succeeds with markdown-fenced JSON
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: [
                        "```json",
                        JSON.stringify({
                          name: "Brinco Argola Cravejada Zircônias",
                          category: "brincos",
                          material: "semijoia",
                          description:
                            "Argola sofisticada com brilho delicado para iluminar qualquer produção. Versátil e elegante para o dia a dia ou ocasiões especiais.",
                          characteristics: [
                            { label: "Acabamento", value: "Polido dourado" },
                            { label: "Pedra", value: "Zircônias cravejadas" },
                            { label: "Estilo", value: "Clássico atemporal" },
                          ],
                        }),
                        "```",
                      ].join("\n"),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    globalThis.fetch = fetchMock;

    const req = new Request("http://localhost/api/analyze-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64: SAMPLE_BASE64,
        mimeType: "image/webp",
        niche: "acessorios",
        availableCategories: ["Brincos", "Colares"],
        availableMaterials: ["Prata 925", "Semijoia"],
      }),
    });

    const res = await handleAnalyzeProductRequest(req);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const json = (await res.json()) as {
      data: {
        name: string;
        category: string;
        material: string;
        characteristics: { label: string; value: string }[];
      };
      meta: { provider: string; model: string };
    };
    expect(json.data.name).toBe("Brinco Argola Cravejada Zircônias");
    expect(json.data.category).toBe("Brincos");
    expect(json.data.material).toBe("Semijoia");
    expect(json.data.characteristics).toHaveLength(3);
    expect(json.meta).toEqual({ provider: "gemini", model: "gemini-3.8-flash" });
  });

  it("never leaks raw English error when all providers fail with 503/429", async () => {
    process.env["GROQ_API_KEY"] = "groq-test";
    process.env["OPENROUTER_API_KEY"] = "or-test";
    process.env["OPENROUTER_MODELS"] = "vision/free-model";

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "This model is currently experiencing high demand" } }),
        {
          status: 503,
        },
      ),
    );

    const req = new Request("http://localhost/api/analyze-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64: SAMPLE_BASE64,
        mimeType: "image/webp",
        availableCategories: ["Brincos"],
        availableMaterials: ["Semijoia"],
      }),
    });

    const res = await handleAnalyzeProductRequest(req);
    expect(res.status).toBe(503);
    const json = (await res.json()) as { code?: string; error?: string };
    expect(json.code).toBe("AI_OVERLOADED");
    expect(json.error).toBe(
      "A IA está sobrecarregada no momento. Aguarde alguns segundos e toque novamente em 'Preencher detalhes com IA', ou preencha os campos manualmente.",
    );
    expect(json.error).not.toContain("high demand");
  });

  it("falls back safely to the first valid category/material when AI returns out-of-list values", () => {
    const parsed = parseAndNormalizeAiJson(
      '```json\n{"name":"Colar Luz","category":"Inexistente","material":"Ouro Maciço","description":"Brilho delicado.","characteristics":[{"label":"Cor","value":"Dourado"}]}\n```',
      ["Colares", "Brincos"],
      ["Semijoia", "Prata 925"],
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.category).toBe("Colares");
    expect(parsed?.material).toBe("Semijoia");
  });

  it("adapts prompt and default options for niche 'moda'", async () => {
    process.env["GROQ_API_KEY"] = "groq-test";

    let capturedBody = "";
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: "Vestido Midi Linho Natural",
                  category: "Vestidos",
                  material: "Linho",
                  description:
                    "Vestido midi com caimento fluido e toque fresco, perfeito para almoços ao ar livre e eventos diurnos com máximo conforto.",
                  characteristics: [
                    { label: "Tecido", value: "Linho natural" },
                    { label: "Caimento", value: "Fluido e acinturado" },
                    { label: "Ocasião", value: "Eventos diurnos e casuais" },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock;

    const req = new Request("http://localhost/api/analyze-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64: SAMPLE_BASE64,
        mimeType: "image/webp",
        niche: "moda",
        // Even if stale accessories options are passed, moda must strip them and enforce fashion defaults
        availableCategories: ["Anéis", "Brincos", "Colares"],
        availableMaterials: ["Prata 925", "Semijoia"],
      }),
    });

    const res = await handleAnalyzeProductRequest(req);
    expect(res.status).toBe(200);
    expect(capturedBody).toContain("Moda Feminina");
    expect(capturedBody).toContain("Vestidos");
    expect(capturedBody).toContain("Alfaiataria");
    expect(capturedBody).toContain("caimento, ocasião de uso e conforto");
    expect(capturedBody).not.toContain("Anéis");
    expect(capturedBody).not.toContain("Brincos");
    expect(capturedBody).not.toContain("Prata 925");
    expect(capturedBody).not.toContain("Semijoia");

    const json = (await res.json()) as {
      data: { name: string; category: string; material: string };
    };
    expect(json.data.category).toBe("Vestidos");
    expect(json.data.material).toBe("Linho");
  });

  it("adapts prompt and strips accessory terms for niche 'calcados'", async () => {
    process.env["GROQ_API_KEY"] = "groq-test";

    let capturedBody = "";
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: "Sandália Salto Bloco Napa",
                  category: "Sandálias",
                  material: "Napa",
                  description:
                    "Sandália confortável de calce macio e estilo atemporal, perfeita para o trabalho e eventos.",
                  characteristics: [
                    { label: "Material", value: "Napa" },
                    { label: "Salto", value: "Bloco" },
                    { label: "Ocasião", value: "Dia a dia e eventos" },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const req = new Request("http://localhost/api/analyze-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64: SAMPLE_BASE64,
        mimeType: "image/webp",
        niche: "calcados",
        availableCategories: ["Anéis", "Brincos", "Colares"],
        availableMaterials: ["Prata 925", "Semijoia"],
      }),
    });

    const res = await handleAnalyzeProductRequest(req);
    expect(res.status).toBe(200);
    expect(capturedBody).toContain("Calçados");
    expect(capturedBody).toContain("Sandálias");
    expect(capturedBody).toContain("Couro");
    expect(capturedBody).not.toContain("Anéis");
    expect(capturedBody).not.toContain("Brincos");
    expect(capturedBody).not.toContain("Prata 925");
    expect(capturedBody).not.toContain("Semijoia");

    const json = (await res.json()) as {
      data: { name: string; category: string; material: string; estimatedPrice?: number | null };
    };
    expect(json.data.category).toBe("Sandálias");
    expect(json.data.material).toBe("Napa");
    expect(json.data.estimatedPrice).toBeUndefined();
  });

  it("includes niche price guidance and normalized .90 estimatedPrice when estimatePrice is true", async () => {
    process.env["GROQ_API_KEY"] = "groq-test";

    let capturedBody = "";
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: "Vestido Longo Linho",
                  category: "Vestidos",
                  material: "Linho",
                  description: "Caimento impecável para dias especiais.",
                  characteristics: [
                    { label: "Tecido", value: "Linho" },
                    { label: "Caimento", value: "Fluido" },
                    { label: "Ocasião", value: "Eventos" },
                  ],
                  estimatedPrice: 174.37,
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const req = new Request("http://localhost/api/analyze-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64: SAMPLE_BASE64,
        mimeType: "image/webp",
        niche: "moda",
        estimatePrice: true,
      }),
    });

    const res = await handleAnalyzeProductRequest(req);
    expect(res.status).toBe(200);
    expect(capturedBody).toContain("estimatedPrice");
    expect(capturedBody).toContain("119.90 e 219.90");

    const json = (await res.json()) as {
      data: { estimatedPrice?: number | null };
    };
    expect(json.data.estimatedPrice).toBe(174.9);
  });
});
