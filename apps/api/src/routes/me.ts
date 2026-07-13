import { Router, type Request, type Response, type NextFunction } from "express"
import { requireAuth } from "../middleware/auth.js"
import { requireTenant } from "../middleware/tenant.js"
import { supabaseAdmin } from "../lib/supabase.js"

export const meRouter = Router()

/**
 * GET /me — the authenticated caller's own employee profile in their tenant.
 *
 * Resolves the employees row from req.auth.userId + res.locals.tenantId (both
 * derived from the JWT, so a user can only ever read themselves). Returns
 * { id, name, role, deptId, empNo, status, email } — email comes from the auth
 * user, the rest from the employees row. 404 when the token's user has no
 * employee row in this tenant (e.g. a platform operator with no staff record).
 *
 * Open to any authenticated tenant member: the ESS uses it to detect HR admins
 * (to surface the back-office link) and the admin console uses it as its gate.
 */
meRouter.get(
  "/me",
  requireAuth,
  requireTenant,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    const userId = req.auth?.userId
    if (!userId) {
      res.status(401).json({ error: "unauthorized" })
      return
    }

    try {
      const { data, error } = await supabaseAdmin
        .from("employees")
        .select("id, name, role, dept_id, emp_no, status")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .maybeSingle()

      if (error) {
        next(new Error(`GET /me: ${error.message}`))
        return
      }
      if (!data) {
        res.status(404).json({ error: "not_found" })
        return
      }

      res.status(200).json({
        id: data.id,
        name: data.name,
        role: data.role,
        deptId: data.dept_id,
        empNo: data.emp_no,
        status: data.status,
        email: req.auth?.email ?? null,
      })
    } catch (err) {
      next(err)
    }
  },
)
