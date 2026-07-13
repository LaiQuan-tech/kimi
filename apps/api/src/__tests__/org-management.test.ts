import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createClient } from "@supabase/supabase-js"
import request from "supertest"
// .env is loaded by the vitest setupFile (src/__tests__/setup.ts) before this
// module is imported, so the eagerly-constructed clients below have real creds.
import { supabaseAdmin } from "../lib/supabase"
import { provisionTenant } from "../services/tenants"
import { app } from "../app"

const SUPABASE_URL = process.env.SUPABASE_URL ?? ""
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? ""

const stamp = Date.now()
const createdUserIds: string[] = []
const createdTenantIds: string[] = []

interface Tenant {
  name: string
  tenantId: string
  adminEmail: string
  adminPassword: string
  adminToken: string
}

let A: Tenant
let B: Tenant

// A plain employee under tenant A (role='employee'), used to prove non-HR
// users cannot write. Its email/password come from the POST /employees call.
let aEmployeeEmail: string
let aEmployeePassword: string
let aEmployeeToken: string
let aEmployeeId: string
let aEmployeeUserId: string

// A department created under tenant B, used to prove A cannot mutate it.
let bDeptId: string

/**
 * Sign a freshly-provisioned tenant's HR admin in via the anon client to obtain
 * a real access token whose JWT carries app_metadata.tenant_id.
 */
async function buildTenant(label: string): Promise<Tenant> {
  const name = `ORGTEST ${label} ${stamp}`
  const adminEmail = `t-${stamp}-${label}-admin@example.com`
  const adminPassword = `Pw-${stamp}-${label}-Aa1!`

  const { tenantId, userId } = await provisionTenant({ name, adminEmail, adminPassword })
  createdTenantIds.push(tenantId)
  createdUserIds.push(userId)

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { data: signIn, error } = await anon.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  })
  if (error || !signIn.session) {
    throw new Error(`buildTenant(${label}): admin sign-in failed: ${error?.message}`)
  }
  expect(signIn.user?.app_metadata?.tenant_id).toBe(tenantId)

  return { name, tenantId, adminEmail, adminPassword, adminToken: signIn.session.access_token }
}

async function signIn(email: string, password: string): Promise<string> {
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    throw new Error(`signIn(${email}) failed: ${error?.message}`)
  }
  return data.session.access_token
}

beforeAll(async () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY missing — cannot run org-management test")
  }

  A = await buildTenant("A")
  B = await buildTenant("B")

  // A department in B that A must never be able to touch.
  const { data: bDept, error: bDeptErr } = await supabaseAdmin
    .from("departments")
    .insert({ tenant_id: B.tenantId, name: `B-only Dept ${stamp}` })
    .select("id")
    .single()
  if (bDeptErr || !bDept) {
    throw new Error(`beforeAll: B department insert failed: ${bDeptErr?.message}`)
  }
  bDeptId = bDept.id as string
}, 60_000)

afterAll(async () => {
  // employees → departments → tenants → auth users (respect FK order).
  for (const tid of createdTenantIds) {
    await supabaseAdmin.from("employees").delete().eq("tenant_id", tid)
  }
  for (const tid of createdTenantIds) {
    await supabaseAdmin.from("departments").delete().eq("tenant_id", tid)
  }
  for (const tid of createdTenantIds) {
    await supabaseAdmin.from("tenants").delete().eq("id", tid)
  }
  for (const uid of createdUserIds) {
    await supabaseAdmin.auth.admin.deleteUser(uid)
  }
}, 60_000)

