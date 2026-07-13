"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { useSession } from "@/lib/use-session";

export default function LoginPage() {
  const router = useRouter();
  const { session, loading } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const resolveLoginEmail = (value: string) => {
    const normalized = value.trim();
    return normalized.toLowerCase() === "demo" ? "demo@daoteng.demo" : normalized;
  };

  // Already signed in → skip the form.
  useEffect(() => {
    if (!loading && session) router.replace("/ess");
  }, [loading, session, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: resolveLoginEmail(email),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      router.replace("/ess");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登入失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm border border-gray-100"
      >
        <h1
          className="text-2xl font-bold mb-1"
          style={{ color: "var(--brand)" }}
        >
          員工登入
        </h1>
        <p className="text-sm text-gray-500 mb-6">HR 差勤系統 · 員工自助</p>

        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">
          Email / 帳號
        </label>
        <input
          id="email"
          type="text"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
        />
        <p className="-mt-2 mb-4 text-xs text-gray-400">Demo 可直接輸入 demo。</p>

        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="password">
          密碼
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
        />

        {error && (
          <p className="text-sm text-red-600 mb-4" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md py-2.5 font-medium text-white disabled:opacity-60"
          style={{ backgroundColor: "var(--brand)" }}
        >
          {submitting ? "登入中…" : "登入"}
        </button>
      </form>
    </main>
  );
}
