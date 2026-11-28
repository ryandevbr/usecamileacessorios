import { ACTIVE_STORE_SLUG } from "@/config/store.config";

export const WRONG_STORE_ACCOUNT_ERROR = "Esta conta administrativa pertence a outra loja.";

/**
 * Verifica se o usuário autenticado no Supabase Auth tem permissão para acessar
 * o painel administrativo da loja ativa (`activeSlug`).
 *
 * Regras:
 * - `role === "superadmin"` -> acesso liberado para todas as lojas.
 * - `store_slug` ausente/vazio ou `"*"` -> acesso liberado (compatibilidade / superacesso).
 * - `store_slug` definido -> deve coincidir (case-insensitive) com `activeSlug`.
 */
export function isUserAuthorizedForStore(
  userMetadata: Record<string, unknown> | null | undefined,
  activeSlug: string = ACTIVE_STORE_SLUG,
): boolean {
  if (!userMetadata || typeof userMetadata !== "object") {
    return true;
  }

  const rawRole = userMetadata["role"];
  const role = typeof rawRole === "string" ? rawRole.trim().toLowerCase() : "";
  if (role === "superadmin") {
    return true;
  }

  const rawStoreSlug = userMetadata["store_slug"];
  if (typeof rawStoreSlug !== "string") {
    return true;
  }

  const normalizedUserSlug = rawStoreSlug.trim().toLowerCase();
  if (!normalizedUserSlug || normalizedUserSlug === "*") {
    return true;
  }

  return normalizedUserSlug === activeSlug.trim().toLowerCase();
}
