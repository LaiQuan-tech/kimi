import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import dotenv from "dotenv"

// Runs before every test module is imported (configured as a vitest setupFile),
// so modules that build Supabase clients at import time (lib/supabase.ts) see
// real credentials. This file lives at apps/api/src/__tests__/setup.ts → the
// repo root is four levels up.
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, "../../../../.env") })
