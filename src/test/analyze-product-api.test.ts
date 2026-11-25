import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAnalyzeProductRequest } from "@/server/analyze-product.server";

describe("POST /api/analyze-product handler", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env["VITE_SUPABASE_URL"];
    delete process.env["VITE_SUPABASE_ANON_KEY"];
    delete process.env["SUPABASE_URL"];
    delete process.env["SUPABASE_ANON_KEY"];
    delete process.env["GEMINI_API_KEY"];
    delete process.env["GEMINI_MODEL"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns 503 with clear instructions when GEMINI_API_KEY is missing", async () => {
    const req = new Request("http://localhost/api/analyze-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: "AAAA", mimeType: "image/webp" }),
    });

    const res = await handleAnalyzeProductRequest(req);
    expect(res.status).toBe(503);
    const json = (await res.json()) as { code?: string; error?: string };
    expect(json.code).toBe("GEMINI_NOT_CONFIGURED");
    expect(json.error).toContain("GEMINI_API_KEY");
  });

  it("returns 401 when Supabase is configured and Authorization header is missing", async () => {
    process.env["VITE_SUPABASE_URL"] = "https://example.supabase.co";
    process.env["VITE_SUPABASE_ANON_KEY"] = "anon-key";
    process.env["GEMINI_API_KEY"] = "test-key";

    const req = new Request("http://localhost/api/analyze-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: "AAAA", mimeType: "image/webp" }),
    });

    const res = await handleAnalyzeProductRequest(req);
    expect(res.status).toBe(401);
  });

  it("rejects private/loopback image URLs to prevent SSRF", async () => {
    process.env["GEMINI_API_KEY"] = "test-key";

    const req = new Request("http://localhost/api/analyze-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageUrl: "http://127.0.0.1/secret.png" }),
    });

    const res = await handleAnalyzeProductRequest(req);
    expect(res.status).toBe(400);
  });

  it("maps Gemini 429 rate limit to a friendly message", async () => {
    process.env["GEMINI_API_KEY"] = "test-key";
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: { code: 429 } }), { status: 429 }));

    const req = new Request("http://localhost/api/analyze-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64: "UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=",
        mimeType: "image/webp",
        availableCategories: ["Brincos", "Colares"],
        availableMaterials: ["Prata 925", "Semijoia"],
      }),
    });

    const res = await handleAnalyzeProductRequest(req);
    expect(res.status).toBe(429);
    const json = (await res.json()) as { code?: string; error?: string };
    expect(json.code).toBe("RATE_LIMIT");
    expect(json.error).toContain("Limite momentâneo da IA");
  });

  it("returns validated structured product details from Gemini", async () => {
    process.env["GEMINI_API_KEY"] = "test-key";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      name: "Brinco Argola Cravejada Zircônias",
                      category: "brincos",
                      material: "semijoia",
                      description:
                        "Uma argola dourada sofisticada com brilho delicado para iluminar o visual. Perfeita para compor looks do dia a dia ou ocasiões especiais.",
                      characteristics: [
                        { label: "Acabamento", value: "Polido dourado" },
                        { label: "Pedra", value: "Zircônias cravejadas" },
                        { label: "Estilo", value: "Clássico atemporal" },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const req = new Request("http://localhost/api/analyze-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64: "UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=",
        mimeType: "image/webp",
        availableCategories: ["Brincos", "Colares"],
        availableMaterials: ["Prata 925", "Semijoia"],
      }),
    });

    const res = await handleAnalyzeProductRequest(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        name: string;
        category: string;
        material: string;
        description: string;
        characteristics: { label: string; value: string }[];
      };
    };
    expect(json.data.name).toBe("Brinco Argola Cravejada Zircônias");
    expect(json.data.category).toBe("Brincos");
    expect(json.data.material).toBe("Semijoia");
    expect(json.data.characteristics).toHaveLength(3);
  });
});
