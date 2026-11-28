import { ACTIVE_STORE_SLUG } from "@/config/store.config";
import { isSupabaseConfigured, requireSupabase, supabase } from "@/lib/supabase";
import { WRONG_STORE_ACCOUNT_ERROR, isUserAuthorizedForStore } from "@/lib/tenant-auth";

export { WRONG_STORE_ACCOUNT_ERROR, isUserAuthorizedForStore };

const DEMO_SESSION_KEY = `store-demo-session-${ACTIVE_STORE_SLUG}`;

export interface AuthState {
  authenticated: boolean;
  email: string;
  userId: string | null;
  mode: "supabase" | "demo";
  unauthorizedStore?: boolean | undefined;
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

  const user = data.session.user;
  if (!isUserAuthorizedForStore(user.user_metadata)) {
    await supabase.auth.signOut();
    return {
      authenticated: false,
      email: "",
      userId: null,
      mode: "supabase",
      unauthorizedStore: true,
    };
  }

  return {
    authenticated: true,
    email: user.email ?? "",
    userId: user.id,
    mode: "supabase",
  };
}

export async function getAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) {
    return null;
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token || !data.session.user) {
    return null;
  }
  if (!isUserAuthorizedForStore(data.session.user.user_metadata)) {
    await supabase.auth.signOut();
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

  if (!isUserAuthorizedForStore(data.user.user_metadata)) {
    await client.auth.signOut();
    throw new Error(WRONG_STORE_ACCOUNT_ERROR);
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

  const client = supabase;
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    if (user && !isUserAuthorizedForStore(user.user_metadata)) {
      void client.auth.signOut();
      callback({
        authenticated: false,
        email: "",
        userId: null,
        mode: "supabase",
        unauthorizedStore: true,
      });
      return;
    }

    callback({
      authenticated: Boolean(user),
      email: user?.email ?? "",
      userId: user?.id ?? null,
      mode: "supabase",
    });
  });

  return () => {
    subscription.unsubscribe();
  };
}
