import { Router, type Request, type Response, type NextFunction } from "express"
import { z } from "zod"
import { requireAuth } from "../middleware/auth.js"
import { requireTenant } from "../middleware/tenant.js"
import { requireHrAdmin } from "../middleware/role.js"
import { supabaseAdmin } from "../lib/supabase.js"

export const approvalFlowsRouter = Router()

// The request kinds an approval flow can apply to (mirrors KINDS in requests.ts).
const kindSchema = z.enum(["leave", "ot", "fix_punch", "business_trip"])

const putSchema = z.object({
  // Ordered list of approver employee ids; [] means "no flow → fall back to HR".
  approverEmpIds: z.array(z.string().uuid()).default([]),
})

const SELECT_COLS = "id, tenant_id, applies_to, approver_emp_ids, created_at"

/**
 * Approval-flow routes are HR-admin-only and tenant-scoped. A flow is the
 * per-kind, ordered list of approver employee ids; PUT upserts on the
 * (tenant_id, applies_to) unique index so each kind has exactly one flow.
 */

// GET /approval-flows — list every configured flow for this tenant.
approvalFlowsRouter.get(
  "/approval-flows",
  requireAuth,
  requireTenant,
  requireHrAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    try {
      const { data, error } = await supabaseAdmin
        .from("approval_flows")
        .select(SELECT_COLS)
        .eq("tenant_id", tenantId)
        .order("applies_to", { ascending: true })

      if (error) {
        next(new Error(`GET /approval-flows: ${error.message}`))
        return
      }
      res.status(200).json({ flows: data ?? [] })
    } catch (err) {
      next(err)
    }
  },
)

// PUT /approval-flows/:kind — set (upsert) the approver chain for one kind.
approvalFlowsRouter.put(
  "/approval-flows/:kind",
  requireAuth,
  requireTenant,
  requireHrAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    const kindParsed = kindSchema.safeParse(req.params.kind)
    if (!kindParsed.success) {
      res.status(400).json({ error: "invalid_kind" })
      return
    }
    const kind = kindParsed.data
    const parsed = putSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() })
      return
    }

    try {
      const { data, error } = await supabaseAdmin
        .from("approval_flows")
        .upsert(
          {
            tenant_id: tenantId,
            applies_to: kind,
            approver_emp_ids: parsed.data.approverEmpIds,
          },
          { onConflict: "tenant_id,applies_to" },
        )
        .select("id, applies_to, approver_emp_ids")
        .single()

      if (error || !data) {
        next(new Error(`PUT /approval-flows/${kind}: ${error?.message}`))
        return
      }
      res.status(200).json({
        id: data.id,
        appliesTo: data.applies_to,
        approverEmpIds: data.approver_emp_ids,
      })
    } catch (err) {
      next(err)
    }
  },
)
