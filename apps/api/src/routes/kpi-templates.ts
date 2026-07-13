import { Router, type Request, type Response, type NextFunction } from "express"
import { z } from "zod"
import { requireAuth } from "../middleware/auth.js"
import { requireTenant } from "../middleware/tenant.js"
import { requireHrAdmin } from "../middleware/role.js"
import { supabaseAdmin } from "../lib/supabase.js"

export const kpiTemplatesRouter = Router()

// A scored line item: weights conventionally sum to 100 so a review totals 0–100.
const itemSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  weight: z.number().nonnegative(),
  maxScore: z.number().positive(),
})

const createSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  items: z.array(itemSchema).default([]),
  active: z.boolean().optional(),
})

// PATCH allows any subset; at least one field must be present.
const updateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    items: z.array(itemSchema).optional(),
    active: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "no fields to update" })

const SELECT_COLS = "id, tenant_id, name, items, active, created_at"

/**
 * KPI template routes. Reads are open to any authenticated member of the tenant
 * (employees/appraisers need the item definitions to render a review); create/
 * update/delete are HR-admin-only. The tenant boundary is the load-bearing guard:
 * every query is forced to res.locals.tenantId (from the JWT) so an HR admin can
 * only ever touch their own tenant's templates, even though supabaseAdmin
 * bypasses RLS.
 */

// GET /kpi-templates — list this tenant's templates (any tenant member).
kpiTemplatesRouter.get(
  "/kpi-templates",
  requireAuth,
  requireTenant,
  async (_req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    try {
      const { data, error } = await supabaseAdmin
        .from("kpi_templates")
        .select(SELECT_COLS)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true })

      if (error) {
        next(new Error(`GET /kpi-templates: ${error.message}`))
        return
      }
      res.status(200).json({ templates: data ?? [] })
    } catch (err) {
      next(err)
    }
  },
)

// POST /kpi-templates — create a template under this tenant (HR only).
kpiTemplatesRouter.post(
  "/kpi-templates",
  requireAuth,
  requireTenant,
  requireHrAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() })
      return
    }
    try {
      const { data, error } = await supabaseAdmin
        .from("kpi_templates")
        .insert({
          tenant_id: tenantId,
          name: parsed.data.name,
          items: parsed.data.items,
          active: parsed.data.active ?? true,
        })
        .select("id")
        .single()

      if (error || !data) {
        next(new Error(`POST /kpi-templates: ${error?.message}`))
        return
      }
      res.status(201).json({ id: data.id })
    } catch (err) {
      next(err)
    }
  },
)

// PATCH /kpi-templates/:id — update name/items/active (this tenant only; HR only).
kpiTemplatesRouter.patch(
  "/kpi-templates/:id",
  requireAuth,
  requireTenant,
  requireHrAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    const { id } = req.params
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() })
      return
    }

    const patch: Record<string, unknown> = {}
    if (parsed.data.name !== undefined) patch.name = parsed.data.name
    if (parsed.data.items !== undefined) patch.items = parsed.data.items
    if (parsed.data.active !== undefined) patch.active = parsed.data.active

    try {
      const { data, error } = await supabaseAdmin
        .from("kpi_templates")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select("id")
        .maybeSingle()

      if (error) {
        next(new Error(`PATCH /kpi-templates/${id}: ${error.message}`))
        return
      }
      if (!data) {
        res.status(404).json({ error: "not_found" })
        return
      }
      res.status(200).json({ id: data.id })
    } catch (err) {
      next(err)
    }
  },
)

// DELETE /kpi-templates/:id — remove a template (this tenant only; HR only); 409
// if any review still references it.
kpiTemplatesRouter.delete(
  "/kpi-templates/:id",
  requireAuth,
  requireTenant,
  requireHrAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    const { id } = req.params
    try {
      // Guard: block deletion while reviews still reference this template.
      const { count, error: countErr } = await supabaseAdmin
        .from("kpi_reviews")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("template_id", id)

      if (countErr) {
        next(new Error(`DELETE /kpi-templates/${id} (count): ${countErr.message}`))
        return
      }
      if ((count ?? 0) > 0) {
        res.status(409).json({ error: "template_in_use" })
        return
      }

      const { data, error } = await supabaseAdmin
        .from("kpi_templates")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select("id")
        .maybeSingle()

      if (error) {
        next(new Error(`DELETE /kpi-templates/${id}: ${error.message}`))
        return
      }
      if (!data) {
        res.status(404).json({ error: "not_found" })
        return
      }
      res.status(200).json({ id: data.id })
    } catch (err) {
      next(err)
    }
  },
)
