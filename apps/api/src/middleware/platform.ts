import type { Request, Response, NextFunction } from "express"
import { requireAuth } from "./auth.js"

/**
 * Parses the PLATFORM_ADMIN_EMAILS env var (comma-separated) into a normalised
 * Set of lower-cased emails. Read lazily per request so tests can mutate the env
 * var before exercising the guard.
 */
function platformAdminEmails(): Set<string> {
  return new Set(
    (process.env.PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

/**
 * Authorises a *platform operator* (the SaaS owner) — someone acting ABOVE any
 * single tenant, e.g. to provision a brand-new tenant. This deliberately does
 * NOT use the tenant-scoped role gate (requireRole/requireHrAdmin), because a
 * platform operator has no tenant_id and no employees row.
 *
 * The allow-list lives in the PLATFORM_ADMIN_EMAILS env var (comma-separated).
 * Responds 403 `not_platform_operator` for any authenticated user not on it.
 *
 * Composed array form so it can be spread directly into a route:
 *   app.post("/admin/tenants", requirePlatformOperator, handler)
 */
export const requirePlatformOperator = [
  requireAuth,
  function platformOperatorGuard(req: Request, res: Response, next: NextFunction) {
    const email = req.auth?.email?.toLowerCase()
    if (!email || !platformAdminEmails().has(email)) {
      res.status(403).json({ error: "not_platform_operator" })
      return
    }
    next()
  },
]
