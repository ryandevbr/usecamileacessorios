import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { STORE_CONFIG } from "@/config/store.config";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  WRONG_STORE_ACCOUNT_ERROR,
  enterDemoSession,
  getAuthState,
  signInAdmin,
} from "@/services/authService";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: `Acesso ao painel | ${STORE_CONFIG.name}` },
      { name: "description", content: `Acesso restrito ao painel da ${STORE_CONFIG.name}.` },
      { property: "og:title", content: `Painel ${STORE_CONFIG.name}` },
      { property: "og:description", content: `Área administrativa da ${STORE_CONFIG.name}.` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void getAuthState().then((state) => {
      if (!active) return;
      if (state.authenticated) {
        void navigate({ to: "/admin" });
      } else if (state.unauthorizedStore) {
        toast.error(WRONG_STORE_ACCOUNT_ERROR, { id: "wrong-store-account" });
      }
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSupabaseConfigured) return;
    if (!email.trim() || !password) {
      toast.error("Informe seu e-mail e sua senha.");
      return;
    }

    setSubmitting(true);
    try {
      await signInAdmin(email, password);
      toast.success("Bem-vinda de volta!");
      await navigate({ to: "/admin" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível entrar.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-muted grid place-items-center px-6">
      <div className="w-full max-w-sm text-center">
        <img
          src="/logo.png"
          alt={STORE_CONFIG.name}
          className="h-20 sm:h-24 w-auto mx-auto mb-6 object-contain"
        />
        <LockKeyhole size={22} className="mx-auto text-primary mb-4" />
        <h1 className="text-4xl">Seu espaço de cuidado</h1>
        <p className="text-muted-foreground text-xs mt-3 mb-8">Painel da {STORE_CONFIG.name}</p>
        <form onSubmit={handleSubmit} className="text-left space-y-5">
          <label>
            E-mail
            <input
              type="email"
              autoComplete="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!isSupabaseConfigured || submitting}
              required={isSupabaseConfigured}
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Sua senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!isSupabaseConfigured || submitting}
              required={isSupabaseConfigured}
            />
          </label>
          <Button
            type="submit"
            disabled={!isSupabaseConfigured || submitting}
            className="w-full h-12"
          >
            {submitting ? "Entrando..." : "Entrar"}
          </Button>
        </form>
        {!isSupabaseConfigured && (
          <div className="border-t mt-8 pt-6">
            <p className="text-xs text-primary">Modo Demonstração Local</p>
            <p className="text-[11px] text-muted-foreground leading-6 mt-2 mb-4">
              Acesso por senha aguarda a configuração do Supabase no arquivo .env. As alterações de
              demonstração ficam apenas neste navegador.
            </p>
            <Button
              variant="outline"
              className="w-full h-12"
              onClick={() => {
                enterDemoSession();
                void navigate({ to: "/admin" });
              }}
            >
              Entrar no modo demonstração <ArrowRight />
            </Button>
          </div>
        )}
        <Link to="/" className="inline-flex gap-2 items-center text-xs text-muted-foreground mt-8">
          <ArrowLeft size={14} />
          Voltar para a vitrine
        </Link>
      </div>
    </main>
  );
}
