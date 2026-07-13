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
  // The hr_admin's own employee row id in this tenant (provisionTenant creates it).
  hrEmpId: string
}

let A: Tenant
let B: Tenant

// Tenant A cast:
//   emp1 — the reviewee (role 'employee').
//   mgr  — the appraiser assigned to review emp1 (role 'manager').
//   emp2 — an unrelated third employee; must never see emp1's review.
let emp1Id: string
let emp1Token: string
let mgrId: string
let mgrToken: string
let emp2Token: string

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

async function buildTenant(label: string): Promise<Tenant> {
  const name = `KPITEST ${label} ${stamp}`
  const adminEmail = `kpi-${stamp}-${label}-admin@example.com`
  const adminPassword = `Pw-${stamp}-${label}-Aa1!`

  const { tenantId, userId } = await provisionTenant({ name, adminEmail, adminPassword })
  createdTenantIds.push(tenantId)
  createdUserIds.push(userId)

  const adminToken = await signIn(adminEmail, adminPassword)

  // Resolve the admin's own employee row id (provisionTenant seeds it as hr_admin).
  const { data: hrEmp, error: hrErr } = await supabaseAdmin
    .from("employees")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .single()
  if (hrErr || !hrEmp) {
    throw new Error(`buildTenant(${label}): resolve hr employee failed: ${hrErr?.message}`)
  }

  return { name, tenantId, adminEmail, adminPassword, adminToken, hrEmpId: hrEmp.id as string }
}

// Create an employee with a real auth user (so they have a token) under a tenant.
async function createEmployee(
  adminToken: string,
  email: string,
  password: string,
  name: string,
  role: string,
): Promise<{ employeeId: string; token: string }> {
  const res = await request(app)
    .post("/employees")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ email, name, password, role })
  if (res.status !== 201) {
    throw new Error(`createEmployee(${email}) failed (${res.status}): ${JSON.stringify(res.body)}`)
  }
  createdUserIds.push(res.body.userId)
  const token = await signIn(email, password)
  return { employeeId: res.body.employeeId, token }
}

beforeAll(async () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY missing — cannot run kpi test")
  }

  A = await buildTenant("A")
  B = await buildTenant("B")

  const e1 = await createEmployee(
    A.adminToken,
    `kpi-${stamp}-a-emp1@example.com`,
    `Pw-${stamp}-emp1-Bb2!`,
    "Alice One",
    "employee",
  )
  emp1Id = e1.employeeId
  emp1Token = e1.token

  const m = await createEmployee(
    A.adminToken,
    `kpi-${stamp}-a-mgr@example.com`,
    `Pw-${stamp}-mgr-Cc3!`,
    "Mona Manager",
    "manager",
  )
  mgrId = m.employeeId
  mgrToken = m.token

  const e2 = await createEmployee(
    A.adminToken,
    `kpi-${stamp}-a-emp2@example.com`,
    `Pw-${stamp}-emp2-Dd4!`,
    "Bob Two",
    "employee",
  )
  emp2Token = e2.token
}, 60_000)

afterAll(async () => {
  // FK order: kpi_reviews → kpi_templates → employees → tenants → auth users.
  for (const tid of createdTenantIds) {
    await supabaseAdmin.from("kpi_reviews").delete().eq("tenant_id", tid)
  }
  for (const tid of createdTenantIds) {
    await supabaseAdmin.from("kpi_templates").delete().eq("tenant_id", tid)
  }
  for (const tid of createdTenantIds) {
    await supabaseAdmin.from("employees").delete().eq("tenant_id", tid)
  }
  for (const tid of createdTenantIds) {
    await supabaseAdmin.from("tenants").delete().eq("id", tid)
  }
  for (const uid of createdUserIds) {
    await supabaseAdmin.auth.admin.deleteUser(uid)
  }
}, 60_000)

// Shared across tests within the tenant lifecycle.
let templateId: string
let reviewId: string

