import type { Request, Response, NextFunction } from "express"
import { getUserFromToken } from "../lib/supabase.js"

/**
 * Validates the `Authorization: Bearer <token>` header, resolves the user via
 * Supabase, and attaches `{ userId, email, appMetadata }` to `req.auth`.
 * Responds 401 when the token is missing or invalid.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" })
    return
  }
  const token = authHeader.slice("Bearer ".length).trim()

  const user = await getUserFromToken(token)
  if (!user) {
    res.status(401).json({ error: "invalid_token" })
    return
  }

  req.auth = user
  next()
}
