import type { AuthedUser } from "../lib/supabase"

declare global {
  namespace Express {
    interface Request {
      auth?: AuthedUser
    }
  }
}

export {}
