import { Router, type Request, type Response, type NextFunction } from "express"
import { z } from "zod"
import { requireAuth } from "../middleware/auth.js"
import { requireTenant } from "../middleware/tenant.js"
import { requireHrAdmin } from "../middleware/role.js"
import { supabaseAdmin } from "../lib/supabase.js"

export const recruitmentRouter = Router()

const dateRe = /^\d{4}-\d{2}-\d{2}$/

/**
 * Register HR-only, tenant-scoped CRUD for one recruitment resource at
 * /<segment>. `create`/`update` are zod schemas over the API (camelCase) shape;
 * `toRow` maps validated input to DB (snake_case) columns. `listFilters` maps a
 * query-param name to its DB column for optional GET filtering. Every query is
 * pinned to res.locals.tenantId — the load-bearing guard (supabaseAdmin bypasses
 * RLS).
 */
function hrCrud<C extends z.ZodTypeAny, U extends z.ZodTypeAny>(opts: {
  segment: string
  table: string
  cols: string
  create: C
  update: U
  toRow: (d: z.infer<C>) => Record<string, unknown>
  toPatch: (d: z.infer<U>) => Record<string, unknown>
  listFilters?: Record<string, string>
  orderBy?: string
}) {
  const { segment, table, cols, create, update, toRow, toPatch } = opts
  const order = opts.orderBy ?? "created_at"

  recruitmentRouter.get(
    `/${segment}`,
    requireAuth,
    requireTenant,
    requireHrAdmin,
    async (req: Request, res: Response, next: NextFunction) => {
      const tenantId = res.locals.tenantId as string
      try {
        let query = supabaseAdmin.from(table).select(cols).eq("tenant_id", tenantId)
        for (const [param, col] of Object.entries(opts.listFilters ?? {})) {
          const v = req.query[param]
          if (typeof v === "string" && v.length > 0) query = query.eq(col, v)
        }
        const { data, error } = await query.order(order, { ascending: false })
        if (error) {
          next(new Error(`GET /${segment}: ${error.message}`))
          return
        }
        res.status(200).json({ [segment]: data ?? [] })
      } catch (err) {
        next(err)
      }
    },
  )

  recruitmentRouter.post(
    `/${segment}`,
    requireAuth,
    requireTenant,
    requireHrAdmin,
    async (req: Request, res: Response, next: NextFunction) => {
      const tenantId = res.locals.tenantId as string
      const parsed = create.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() })
        return
      }
      try {
        const { data, error } = await supabaseAdmin
          .from(table)
          .insert({ tenant_id: tenantId, ...toRow(parsed.data) })
          .select("id")
          .single()
        if (error || !data) {
          next(new Error(`POST /${segment}: ${error?.message}`))
          return
        }
        res.status(201).json({ id: data.id })
      } catch (err) {
        next(err)
      }
    },
  )

  recruitmentRouter.patch(
    `/${segment}/:id`,
    requireAuth,
    requireTenant,
    requireHrAdmin,
    async (req: Request, res: Response, next: NextFunction) => {
      const tenantId = res.locals.tenantId as string
      const id = req.params.id
      const parsed = update.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() })
        return
      }
      const patch = toPatch(parsed.data)
      if (Object.keys(patch).length === 0) {
        res.status(400).json({ error: "no_fields_to_update" })
        return
      }
      try {
        const { data, error } = await supabaseAdmin
          .from(table)
          .update(patch)
          .eq("tenant_id", tenantId)
          .eq("id", id)
          .select("id")
          .maybeSingle()
        if (error) {
          next(new Error(`PATCH /${segment}/${id}: ${error.message}`))
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

  recruitmentRouter.delete(
    `/${segment}/:id`,
    requireAuth,
    requireTenant,
    requireHrAdmin,
    async (req: Request, res: Response, next: NextFunction) => {
      const tenantId = res.locals.tenantId as string
      const id = req.params.id
      try {
        const { data, error } = await supabaseAdmin
          .from(table)
          .delete()
          .eq("tenant_id", tenantId)
          .eq("id", id)
          .select("id")
          .maybeSingle()
        if (error) {
          next(new Error(`DELETE /${segment}/${id}: ${error.message}`))
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
}

const str = z.string().trim().min(1)
const optStr = z.string().trim().nullish()

/* ---- 職缺需求單 job_requisitions ---- */
hrCrud({
  segment: "job-requisitions",
  table: "job_requisitions",
  cols: "id, tenant_id, title, dept_id, headcount, employment_type, description, status, is_internal, created_by_emp_id, created_at",
  listFilters: { status: "status", isInternal: "is_internal" },
  create: z.object({
    title: str,
    deptId: z.string().uuid().nullish(),
    headcount: z.number().int().positive().optional(),
    employmentType: optStr,
    description: optStr,
    status: z.enum(["draft", "pending_approval", "open", "closed"]).optional(),
    isInternal: z.boolean().optional(),
  }),
  update: z.object({
    title: str.optional(),
    deptId: z.string().uuid().nullable().optional(),
    headcount: z.number().int().positive().optional(),
    employmentType: z.string().trim().nullable().optional(),
    description: z.string().trim().nullable().optional(),
    status: z.enum(["draft", "pending_approval", "open", "closed"]).optional(),
    isInternal: z.boolean().optional(),
  }),
  toRow: (d) => ({
    title: d.title,
    dept_id: d.deptId ?? null,
    headcount: d.headcount ?? 1,
    employment_type: d.employmentType ?? "regular",
    description: d.description ?? null,
    status: d.status ?? "open",
    is_internal: d.isInternal ?? false,
  }),
  toPatch: (d) => {
    const p: Record<string, unknown> = {}
    if (d.title !== undefined) p.title = d.title
    if (d.deptId !== undefined) p.dept_id = d.deptId
    if (d.headcount !== undefined) p.headcount = d.headcount
    if (d.employmentType !== undefined) p.employment_type = d.employmentType
    if (d.description !== undefined) p.description = d.description
    if (d.status !== undefined) p.status = d.status
    if (d.isInternal !== undefined) p.is_internal = d.isInternal
    return p
  },
})

/* ---- 人才庫 candidates ---- */
hrCrud({
  segment: "candidates",
  table: "candidates",
  cols: "id, tenant_id, requisition_id, name, email, phone, source, resume_url, status, note, created_at",
  listFilters: { requisitionId: "requisition_id", status: "status" },
  create: z.object({
    name: str,
    requisitionId: z.string().uuid().nullish(),
    email: optStr,
    phone: optStr,
    source: optStr,
    resumeUrl: optStr,
    status: z.enum(["new", "screening", "interviewing", "offered", "hired", "rejected"]).optional(),
    note: optStr,
  }),
  update: z.object({
    name: str.optional(),
    requisitionId: z.string().uuid().nullable().optional(),
    email: z.string().trim().nullable().optional(),
    phone: z.string().trim().nullable().optional(),
    source: z.string().trim().nullable().optional(),
    resumeUrl: z.string().trim().nullable().optional(),
    status: z.enum(["new", "screening", "interviewing", "offered", "hired", "rejected"]).optional(),
    note: z.string().trim().nullable().optional(),
  }),
  toRow: (d) => ({
    name: d.name,
    requisition_id: d.requisitionId ?? null,
    email: d.email ?? null,
    phone: d.phone ?? null,
    source: d.source ?? null,
    resume_url: d.resumeUrl ?? null,
    status: d.status ?? "new",
    note: d.note ?? null,
  }),
  toPatch: (d) => {
    const p: Record<string, unknown> = {}
    if (d.name !== undefined) p.name = d.name
    if (d.requisitionId !== undefined) p.requisition_id = d.requisitionId
    if (d.email !== undefined) p.email = d.email
    if (d.phone !== undefined) p.phone = d.phone
    if (d.source !== undefined) p.source = d.source
    if (d.resumeUrl !== undefined) p.resume_url = d.resumeUrl
    if (d.status !== undefined) p.status = d.status
    if (d.note !== undefined) p.note = d.note
    return p
  },
})

/* ---- 面試 interviews (紀錄 + 行事曆) ---- */
hrCrud({
  segment: "interviews",
  table: "interviews",
  cols: "id, tenant_id, candidate_id, interviewer_emp_id, scheduled_at, stage, result, notes, created_at",
  listFilters: { candidateId: "candidate_id", interviewerEmpId: "interviewer_emp_id", result: "result" },
  orderBy: "scheduled_at",
  create: z.object({
    candidateId: z.string().uuid(),
    interviewerEmpId: z.string().uuid().nullish(),
    scheduledAt: z.string().datetime().nullish(),
    stage: optStr,
    result: z.enum(["pending", "pass", "fail"]).optional(),
    notes: optStr,
  }),
  update: z.object({
    interviewerEmpId: z.string().uuid().nullable().optional(),
    scheduledAt: z.string().datetime().nullable().optional(),
    stage: z.string().trim().nullable().optional(),
    result: z.enum(["pending", "pass", "fail"]).optional(),
    notes: z.string().trim().nullable().optional(),
  }),
  toRow: (d) => ({
    candidate_id: d.candidateId,
    interviewer_emp_id: d.interviewerEmpId ?? null,
    scheduled_at: d.scheduledAt ?? null,
    stage: d.stage ?? null,
    result: d.result ?? "pending",
    notes: d.notes ?? null,
  }),
  toPatch: (d) => {
    const p: Record<string, unknown> = {}
    if (d.interviewerEmpId !== undefined) p.interviewer_emp_id = d.interviewerEmpId
    if (d.scheduledAt !== undefined) p.scheduled_at = d.scheduledAt
    if (d.stage !== undefined) p.stage = d.stage
    if (d.result !== undefined) p.result = d.result
    if (d.notes !== undefined) p.notes = d.notes
    return p
  },
})

/* ---- 錄用 offers ---- */
hrCrud({
  segment: "offers",
  table: "offers",
  cols: "id, tenant_id, candidate_id, salary, start_date, status, note, created_at",
  listFilters: { candidateId: "candidate_id", status: "status" },
  create: z.object({
    candidateId: z.string().uuid(),
    salary: z.number().nonnegative().nullish(),
    startDate: z.string().regex(dateRe).nullish(),
    status: z.enum(["draft", "approved", "sent", "accepted", "declined"]).optional(),
    note: optStr,
  }),
  update: z.object({
    salary: z.number().nonnegative().nullable().optional(),
    startDate: z.string().regex(dateRe).nullable().optional(),
    status: z.enum(["draft", "approved", "sent", "accepted", "declined"]).optional(),
    note: z.string().trim().nullable().optional(),
  }),
  toRow: (d) => ({
    candidate_id: d.candidateId,
    salary: d.salary ?? null,
    start_date: d.startDate ?? null,
    status: d.status ?? "draft",
    note: d.note ?? null,
  }),
  toPatch: (d) => {
    const p: Record<string, unknown> = {}
    if (d.salary !== undefined) p.salary = d.salary
    if (d.startDate !== undefined) p.start_date = d.startDate
    if (d.status !== undefined) p.status = d.status
    if (d.note !== undefined) p.note = d.note
    return p
  },
})

/**
 * GET /internal-jobs — 內部職缺. Readable by ANY authenticated tenant member
 * (not HR-only): the open, internal-flagged requisitions employees may apply to.
 */
recruitmentRouter.get(
  "/internal-jobs",
  requireAuth,
  requireTenant,
  async (_req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    try {
      const { data, error } = await supabaseAdmin
        .from("job_requisitions")
        .select("id, title, dept_id, headcount, employment_type, description, created_at")
        .eq("tenant_id", tenantId)
        .eq("is_internal", true)
        .eq("status", "open")
        .order("created_at", { ascending: false })
      if (error) {
        next(new Error(`GET /internal-jobs: ${error.message}`))
        return
      }
      res.status(200).json({ internalJobs: data ?? [] })
    } catch (err) {
      next(err)
    }
  },
)