describe("F1 departments CRUD — tenant A, HR admin", () => {
  let deptId: string

  it("POST /departments creates a department scoped to A → 201 { id }", async () => {
    const res = await request(app)
      .post("/departments")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ name: `Engineering ${stamp}` })

    expect(res.status).toBe(201)
    expect(typeof res.body.id).toBe("string")
    deptId = res.body.id

    // The row really belongs to A.
    const { data } = await supabaseAdmin
      .from("departments")
      .select("tenant_id, name")
      .eq("id", deptId)
      .single()
    expect(data?.tenant_id).toBe(A.tenantId)
  })

  it("GET /departments lists ONLY A's departments (includes the new one, never B's)", async () => {
    const res = await request(app)
      .get("/departments")
      .set("Authorization", `Bearer ${A.adminToken}`)

    expect(res.status).toBe(200)
    const rows = res.body.departments as Array<{
      id: string
      tenant_id: string
      code: string
      manager_label: string | null
    }>
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.every((r) => r.tenant_id === A.tenantId)).toBe(true)
    expect(rows.some((r) => r.id === deptId)).toBe(true)
    expect(rows.find((r) => r.id === deptId)?.code).toMatch(/^D-[A-F0-9]{8}$/)
    // B's department must not leak.
    expect(rows.some((r) => r.id === bDeptId)).toBe(false)
  })

  it("PATCH /departments/:id updates the name (A only)", async () => {
    const res = await request(app)
      .patch(`/departments/${deptId}`)
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ name: `Engineering-Renamed ${stamp}` })

    expect(res.status).toBe(200)

    const { data } = await supabaseAdmin
      .from("departments")
      .select("name")
      .eq("id", deptId)
      .single()
    expect(data?.name).toBe(`Engineering-Renamed ${stamp}`)
  })

  it("DELETE /departments/:id with employees attached → 409", async () => {
    // Attach a throwaway employee row to this dept, then attempt delete.
    const { data: emp } = await supabaseAdmin
      .from("employees")
      .insert({
        tenant_id: A.tenantId,
        name: `Temp In Dept ${stamp}`,
        dept_id: deptId,
        role: "employee",
      })
      .select("id")
      .single()

    const res = await request(app)
      .delete(`/departments/${deptId}`)
      .set("Authorization", `Bearer ${A.adminToken}`)
    expect(res.status).toBe(409)

    // Still there.
    const { data: still } = await supabaseAdmin
      .from("departments")
      .select("id")
      .eq("id", deptId)
      .maybeSingle()
    expect(still?.id).toBe(deptId)

    // Detach the temp employee so the next delete can succeed.
    if (emp?.id) {
      await supabaseAdmin.from("employees").update({ dept_id: null }).eq("id", emp.id)
    }
  })

  it("DELETE /departments/:id with no employees → 200, row gone", async () => {
    const res = await request(app)
      .delete(`/departments/${deptId}`)
      .set("Authorization", `Bearer ${A.adminToken}`)
    expect(res.status).toBe(200)

    const { data } = await supabaseAdmin
      .from("departments")
      .select("id")
      .eq("id", deptId)
      .maybeSingle()
    expect(data).toBeNull()
  })
})

describe("F1 employees lifecycle — tenant A, HR admin", () => {
  let deptId: string

  it("POST /employees creates Auth user + employees row → 201 { employeeId, userId }", async () => {
    // A dept to assign the new employee to.
    const { data: dept } = await supabaseAdmin
      .from("departments")
      .insert({ tenant_id: A.tenantId, name: `Sales ${stamp}` })
      .select("id")
      .single()
    deptId = dept!.id as string

    aEmployeeEmail = `t-${stamp}-a-emp@example.com`
    aEmployeePassword = `Pw-${stamp}-emp-Bb2!`

    const res = await request(app)
      .post("/employees")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({
        email: aEmployeeEmail,
        name: "Alice Employee",
        password: aEmployeePassword,
        role: "employee",
        deptId,
        empNo: "E-001",
        employmentType: "regular",
      })

    expect(res.status).toBe(201)
    expect(typeof res.body.employeeId).toBe("string")
    expect(typeof res.body.userId).toBe("string")
    aEmployeeId = res.body.employeeId
    aEmployeeUserId = res.body.userId
    createdUserIds.push(aEmployeeUserId)

    // Row belongs to A and carries the supplied fields.
    const { data } = await supabaseAdmin
      .from("employees")
      .select("tenant_id, user_id, name, role, dept_id, emp_no, employment_type, status")
      .eq("id", aEmployeeId)
      .single()
    expect(data?.tenant_id).toBe(A.tenantId)
    expect(data?.user_id).toBe(aEmployeeUserId)
    expect(data?.role).toBe("employee")
    expect(data?.dept_id).toBe(deptId)
    expect(data?.emp_no).toBe("E-001")
    expect(data?.status).toBe("active")

    // The auth user must carry tenant_id = A in app_metadata (drives RLS/JWT).
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(aEmployeeUserId)
    expect(authUser.user?.app_metadata?.tenant_id).toBe(A.tenantId)
  })

  it("GET /employees includes the new employee", async () => {
    const res = await request(app)
      .get("/employees")
      .set("Authorization", `Bearer ${A.adminToken}`)

    expect(res.status).toBe(200)
    const rows = res.body.employees as Array<{ id: string; tenant_id: string }>
    expect(rows.some((r) => r.id === aEmployeeId)).toBe(true)
    expect(rows.every((r) => r.tenant_id === A.tenantId)).toBe(true)
  })

  it("PATCH /employees/:id updates dept/role/name", async () => {
    // Move to a new dept and promote to manager.
    const { data: dept2 } = await supabaseAdmin
      .from("departments")
      .insert({ tenant_id: A.tenantId, name: `Support ${stamp}` })
      .select("id")
      .single()
    const dept2Id = dept2!.id as string

    const res = await request(app)
      .patch(`/employees/${aEmployeeId}`)
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ deptId: dept2Id, role: "manager", name: "Alice Manager" })

    expect(res.status).toBe(200)

    const { data } = await supabaseAdmin
      .from("employees")
      .select("dept_id, role, name")
      .eq("id", aEmployeeId)
      .single()
    expect(data?.dept_id).toBe(dept2Id)
    expect(data?.role).toBe("manager")
    expect(data?.name).toBe("Alice Manager")

    // Restore to 'employee' so the permission test below is meaningful.
    await supabaseAdmin.from("employees").update({ role: "employee" }).eq("id", aEmployeeId)
  })

  it("POST /employees/:id/deactivate sets status=inactive", async () => {
    const res = await request(app)
      .post(`/employees/${aEmployeeId}/deactivate`)
      .set("Authorization", `Bearer ${A.adminToken}`)

    expect(res.status).toBe(200)

    const { data } = await supabaseAdmin
      .from("employees")
      .select("status")
      .eq("id", aEmployeeId)
      .single()
    expect(data?.status).toBe("inactive")

    // Reactivate so the employee can sign in for the permission test.
    await supabaseAdmin.from("employees").update({ status: "active" }).eq("id", aEmployeeId)
  })
})

