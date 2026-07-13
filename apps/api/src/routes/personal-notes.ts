import { Router, type Request, type Response, type NextFunction } from "express"
import { z } from "zod"
import { requireAuth } from "../middleware/auth.js"
import { requireTenant } from "../middleware/tenant.js"
import { supabaseAdmin } from "../lib/supabase.js"

export const personalNotesRouter = Router()

const saveNoteSchema = z.object({
  body: z.string().max(4000, "body is too long").optional().default(""),
})

const NOTE_COLS = "id, tenant_id, employee_id, body, created_at, updated_at"

async function resolveEmployeeId(tenantId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("employees")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`resolve personal note employee: ${error.message}`)
  return data?.id ?? null
}

personalNotesRouter.get(
  "/personal-note",
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
      const employeeId = await resolveEmployeeId(tenantId, userId)
      if (!employeeId) {
        res.status(404).json({ error: "employee_not_found" })
        return
      }

      const { data, error } = await supabaseAdmin
        .from("personal_notes")
        .select(NOTE_COLS)
        .eq("tenant_id", tenantId)
        .eq("employee_id", employeeId)
        .maybeSingle()

      if (error) {
        next(new Error(`GET /personal-note: ${error.message}`))
        return
      }

      res.status(200).json({
        note:
          data ??
          {
            id: null,
            tenant_id: tenantId,
            employee_id: employeeId,
            body: "",
            created_at: null,
            updated_at: null,
          },
      })
    } catch (err) {
      next(err)
    }
  },
)

personalNotesRouter.put(
  "/personal-note",
  requireAuth,
  requireTenant,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    const userId = req.auth?.userId
    if (!userId) {
      res.status(401).json({ error: "unauthorized" })
      return
    }

    const parsed = saveNoteSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() })
      return
    }

    try {
      const employeeId = await resolveEmployeeId(tenantId, userId)
      if (!employeeId) {
        res.status(404).json({ error: "employee_not_found" })
        return
      }

      const { data, error } = await supabaseAdmin
        .from("personal_notes")
        .upsert(
          {
            tenant_id: tenantId,
            employee_id: employeeId,
            body: parsed.data.body,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,employee_id" },
        )
        .select(NOTE_COLS)
        .single()

      if (error || !data) {
        next(new Error(`PUT /personal-note: ${error?.message}`))
        return
      }

      res.status(200).json({ note: data })
    } catch (err) {
      next(err)
    }
  },
)
