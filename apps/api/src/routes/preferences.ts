import { Router, type Request, type Response, type NextFunction } from "express"
import { z } from "zod"
import { requireAuth } from "../middleware/auth.js"
import { requireTenant } from "../middleware/tenant.js"
import { supabaseAdmin } from "../lib/supabase.js"

export const preferencesRouter = Router()

const keySchema = z.string().regex(/^[a-z0-9._:-]{1,120}$/)
const savePreferenceSchema = z.object({
  value: z.unknown().refine((value) => value !== undefined, "value is required"),
})

const PREF_COLS = "id, tenant_id, employee_id, key, value, created_at, updated_at"

async function resolveEmployeeId(tenantId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("employees")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`resolve preference employee: ${error.message}`)
  return data?.id ?? null
}

preferencesRouter.get(
  "/preferences/:key",
  requireAuth,
  requireTenant,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    const userId = req.auth?.userId
    const parsedKey = keySchema.safeParse(req.params.key)
    if (!parsedKey.success) {
      res.status(400).json({ error: "invalid_key" })
      return
    }
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
        .from("user_preferences")
        .select(PREF_COLS)
        .eq("tenant_id", tenantId)
        .eq("employee_id", employeeId)
        .eq("key", parsedKey.data)
        .maybeSingle()

      if (error) {
        next(new Error(`GET /preferences/${parsedKey.data}: ${error.message}`))
        return
      }

      res.status(200).json({
        preference:
          data ??
          {
            id: null,
            tenant_id: tenantId,
            employee_id: employeeId,
            key: parsedKey.data,
            value: null,
            created_at: null,
            updated_at: null,
          },
      })
    } catch (err) {
      next(err)
    }
  },
)

preferencesRouter.put(
  "/preferences/:key",
  requireAuth,
  requireTenant,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    const userId = req.auth?.userId
    const parsedKey = keySchema.safeParse(req.params.key)
    if (!parsedKey.success) {
      res.status(400).json({ error: "invalid_key" })
      return
    }
    if (!userId) {
      res.status(401).json({ error: "unauthorized" })
      return
    }

    const parsed = savePreferenceSchema.safeParse(req.body)
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
        .from("user_preferences")
        .upsert(
          {
            tenant_id: tenantId,
            employee_id: employeeId,
            key: parsedKey.data,
            value: parsed.data.value,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,employee_id,key" },
        )
        .select(PREF_COLS)
        .single()

      if (error || !data) {
        next(new Error(`PUT /preferences/${parsedKey.data}: ${error?.message}`))
        return
      }

      res.status(200).json({ preference: data })
    } catch (err) {
      next(err)
    }
  },
)
