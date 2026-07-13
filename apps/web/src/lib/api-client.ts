/**
 * Thin fetch wrapper for talking to the @hr/api service.
 *
 * Base URL comes from NEXT_PUBLIC_API_URL (defaults to local dev API).
 * Automatically attaches `Authorization: Bearer <token>` using the current
 * Supabase browser session, so callers don't have to thread the token through.
 */
import { getSupabaseBrowser } from "./supabase-browser";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Resolve the auth token from the live Supabase session (browser only).
 * Returns null when there is no session (caller goes out unauthenticated and
 * the API answers 401, which the UI turns into a redirect to /login).
 */
async function getAuthToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const supabase = getSupabaseBrowser();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Core fetcher: prepends the API base URL, attaches the bearer token, sets a
 * JSON content-type and throws on any non-2xx response (message taken from the
 * API's { error } / { message } body when present).
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...fetchOptions } = options;
  const authToken = token ?? (await getAuthToken());

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...((fetchOptions.headers as Record<string, string>) ?? {}),
  };

  const res = await fetch(`${API_URL}${path}`, { ...fetchOptions, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const message = body.error ?? body.message ?? res.statusText;
    const err = new Error(`[${res.status}] ${message}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  // 204 / empty bodies → undefined.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Back-compat alias for existing callers.
export const apiClient = apiFetch;

/**
 * Download an authenticated file (e.g. CSV export): fetches with the bearer
 * token and triggers a browser download. Throws on non-2xx.
 */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const token = await (async () => {
    const supabase = getSupabaseBrowser();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  })();
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`下載失敗 (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
