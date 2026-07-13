import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import request from "supertest"
// .env is loaded by the vitest setupFile (src/__tests__/setup.ts) before this
// module is imported, so the eagerly-constructed clients below have real creds.
import { supabaseAdmin } from "../lib/supabase"
import { provisionTenant } from "../services/tenants"
import { app } from "../app"

const SUPABASE_URL = process.env.SUPABASE_URL ?? ""
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? ""

// Platform-operator allow-list used by the onboarding route test.
const PLATFORM_OPERATOR_EMAIL = `platform-op-${Date.now()}@example.com`

interface ProvisionedTenant {
  name: string
  tenantId: string
  adminUserId: string
  adminEmail: string
  adminPassword: string
  employeeUserId: string // extra plain employee's auth user
  employeeRowId: string
}

const stamp = Date.now()
const createdUserIds: string[] = []
const createdTenantIds: string[] = []

let A: ProvisionedTenant
let B: ProvisionedTenant
let tokenA: string

/**
 * Provision a tenant via the service function, then add one extra plain
 * `employee`-role row (with its own auth user) so we can exercise the
 * "self vs HR" read paths and prove row counts.
 */
async function buildTenant(label: string): Promise<ProvisionedTenant> {
  const name = `ISOTEST ${label} ${stamp}`
  const adminEmail = `iso-${stamp}-${label}-admin@example.com`
  const adminPassword = `Pw-${stamp}-${label}-Aa1!`

  const { tenantId, userId: adminUserId } = await provisionTenant({
    name,
    adminEmail,
    adminPassword,
  })
  createdTenantIds.push(tenantId)
  createdUserIds.push(adminUserId)

  // Extra plain employee with its own auth user (tenant_id in app_metadata).
  const empEmail = `iso-${stamp}-${label}-emp@example.com`
  const { data: empUser, error: empUserErr } = await supabaseAdmin.auth.admin.createUser({
    email: empEmail,
    password: `Pw-${stamp}-${label}-Bb2!`,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId },
  })
  if (empUserErr || !empUser?.user) {
    throw new Error(`buildTenant(${label}): employee user creation failed: ${empUserErr?.message}`)
  }
  const employeeUserId = empUser.user.id
  createdUserIds.push(employeeUserId)

  const { data: empRow, error: empRowErr } = await supabaseAdmin
    .from("employees")
    .insert({
      tenant_id: tenantId,
      user_id: employeeUserId,
      name: `Plain Employee ${label}`,
      role: "employee",
      employment_type: "regular",
      status: "active",
    })
    .select("id")
    .single()
  if (empRowErr || !empRow) {
    throw new Error(`buildTenant(${label}): employee row insert failed: ${empRowErr?.message}`)
  }

  return {
    name,
    tenantId,
    adminUserId,
    adminEmail,
    adminPassword,
    employeeUserId,
    employeeRowId: empRow.id as string,
  }
}

beforeAll(async () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY missing — cannot run isolation test")
  }
  process.env.PLATFORM_ADMIN_EMAILS = PLATFORM_OPERATOR_EMAIL

  A = await buildTenant("A")
  B = await buildTenant("B")

  // Sign in as A's HR admin via the anon client to obtain a real access token.
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
    email: A.adminEmail,
    password: A.adminPassword,
  })
  if (signInErr || !signIn.session) {
    throw new Error(`A admin sign-in failed: ${signInErr?.message}`)
  }
  tokenA = signIn.session.access_token

  // Sanity: the JWT must actually carry tenant_id = A in app_metadata, else RLS
  // would be testing nothing.
  expect(signIn.user?.app_metadata?.tenant_id).toBe(A.tenantId)
}, 60_000)

afterAll(async () => {
  // Delete employees rows for both tenants first (FK from employees → tenants).
  for (const tid of createdTenantIds) {
    await supabaseAdmin.from("employees").delete().eq("tenant_id", tid)
  }
  // Then the tenants rows.
  for (const tid of createdTenantIds) {
    await supabaseAdmin.from("tenants").delete().eq("id", tid)
  }
  // Then every auth user we created.
  for (const uid of createdUserIds) {
    await supabaseAdmin.auth.admin.deleteUser(uid)
  }
}, 60_000)

describe("cross-tenant isolation — API layer", () => {
  it("GET /employees as A's HR admin returns ONLY tenant A employees, never B", async () => {
    const res = await request(app)
      .get("/employees")
      .set("Authorization", `Bearer ${tokenA}`)

    expect(res.status).toBe(200)
    const rows = res.body.employees as Array<{ tenant_id: string; id: string }>
    expect(Array.isArray(rows)).toBe(true)
    // A has exactly two employees: the hr_admin + one plain employee.
    expect(rows.length).toBe(2)
    // Every row belongs to A.
    expect(rows.every((r) => r.tenant_id === A.tenantId)).toBe(true)
    // No B rows leaked.
    expect(rows.some((r) => r.tenant_id === B.tenantId)).toBe(false)
    expect(rows.some((r) => r.id === B.employeeRowId)).toBe(false)
  })

  it("rejects unauthenticated GET /employees with 401", async () => {
    const res = await request(app).get("/employees")
    expect(res.status).toBe(401)
  })
})

describe("cross-tenant isolation — RLS backstop (direct PostgREST as A)", () => {
  function anonAsA(): SupabaseClient {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${tokenA}` } },
    })
  }

  it("employees.select returns ONLY tenant A rows — no B rows even bypassing the API", async () => {
    const { data, error } = await anonAsA().from("employees").select("id, tenant_id")
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    const rows = data as Array<{ id: string; tenant_id: string }>
    // Must contain at least A's hr_admin (self-or-hr read) and zero B rows.
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.tenant_id === A.tenantId)).toBe(true)
    expect(rows.some((r) => r.tenant_id === B.tenantId)).toBe(false)
  })

  it("tenants.select is locked to service_role — A's user reads nothing", async () => {
    const { data, error } = await anonAsA().from("tenants").select("*")
    // RLS-enabled with no policy → either an empty set or an error; never B's row.
    const rows = (data ?? []) as Array<{ id: string }>
    expect(rows.length).toBe(0)
    expect(rows.some((r) => r.id === A.tenantId || r.id === B.tenantId)).toBe(false)
    // error may or may not be populated depending on PostgREST behaviour; the
    // load-bearing assertion is that no tenant rows are visible.
    void error
  })
})

describe("tenant onboarding route — platform-operator gating", () => {
  it("POST /admin/tenants without a platform-operator token is rejected", async () => {
    // A's HR admin is NOT a platform operator.
    const res = await request(app)
      .post("/admin/tenants")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        name: "Should Not Exist",
        adminEmail: `iso-${stamp}-nope@example.com`,
        adminPassword: "Pw-nope-Aa1!",
      })
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: "not_platform_operator" })
  })

  it("POST /admin/tenants with no auth at all is 401", async () => {
    const res = await request(app)
      .post("/admin/tenants")
      .send({ name: "x", adminEmail: "x@example.com", adminPassword: "Pw-aaaa1!" })
    expect(res.status).toBe(401)
  })
})

describe("white-label branding read", () => {
  it("GET /api/tenant/branding returns A's branding + features for A's token", async () => {
    const res = await request(app)
      .get("/api/tenant/branding")
      .set("Authorization", `Bearer ${tokenA}`)

    expect(res.status).toBe(200)
    expect(res.body.branding).toMatchObject({
      primaryColor: "#1F4E79",
      appName: A.name,
      logoUrl: null,
    })
    expect(res.body.features).toMatchObject({
      payroll: true,
      kpi: true,
      ai_assistant: true,
    })
  })
})