describe("F1 authorization — non-HR employee cannot write", () => {
  it("a role='employee' user POST /departments → 403", async () => {
    aEmployeeToken = await signIn(aEmployeeEmail, aEmployeePassword)

    const res = await request(app)
      .post("/departments")
      .set("Authorization", `Bearer ${aEmployeeToken}`)
      .send({ name: `Should Not Exist ${stamp}` })

    expect(res.status).toBe(403)
  })

  it("a role='employee' user POST /employees → 403", async () => {
    const res = await request(app)
      .post("/employees")
      .set("Authorization", `Bearer ${aEmployeeToken}`)
      .send({
        email: `t-${stamp}-should-not@example.com`,
        name: "Nope",
        password: "Pw-nope-Aa1!",
      })

    expect(res.status).toBe(403)
  })
})

describe("F1 cross-tenant — A cannot mutate B's rows", () => {
  it("PATCH /departments/:id of a B department with A's token does NOT change B's row", async () => {
    const before = await supabaseAdmin
      .from("departments")
      .select("name")
      .eq("id", bDeptId)
      .single()

    const res = await request(app)
      .patch(`/departments/${bDeptId}`)
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ name: "HIJACKED BY A" })

    // 404 (scoped query finds nothing) is the expected contract; the
    // load-bearing assertion is that B's row is unchanged regardless.
    expect(res.status).toBe(404)

    const after = await supabaseAdmin
      .from("departments")
      .select("name")
      .eq("id", bDeptId)
      .single()
    expect(after.data?.name).toBe(before.data?.name)
    expect(after.data?.name).not.toBe("HIJACKED BY A")
  })

  it("DELETE /departments/:id of a B department with A's token does NOT delete B's row", async () => {
    const res = await request(app)
      .delete(`/departments/${bDeptId}`)
      .set("Authorization", `Bearer ${A.adminToken}`)

    expect(res.status).toBe(404)

    const { data } = await supabaseAdmin
      .from("departments")
      .select("id")
      .eq("id", bDeptId)
      .maybeSingle()
    expect(data?.id).toBe(bDeptId)
  })
})

describe("F1 公司組織圖 — GET /org-chart builds a nested tree", () => {
  let parentId: string
  let childId: string

  it("HR creates a parent dept and a child dept under it", async () => {
    const parent = await request(app)
      .post("/departments")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ name: `Org Parent ${stamp}`, managerEmpId: aEmployeeId })
    expect(parent.status).toBe(201)
    parentId = parent.body.id

    const child = await request(app)
      .post("/departments")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ name: `Org Child ${stamp}`, parentId })
    expect(child.status).toBe(201)
    childId = child.body.id
  })

  it("GET /org-chart nests the child under the parent (tenant-scoped)", async () => {
    const res = await request(app)
      .get("/org-chart")
      .set("Authorization", `Bearer ${A.adminToken}`)
    expect(res.status).toBe(200)

    const tree = res.body.tree as Array<{
      id: string
      code: string
      managerEmpId: string | null
      managerLabel: string | null
      children: { id: string }[]
    }>
    const parentNode = tree.find((n) => n.id === parentId)
    expect(parentNode).toBeTruthy()
    expect(parentNode!.code).toMatch(/^D-[A-F0-9]{8}$/)
    expect(parentNode!.managerEmpId).toBe(aEmployeeId)
    expect(parentNode!.managerLabel).toContain("Alice")
    expect(parentNode!.children.some((c) => c.id === childId)).toBe(true)
    // The child is not also a root.
    expect(tree.some((n) => n.id === childId)).toBe(false)
  })

  it("a non-HR employee may also read the org chart → 200", async () => {
    const res = await request(app)
      .get("/org-chart")
      .set("Authorization", `Bearer ${aEmployeeToken}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.tree)).toBe(true)
  })
})
