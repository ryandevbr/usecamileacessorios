import { createFileRoute } from "@tanstack/react-router";
import { Storefront } from "@/components/storefront";
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Use Camile Acessórios | Prata 925 e Semijoias" },
      {
        name: "description",
        content:
          "Acessórios selecionados com carinho. Descubra Prata 925 e Semijoias, monte sua sacola e compre pelo WhatsApp. Enviamos para todo o Brasil.",
      },
      { property: "og:title", content: "Use Camile Acessórios | Seu estilo merece esse brilho" },
      {
        property: "og:description",
        content:
          "Prata 925 e Semijoias com atendimento personalizado. Loja 100% online, entregas em todo o Brasil.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Storefront,
});