describe("F2 kpi_templates — HR manages the 考核表 catalogue", () => {
  it("HR POST /kpi-templates creates a weighted template; GET lists it", async () => {
    const res = await request(app)
      .post("/kpi-templates")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({
        name: "2026 上半年考核",
        items: [
          { key: "quality", label: "品質", weight: 60, maxScore: 10 },
          { key: "attitude", label: "態度", weight: 40, maxScore: 10 },
        ],
      })
    expect(res.status).toBe(201)
    expect(typeof res.body.id).toBe("string")
    templateId = res.body.id

    const list = await request(app)
      .get("/kpi-templates")
      .set("Authorization", `Bearer ${A.adminToken}`)
    expect(list.status).toBe(200)
    const templates = list.body.templates as Array<{
      id: string
      tenant_id: string
      items: Array<{ key: string; weight: number; maxScore: number }>
    }>
    const mine = templates.find((t) => t.id === templateId)
    expect(mine).toBeTruthy()
    expect(mine?.items.map((i) => i.key)).toEqual(["quality", "attitude"])
    expect(templates.every((t) => t.tenant_id === A.tenantId)).toBe(true)
  })

  it("a normal employee cannot create templates → 403", async () => {
    const res = await request(app)
      .post("/kpi-templates")
      .set("Authorization", `Bearer ${emp1Token}`)
      .send({ name: "x", items: [] })
    expect(res.status).toBe(403)
  })
})

describe("F2 assign — HR assigns a review to an appraiser", () => {
  it("HR POST /kpi-reviews assigns {emp1, mgr, template, period} → 201 draft", async () => {
    const res = await request(app)
      .post("/kpi-reviews")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({
        employeeId: emp1Id,
        reviewerEmpId: mgrId,
        templateId,
        period: "2026-H1",
      })
    expect(res.status).toBe(201)
    expect(typeof res.body.id).toBe("string")
    reviewId = res.body.id

    const { data } = await supabaseAdmin
      .from("kpi_reviews")
      .select("tenant_id, employee_id, reviewer_emp_id, template_id, period, status, total_score")
      .eq("id", reviewId)
      .single()
    expect(data?.tenant_id).toBe(A.tenantId)
    expect(data?.employee_id).toBe(emp1Id)
    expect(data?.reviewer_emp_id).toBe(mgrId)
    expect(data?.template_id).toBe(templateId)
    expect(data?.period).toBe("2026-H1")
    expect(data?.status).toBe("draft")
    expect(data?.total_score).toBeNull()
  })

  it("a normal employee cannot assign reviews → 403", async () => {
    const res = await request(app)
      .post("/kpi-reviews")
      .set("Authorization", `Bearer ${emp1Token}`)
      .send({ employeeId: emp1Id, reviewerEmpId: mgrId, templateId, period: "2026-H2" })
    expect(res.status).toBe(403)
  })
})

describe("F2 score — the appraiser fills scores; weighted total is computed", () => {
  it("mgr PATCH scores → total_score = 8/10*60 + 9/10*40 = 84", async () => {
    const res = await request(app)
      .patch(`/kpi-reviews/${reviewId}`)
      .set("Authorization", `Bearer ${mgrToken}`)
      .send({
        scores: [
          { key: "quality", score: 8 },
          { key: "attitude", score: 9 },
        ],
      })
    expect(res.status).toBe(200)
    // 8/10*60 = 48 ; 9/10*40 = 36 ; total = 84.
    expect(Number(res.body.totalScore)).toBe(84)

    const { data } = await supabaseAdmin
      .from("kpi_reviews")
      .select("total_score, scores, status")
      .eq("id", reviewId)
      .single()
    expect(Number(data?.total_score)).toBe(84)
    expect(data?.status).toBe("draft")
    const scores = data?.scores as Array<{ key: string; score: number }>
    expect(scores.find((s) => s.key === "quality")?.score).toBe(8)
    expect(scores.find((s) => s.key === "attitude")?.score).toBe(9)
  })

  it("an unrelated employee (not the appraiser, not HR) cannot score → 403", async () => {
    const res = await request(app)
      .patch(`/kpi-reviews/${reviewId}`)
      .set("Authorization", `Bearer ${emp1Token}`)
      .send({ scores: [{ key: "quality", score: 1 }] })
    expect(res.status).toBe(403)
  })
})

