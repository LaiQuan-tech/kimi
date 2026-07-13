import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { defineConfig } from "vitest/config"

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    // Load the repo-root .env before any test module is imported, so eagerly
    // constructed Supabase clients (lib/supabase.ts) get real credentials.
    setupFiles: [resolve(__dirname, "src/__tests__/setup.ts")],
    // Integration tests hit a single live Supabase project. Run test files
    // serially (parallel beforeAll's trip Supabase's auth login-burst limit)
    // and allow generous timeouts for the network round-trips.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
})
