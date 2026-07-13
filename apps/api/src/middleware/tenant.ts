import type { Request, Response, NextFunction } from "express"

/**
 * Enforces tenant scoping: pulls `tenant_id` from the authenticated user's
 * app_metadata and stashes it in `res.locals.tenantId` for downstream queries.
 * Responds 403 `no_tenant` when no tenant is associated with the user.
 *
 * Must run after requireAuth (which populates req.auth).
 */
export function requireTenant(req: Request, res: Response, next: NextFunction) {
  const tenantId = req.auth?.appMetadata?.tenant_id
  if (!tenantId) {
    res.status(403).json({ error: "no_tenant" })
    return
  }
  res.locals.tenantId = tenantId
  next()
}
