import { Router, type Request, type Response, type NextFunction } from "express"
import { z } from "zod"
import { requireAuth } from "../middleware/auth.js"
import { requireTenant } from "../middleware/tenant.js"
import { requireHrAdmin } from "../middleware/role.js"
import { scanMissingPunches, detectAnomalies, computeLateStats } from "../services/detection.js"

export const detectionRouter = Router()

// "YYYY-MM-DD".
const dateRe = /^\d{4}-\d{2}-\d{2}$/

const scanSchema = z.object({
  date: z.string().regex(dateRe, "date must be YYYY-MM-DD"),
})

const windowQuery = z.object({
  from: z.string().regex(dateRe, "from must be YYYY-MM-DD"),
  to: z.string().regex(dateRe, "to must be YYYY-MM-DD"),
})

const lateStatsQuery = z.object({
  from: z.string().regex(dateRe, "from must be YYYY-MM-DD"),
  to: z.string().regex(dateRe, "to must be YYYY-MM-DD"),
  deptId: z.string().uuid().optional(),
  trendPeriods: z.coerce.number().int().min(1).max(24).optional(),
})

/**
 * All detection routes are HR-admin-only and tenant-scoped (the service forces
 * the tenant filter on every query). They drive the P4 rule-based engine on
 * demand; a worker cron will later call the same services.
 */

/**
 * POST /attendance/scan-missing-punch { date } — run the忘打卡 scan for `date`
 * and enqueue an in-app notification per finding. Returns { missing, queued }.
 */
detectionRouter.post(
  "/attendance/scan-missing-punch",
  requireAuth,
  requireTenant,
  requireHrAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    const parsed = scanSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() })
      return
    }
    try {
      const result = await scanMissingPunches(tenantId, parsed.data.date)
      res.status(200).json(result)
    } catch (err) {
      next(err)
    }
  },
)

/**
 * GET /attendance/anomalies?from=&to= — flag connected-late streaks, frequent
 * missing punches and over-cap overtime for the window. Returns { anomalies }.
 */
detectionRouter.get(
  "/attendance/anomalies",
  requireAuth,
  requireTenant,
  requireHrAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    const parsed = windowQuery.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() })
      return
    }
    try {
      const { anomalies } = await detectAnomalies(tenantId, {
        from: parsed.data.from,
        to: parsed.data.to,
      })
      res.status(200).json({ anomalies })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * GET /attendance/late-stats?from=&to=&deptId=&trendPeriods= — per-employee late
 * roll-up (+ optional monthly trend). Returns { rows, trend }.
 */
detectionRouter.get(
  "/attendance/late-stats",
  requireAuth,
  requireTenant,
  requireHrAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    const parsed = lateStatsQuery.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() })
      return
    }
    try {
      const result = await computeLateStats(tenantId, parsed.data)
      res.status(200).json(result)
    } catch (err) {
      next(err)
    }
  },
)
