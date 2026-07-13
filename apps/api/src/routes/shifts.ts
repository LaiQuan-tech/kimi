import { Router, type Request, type Response, type NextFunction } from "express"
import { z } from "zod"
import { requireAuth } from "../middleware/auth.js"
import { requireTenant } from "../middleware/tenant.js"
import { requireHrAdmin } from "../middleware/role.js"
import { supabaseAdmin } from "../lib/supabase.js"

export const shiftsRouter = Router()

// "HH:MM" 24-hour clock (00:00–23:59).
const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/

const createSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  startTime: z.string().regex(timeRe, "startTime must be HH:MM"),
  endTime: z.string().regex(timeRe, "endTime must be HH:MM"),
  breakMinutes: z.number().int().min(0).optional(),
  isNightShift: z.boolean().optional(),
})

// PATCH allows any subset; at least one field must be present.
const updateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    startTime: z.string().regex(timeRe, "startTime must be HH:MM").optional(),
    endTime: z.string().regex(timeRe, "endTime must be HH:MM").optional(),
    breakMinutes: z.number().int().min(0).optional(),
    isNightShift: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "no fields to update" })

/**
 * Shift WRITE routes are HR-admin-only and tenant-scoped. As with departments,
 * the tenant boundary is the load-bearing guard: every query is forced to
 * res.locals.tenantId (from the JWT) so an HR admin can only ever touch their
 * own tenant's shifts, even though supabaseAdmin bypasses RLS.
 */

// GET /shifts — list this tenant's shifts. Readable by ANY tenant member
// (matches the shifts_tenant_read RLS policy): employees need shift names to
// render their 個人班表.
shiftsRouter.get(
  "/shifts",
  requireAuth,
  requireTenant,
  async (_req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    try {
      const { data, error } = await supabaseAdmin
        .from("shifts")
        .select("id, tenant_id, name, start_time, end_time, break_minutes, is_night_shift, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true })

      if (error) {
        next(new Error(`GET /shifts: ${error.message}`))
        return
      }
      res.status(200).json({ shifts: data ?? [] })
    } catch (err) {
      next(err)
    }
  },
)

// POST /shifts — create a shift under this tenant.
shiftsRouter.post(
  "/shifts",
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
        .from("shifts")
        .insert({
          tenant_id: tenantId,
          name: parsed.data.name,
          start_time: parsed.data.startTime,
          end_time: parsed.data.endTime,
          break_minutes: parsed.data.breakMinutes ?? 0,
          is_night_shift: parsed.data.isNightShift ?? false,
        })
        .select("id")
        .single()

      if (error || !data) {
        next(new Error(`POST /shifts: ${error?.message}`))
        return
      }
      res.status(201).json({ id: data.id })
    } catch (err) {
      next(err)
    }
  },
)

// PATCH /shifts/:id — update fields (this tenant only). 404 when not in tenant.
shiftsRouter.patch(
  "/shifts/:id",
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
    if (parsed.data.startTime !== undefined) patch.start_time = parsed.data.startTime
    if (parsed.data.endTime !== undefined) patch.end_time = parsed.data.endTime
    if (parsed.data.breakMinutes !== undefined) patch.break_minutes = parsed.data.breakMinutes
    if (parsed.data.isNightShift !== undefined) patch.is_night_shift = parsed.data.isNightShift

    try {
      const { data, error } = await supabaseAdmin
        .from("shifts")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select("id")
        .maybeSingle()

      if (error) {
        next(new Error(`PATCH /shifts/${id}: ${error.message}`))
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

// DELETE /shifts/:id — remove a shift (this tenant only). Any schedules that
// referenced it keep their row with shift_id set to NULL (the FK is ON DELETE
// no action, so we null out references first to avoid a constraint violation).
shiftsRouter.delete(
  "/shifts/:id",
  requireAuth,
  requireTenant,
  requireHrAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    const { id } = req.params
    try {
      // Detach any schedules pointing at this shift (within the tenant) so the
      // delete cannot fail on the shift_id FK.
      const { error: detachErr } = await supabaseAdmin
        .from("schedules")
        .update({ shift_id: null })
        .eq("tenant_id", tenantId)
        .eq("shift_id", id)
      if (detachErr) {
        next(new Error(`DELETE /shifts/${id} (detach): ${detachErr.message}`))
        return
      }

      const { data, error } = await supabaseAdmin
        .from("shifts")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select("id")
        .maybeSingle()

      if (error) {
        next(new Error(`DELETE /shifts/${id}: ${error.message}`))
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
