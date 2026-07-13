import { Router, type Request, type Response, type NextFunction } from "express"
import { z } from "zod"
import { requireAuth } from "../middleware/auth.js"
import { requireTenant } from "../middleware/tenant.js"
import { requireHrAdmin } from "../middleware/role.js"
import { supabaseAdmin } from "../lib/supabase.js"

export const departmentsRouter = Router()

const createSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  parentId: z.string().uuid().nullish(),
  managerEmpId: z.string().uuid().nullish(),
})

// PATCH allows any subset; at least one field must be present.
const updateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    parentId: z.string().uuid().nullable().optional(),
    managerEmpId: z.string().uuid().nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "no fields to update" })

function departmentCode(id: string): string {
  return `D-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`
}

function managerLabel(employee: { name?: string | null; emp_no?: string | null } | undefined): string | null {
  if (!employee?.name) return null
  return employee.emp_no ? `${employee.emp_no} · ${employee.name}` : employee.name
}

/**
 * All department routes are HR-admin-only and tenant-scoped. The tenant boundary
 * is the load-bearing guard: every query is forced to res.locals.tenantId (from
 * the JWT) so an HR admin can only ever touch their own tenant's departments,
 * even though supabaseAdmin bypasses RLS.
 */

// GET /departments — list this tenant's departments.
departmentsRouter.get(
  "/departments",
  requireAuth,
  requireTenant,
  requireHrAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    try {
      const [deptRes, employeeRes] = await Promise.all([
        supabaseAdmin
        .from("departments")
        .select("id, tenant_id, parent_id, name, manager_emp_id, created_at")
        .eq("tenant_id", tenantId)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("employees")
          .select("id, name, emp_no")
          .eq("tenant_id", tenantId),
      ])

      if (deptRes.error) {
        next(new Error(`GET /departments: ${deptRes.error.message}`))
        return
      }
      if (employeeRes.error) {
        next(new Error(`GET /departments employees: ${employeeRes.error.message}`))
        return
      }
      const employees = new Map(
        (employeeRes.data ?? []).map((employee) => [
          employee.id as string,
          { name: employee.name as string | null, emp_no: employee.emp_no as string | null },
        ]),
      )
      const departments = (deptRes.data ?? []).map((department) => {
        const manager = employees.get((department.manager_emp_id as string | null) ?? "")
        return {
          ...department,
          code: departmentCode(department.id as string),
          manager_name: manager?.name ?? null,
          manager_emp_no: manager?.emp_no ?? null,
          manager_label: managerLabel(manager),
        }
      })
      res.status(200).json({ departments })
    } catch (err) {
      next(err)
    }
  },
)

// A department node with its nested children, as returned by GET /org-chart.
interface OrgNode {
  id: string
  code: string
  name: string
  managerEmpId: string | null
  managerName: string | null
  managerEmpNo: string | null
  managerLabel: string | null
  children: OrgNode[]
}

/**
 * GET /org-chart — the tenant's departments as a nested tree (公司組織圖).
 *
 * Readable by any authenticated member of the tenant (not HR-only) so employees
 * can view the org chart. Builds the tree in memory from the flat list: a node
 * whose parent_id is null — or points at a department outside this tenant / a
 * missing row — is treated as a root, so a dangling parent can never hide a
 * subtree. Self-parenting rows are also treated as roots.
 */
