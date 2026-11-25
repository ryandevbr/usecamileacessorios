import { isSupabaseConfigured, requireSupabase, supabase } from "@/lib/supabase";

const DEMO_SESSION_KEY = "camile-demo";

export interface AuthState {
  authenticated: boolean;
  email: string;
  userId: string | null;
  mode: "supabase" | "demo";
}

function getDemoAuthState(): AuthState {
  const active =
    typeof window !== "undefined" && window.sessionStorage.getItem(DEMO_SESSION_KEY) === "true";
  return {
    authenticated: active,
    email: "",
    userId: null,
    mode: "demo",
  };
}

export async function getAuthState(): Promise<AuthState> {
  if (!isSupabaseConfigured || !supabase) {
    return getDemoAuthState();
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user) {
    return {
      authenticated: false,
      email: "",
      userId: null,
      mode: "supabase",
    };
  }

  return {
    authenticated: true,
    email: data.session.user.email ?? "",
    userId: data.session.user.id,
    mode: "supabase",
  };
}

export async function getAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) {
    return null;
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    return null;
  }
  return data.session.access_token;
}

export async function signInAdmin(email: string, password: string): Promise<AuthState> {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error || !data.user) {
    throw new Error(
      error?.message === "Invalid login credentials"
        ? "E-mail ou senha inválidos."
        : (error?.message ?? "Não foi possível entrar. Tente novamente."),
    );
  }

  return {
    authenticated: true,
    email: data.user.email ?? "",
    userId: data.user.id,
    mode: "supabase",
  };
}

export function enterDemoSession(): AuthState {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(DEMO_SESSION_KEY, "true");
  }
  return getDemoAuthState();
}

export async function signOutAdmin(): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw new Error(`Erro ao encerrar sessão: ${error.message}`);
    }
    return;
  }

  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(DEMO_SESSION_KEY);
  }
}

export function subscribeAuthChanges(callback: (state: AuthState) => void): () => void {
  if (!isSupabaseConfigured || !supabase) {
    return () => {};
  }

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    callback({
      authenticated: Boolean(session?.user),
      email: session?.user?.email ?? "",
      userId: session?.user?.id ?? null,
      mode: "supabase",
    });
  });

  return () => {
    subscription.unsubscribe();
  };
}
