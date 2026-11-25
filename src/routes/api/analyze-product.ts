import { createFileRoute } from "@tanstack/react-router";
import { handleAnalyzeProductRequest } from "@/server/analyze-product.server";

export const Route = createFileRoute("/api/analyze-product")({
  server: {
    handlers: {
      POST: async ({ request }) => handleAnalyzeProductRequest(request),
    },
  },
});