departmentsRouter.get(
  "/org-chart",
  requireAuth,
  requireTenant,
  async (_req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    try {
      const [deptRes, employeeRes] = await Promise.all([
        supabaseAdmin
        .from("departments")
        .select("id, parent_id, name, manager_emp_id")
        .eq("tenant_id", tenantId)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("employees")
          .select("id, name, emp_no")
          .eq("tenant_id", tenantId),
      ])

      if (deptRes.error) {
        next(new Error(`GET /org-chart: ${deptRes.error.message}`))
        return
      }
      if (employeeRes.error) {
        next(new Error(`GET /org-chart employees: ${employeeRes.error.message}`))
        return
      }

      const rows = deptRes.data ?? []
      const employees = new Map(
        (employeeRes.data ?? []).map((employee) => [
          employee.id as string,
          { name: employee.name as string | null, emp_no: employee.emp_no as string | null },
        ]),
      )
      const parentById = new Map(rows.map((r) => [r.id as string, (r.parent_id as string | null) ?? null]))
      const nodes = new Map<string, OrgNode>()
      for (const r of rows) {
        const manager = employees.get((r.manager_emp_id as string | null) ?? "")
        nodes.set(r.id as string, {
          id: r.id as string,
          code: departmentCode(r.id as string),
          name: r.name as string,
          managerEmpId: (r.manager_emp_id as string | null) ?? null,
          managerName: manager?.name ?? null,
          managerEmpNo: manager?.emp_no ?? null,
          managerLabel: managerLabel(manager),
          children: [],
        })
      }

      function parentWouldCycle(id: string, parentId: string): boolean {
        const seen = new Set<string>([id])
        let next: string | null = parentId
        while (next) {
          if (seen.has(next)) return true
          seen.add(next)
          next = parentById.get(next) ?? null
        }
        return false
      }

      const roots: OrgNode[] = []
      for (const r of rows) {
        const node = nodes.get(r.id as string)!
        const parentId = r.parent_id as string | null
        const parent = parentId ? nodes.get(parentId) : undefined
        // Self-parenting, cross-tenant/missing parents, or longer cycles are roots.
        if (parentId && parent && parentId !== r.id && !parentWouldCycle(r.id as string, parentId)) parent.children.push(node)
        else roots.push(node)
      }

      res.status(200).json({ tree: roots })
    } catch (err) {
      next(err)
    }
  },
)

// POST /departments — create a department under this tenant.
departmentsRouter.post(
  "/departments",
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
        .from("departments")
        .insert({
          tenant_id: tenantId,
          name: parsed.data.name,
          parent_id: parsed.data.parentId ?? null,
          manager_emp_id: parsed.data.managerEmpId ?? null,
        })
        .select("id")
        .single()

      if (error || !data) {
        next(new Error(`POST /departments: ${error?.message}`))
        return
      }
      res.status(201).json({ id: data.id })
    } catch (err) {
      next(err)
    }
  },
)

// PATCH /departments/:id — update name/parentId/managerEmpId (this tenant only).
departmentsRouter.patch(
  "/departments/:id",
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
    if (parsed.data.parentId !== undefined) patch.parent_id = parsed.data.parentId
    if (parsed.data.managerEmpId !== undefined) patch.manager_emp_id = parsed.data.managerEmpId

    try {
      const { data, error } = await supabaseAdmin
        .from("departments")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select("id")
        .maybeSingle()

      if (error) {
        next(new Error(`PATCH /departments/${id}: ${error.message}`))
        return
      }
      // No row matched → not in this tenant (or doesn't exist) → 404.
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

// DELETE /departments/:id — remove a department (this tenant only); 409 if any
// employee still references it via dept_id.
departmentsRouter.delete(
  "/departments/:id",
  requireAuth,
  requireTenant,
  requireHrAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = res.locals.tenantId as string
    const { id } = req.params
    try {
      // Guard: block deletion while employees are still assigned to this dept.
      const { count, error: countErr } = await supabaseAdmin
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("dept_id", id)

      if (countErr) {
        next(new Error(`DELETE /departments/${id} (count): ${countErr.message}`))
        return
      }
      if ((count ?? 0) > 0) {
        res.status(409).json({ error: "department_has_employees" })
        return
      }

      const { data, error } = await supabaseAdmin
        .from("departments")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select("id")
        .maybeSingle()

      if (error) {
        next(new Error(`DELETE /departments/${id}: ${error.message}`))
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
