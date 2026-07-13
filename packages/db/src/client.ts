import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import * as schema from "./schema/index"

/**
 * Postgres / Drizzle client.
 *
 * The connection is created lazily on first access so that importing this
 * module in environments without DATABASE_URL (e.g. unit tests) does not throw.
 */
let _sql: ReturnType<typeof postgres> | undefined
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined

function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL
    if (!url) {
      throw new Error("Missing required env var: DATABASE_URL")
    }
    _sql = postgres(url)
    _db = drizzle(_sql, { schema })
  }
  return _db
}

/**
 * Lazy Drizzle db proxy. Resolves the real client only when a query method is
 * actually invoked, so a bare `import { db }` is side-effect free.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    const real = getDb()
    const value = Reflect.get(real as object, prop)
    return typeof value === "function" ? value.bind(real) : value
  },
})

/**
 * Supabase admin client (service_role key) — bypasses RLS. Use server-side only.
 * Lazily constructed; throws only when first accessed without env configured.
 */
let _supabaseAdmin: SupabaseClient | undefined
export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY")
    }
    _supabaseAdmin = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return _supabaseAdmin
}

/**
 * Supabase anon client (anon key) — used to verify end-user JWTs.
 * Lazily constructed; throws only when first accessed without env configured.
 */
let _supabaseAnon: SupabaseClient | undefined
export function getSupabaseAnon(): SupabaseClient {
  if (!_supabaseAnon) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_ANON_KEY
    if (!url || !key) {
      throw new Error("Missing required env vars: SUPABASE_URL, SUPABASE_ANON_KEY")
    }
    _supabaseAnon = createClient(url, key)
  }
  return _supabaseAnon
}

/**
 * Convenience accessors. Implemented as getters so module import stays
 * side-effect free; the underlying client is built on first property access.
 */
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const real = getSupabaseAdmin()
    const value = Reflect.get(real as object, prop)
    return typeof value === "function" ? value.bind(real) : value
  },
})

export const supabaseAnon: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const real = getSupabaseAnon()
    const value = Reflect.get(real as object, prop)
    return typeof value === "function" ? value.bind(real) : value
  },
})