describe("F2 lifecycle — draft → submitted → finalized (terminal)", () => {
  it("mgr submits → status submitted", async () => {
    const res = await request(app)
      .post(`/kpi-reviews/${reviewId}/submit`)
      .set("Authorization", `Bearer ${mgrToken}`)
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("submitted")

    const { data } = await supabaseAdmin
      .from("kpi_reviews")
      .select("status")
      .eq("id", reviewId)
      .single()
    expect(data?.status).toBe("submitted")
  })

  it("HR finalizes → status finalized", async () => {
    const res = await request(app)
      .post(`/kpi-reviews/${reviewId}/finalize`)
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("finalized")

    const { data } = await supabaseAdmin
      .from("kpi_reviews")
      .select("status")
      .eq("id", reviewId)
      .single()
    expect(data?.status).toBe("finalized")
  })

  it("a finalized review can no longer be scored → 409", async () => {
    const res = await request(app)
      .patch(`/kpi-reviews/${reviewId}`)
      .set("Authorization", `Bearer ${mgrToken}`)
      .send({ scores: [{ key: "quality", score: 1 }] })
    expect(res.status).toBe(409)
  })
})

describe("F2 visibility — HR / appraiser / reviewee scoping", () => {
  it("mgr (appraiser) sees the review assigned to them", async () => {
    const res = await request(app)
      .get("/kpi-reviews")
      .set("Authorization", `Bearer ${mgrToken}`)
    expect(res.status).toBe(200)
    const items = res.body.reviews as Array<{ id: string }>
    expect(items.some((r) => r.id === reviewId)).toBe(true)
  })

  it("emp1 (reviewee) now sees their finalized review", async () => {
    const res = await request(app)
      .get("/kpi-reviews")
      .set("Authorization", `Bearer ${emp1Token}`)
    expect(res.status).toBe(200)
    const items = res.body.reviews as Array<{ id: string; employee_id: string }>
    expect(items.some((r) => r.id === reviewId && r.employee_id === emp1Id)).toBe(true)
  })

  it("an unrelated employee (emp2) sees none of emp1's reviews", async () => {
    const res = await request(app)
      .get("/kpi-reviews")
      .set("Authorization", `Bearer ${emp2Token}`)
    expect(res.status).toBe(200)
    const items = res.body.reviews as Array<{ employee_id: string }>
    expect(items.some((r) => r.employee_id === emp1Id)).toBe(false)
  })

  it("HR sees every review in the tenant", async () => {
    const res = await request(app)
      .get("/kpi-reviews")
      .set("Authorization", `Bearer ${A.adminToken}`)
    expect(res.status).toBe(200)
    const items = res.body.reviews as Array<{ tenant_id: string }>
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((r) => r.tenant_id === A.tenantId)).toBe(true)
  })

  it("a reviewee does NOT see their own review before it is finalized", async () => {
    // Assign a fresh draft review for emp1 (different period) — emp1 must not see it.
    const assigned = await request(app)
      .post("/kpi-reviews")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ employeeId: emp1Id, reviewerEmpId: mgrId, templateId, period: "2026-H2" })
    expect(assigned.status).toBe(201)
    const draftId = assigned.body.id as string

    const res = await request(app)
      .get("/kpi-reviews")
      .set("Authorization", `Bearer ${emp1Token}`)
    expect(res.status).toBe(200)
    const items = res.body.reviews as Array<{ id: string }>
    expect(items.some((r) => r.id === draftId)).toBe(false)
  })
})

describe("F2 cross-tenant isolation", () => {
  it("A's HR can never see any of B's reviews", async () => {
    // Seed a template + review directly in tenant B (rows only).
    const { data: bTpl, error: bTplErr } = await supabaseAdmin
      .from("kpi_templates")
      .insert({ tenant_id: B.tenantId, name: "B tpl", items: [] })
      .select("id")
      .single()
    if (bTplErr || !bTpl) throw new Error(`seed B template failed: ${bTplErr?.message}`)

    const { data: bRev, error: bRevErr } = await supabaseAdmin
      .from("kpi_reviews")
      .insert({
        tenant_id: B.tenantId,
        employee_id: B.hrEmpId,
        reviewer_emp_id: B.hrEmpId,
        template_id: bTpl.id,
        period: "2026-H1",
        status: "draft",
      })
      .select("id")
      .single()
    if (bRevErr || !bRev) throw new Error(`seed B review failed: ${bRevErr?.message}`)

    const res = await request(app)
      .get("/kpi-reviews")
      .set("Authorization", `Bearer ${A.adminToken}`)
    expect(res.status).toBe(200)
    const items = res.body.reviews as Array<{ id: string; tenant_id: string }>
    expect(items.every((r) => r.tenant_id === A.tenantId)).toBe(true)
    expect(items.some((r) => r.id === bRev.id)).toBe(false)
  })
})
