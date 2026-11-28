import { createFileRoute } from "@tanstack/react-router";
import { AdminPanel } from "@/components/admin-panel";
import { STORE_CONFIG } from "@/config/store.config";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: `Administrar loja | ${STORE_CONFIG.name}` },
      { name: "description", content: `Produtos, banners, cupons e perfil da ${STORE_CONFIG.name}.` },
      { property: "og:title", content: `Administrar ${STORE_CONFIG.name}` },
      { property: "og:description", content: "Painel de gestão da loja." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPanel,
});
