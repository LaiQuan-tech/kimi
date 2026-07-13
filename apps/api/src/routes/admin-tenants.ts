import { Router, type Request, type Response, type NextFunction } from "express"
import { z } from "zod"
import { requirePlatformOperator } from "../middleware/platform.js"
import { provisionTenant } from "../services/tenants.js"

const bodySchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  adminEmail: z.string().trim().email("adminEmail must be a valid email"),
  adminPassword: z.string().min(8, "adminPassword must be at least 8 characters"),
})

export const adminTenantsRouter = Router()

/**
 * POST /admin/tenants — platform-operator-only tenant onboarding.
 * Body: { name, adminEmail, adminPassword }. Returns 201 { tenantId }.
 */
adminTenantsRouter.post(
  "/admin/tenants",
  ...requirePlatformOperator,
  async (req: Request, res: Response, next: NextFunction) => {
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() })
      return
    }
    try {
      const { tenantId } = await provisionTenant(parsed.data)
      res.status(201).json({ tenantId })
    } catch (err) {
      next(err)
    }
  },
)
