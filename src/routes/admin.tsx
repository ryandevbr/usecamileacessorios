import { createFileRoute } from "@tanstack/react-router";
import { AdminPanel } from "@/components/admin-panel";
export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Administrar loja | Use Camile Acessórios" },
      { name: "description", content: "Produtos, banners, cupons e perfil da Use Camile." },
      { property: "og:title", content: "Administrar Use Camile" },
      { property: "og:description", content: "Painel de gestão da loja." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPanel,
});
