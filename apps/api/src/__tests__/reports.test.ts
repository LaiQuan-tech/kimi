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

// Tenant A's two employees (own auth users + tokens) and two departments.
let emp1Id: string // Alice, deptEng
let emp2Id: string // Bob, deptSales
let deptEngId: string
let deptSalesId: string

let aEmployeeEmail: string
let aEmployeePassword: string
let aEmployeeToken: string // emp1's token (role=employee) — proves report routes are HR-only

const PERIOD = "2026-05"
const FROM = "2026-05-01"
const TO = "2026-05-31"
const LEAVE_FROM = "2026-05-01T00:00:00.000Z"
const LEAVE_TO = "2026-05-31T23:59:59.000Z"

// --- Seed: attendance_days (work_date in PERIOD, plus one out-of-window) ------
// emp1: two in-window days (one late, both with OT, one night).
const EMP1_DAYS = [
  {
    work_date: "2026-05-05",
    worked_minutes: 480,
    late_minutes: 10,
    overtime_minutes: 60,
    night_minutes: 0,
    day_type: "workday",
  },
  {
    work_date: "2026-05-06",
    worked_minutes: 600,
    late_minutes: 0,
    overtime_minutes: 120,
    night_minutes: 30,
    day_type: "workday",
  },
  // OUT of window — must NOT be aggregated for FROM..TO.
  {
    work_date: "2026-04-30",
    worked_minutes: 999,
    late_minutes: 999,
    overtime_minutes: 999,
    night_minutes: 999,
    day_type: "workday",
  },
]
// emp2: one in-window day (late, night, no OT).
const EMP2_DAYS = [
  {
    work_date: "2026-05-07",
    worked_minutes: 450,
    late_minutes: 5,
    overtime_minutes: 0,
    night_minutes: 60,
    day_type: "workday",
  },
]

// --- Hand-computed expected attendance aggregates (in-window only) ------------
const EXPECT_EMP1 = {
  workedMinutes: 1080, // 480 + 600
  lateDays: 1, // only 2026-05-05 has late>0
  lateMinutes: 10,
  overtimeMinutes: 180, // 60 + 120
  nightMinutes: 30,
  presentDays: 2,
}
const EXPECT_EMP2 = {
  workedMinutes: 450,
  lateDays: 1,
  lateMinutes: 5,
  overtimeMinutes: 0,
  nightMinutes: 60,
  presentDays: 1,
}

// --- Seed: payslips for PERIOD ------------------------------------------------
const EMP1_SLIP = { base: 30000, overtime_pay: 1000, night_pay: 200, attendance_bonus: 1400, gross: 32600 }
const EMP2_SLIP = { base: 28000, overtime_pay: 0, night_pay: 300, attendance_bonus: 2000, gross: 30300 }
const EXPECT_TOTAL_GROSS = 62900 // 32600 + 30300

async function buildTenant(label: string): Promise<Tenant> {
  const name = `RPT ${label} ${stamp}`
  const adminEmail = `rpt-${stamp}-${label}-admin@example.com`
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
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY missing — cannot run reports test")
  }

  A = await buildTenant("A")
  B = await buildTenant("B")

  // Two departments under A.
  const engRes = await request(app)
    .post("/departments")
    .set("Authorization", `Bearer ${A.adminToken}`)
    .send({ name: `Engineering ${stamp}` })
  if (engRes.status !== 201) throw new Error(`beforeAll: create deptEng (${engRes.status})`)
  deptEngId = engRes.body.id

  const salesRes = await request(app)
    .post("/departments")
    .set("Authorization", `Bearer ${A.adminToken}`)
    .send({ name: `Sales ${stamp}` })
  if (salesRes.status !== 201) throw new Error(`beforeAll: create deptSales (${salesRes.status})`)
  deptSalesId = salesRes.body.id

  // emp1 (Alice) in deptEng — gets an auth user + token (role=employee).
  aEmployeeEmail = `rpt-${stamp}-a-emp1@example.com`
  aEmployeePassword = `Pw-${stamp}-emp1-Bb2!`
  const e1 = await request(app)
    .post("/employees")
    .set("Authorization", `Bearer ${A.adminToken}`)
    .send({
      email: aEmployeeEmail,
      name: "Alice Report",
      password: aEmployeePassword,
      role: "employee",
      deptId: deptEngId,
    })
  if (e1.status !== 201) throw new Error(`beforeAll: create emp1 (${e1.status})`)
  emp1Id = e1.body.employeeId
  createdUserIds.push(e1.body.userId)
  aEmployeeToken = await signIn(aEmployeeEmail, aEmployeePassword)

  // emp2 (Bob) in deptSales.
  const e2 = await request(app)
    .post("/employees")
    .set("Authorization", `Bearer ${A.adminToken}`)
    .send({
      email: `rpt-${stamp}-a-emp2@example.com`,
      name: "Bob Report",
      password: `Pw-${stamp}-emp2-Cc3!`,
      role: "employee",
      deptId: deptSalesId,
    })
  if (e2.status !== 201) throw new Error(`beforeAll: create emp2 (${e2.status})`)
  emp2Id = e2.body.employeeId
  createdUserIds.push(e2.body.userId)

  // Seed attendance_days for A's two employees.
  const adRows = [
    ...EMP1_DAYS.map((d) => ({ tenant_id: A.tenantId, employee_id: emp1Id, ...d })),
    ...EMP2_DAYS.map((d) => ({ tenant_id: A.tenantId, employee_id: emp2Id, ...d })),
  ]
  const { error: adErr } = await supabaseAdmin.from("attendance_days").insert(adRows)
  if (adErr) throw new Error(`beforeAll: seed attendance_days: ${adErr.message}`)

  // Seed payslips for PERIOD.
  const { error: psErr } = await supabaseAdmin.from("payslips").insert([
    { tenant_id: A.tenantId, employee_id: emp1Id, period: PERIOD, ...EMP1_SLIP },
    { tenant_id: A.tenantId, employee_id: emp2Id, period: PERIOD, ...EMP2_SLIP },
  ])
  if (psErr) throw new Error(`beforeAll: seed payslips: ${psErr.message}`)

  // Seed leave_requests (mix of kind × status); start/end inside the window.
  const { error: lrErr } = await supabaseAdmin.from("leave_requests").insert([
    {
      tenant_id: A.tenantId,
      employee_id: emp1Id,
      kind: "leave",
      start_at: LEAVE_FROM,
      end_at: LEAVE_TO,
      hours: 8,
      status: "approved",
      current_step: 1,
    },
    {
      tenant_id: A.tenantId,
      employee_id: emp1Id,
      kind: "leave",
      start_at: LEAVE_FROM,
      end_at: LEAVE_TO,
      hours: 4,
      status: "pending",
      current_step: 1,
    },
    {
      tenant_id: A.tenantId,
      employee_id: emp2Id,
      kind: "ot",
      start_at: LEAVE_FROM,
      end_at: LEAVE_TO,
      hours: 2,
      status: "approved",
      current_step: 1,
    },
    {
      tenant_id: A.tenantId,
      employee_id: emp2Id,
      kind: "fix_punch",
      start_at: LEAVE_FROM,
      end_at: LEAVE_TO,
      hours: null,
      status: "rejected",
      current_step: 1,
    },
  ])
  if (lrErr) throw new Error(`beforeAll: seed leave_requests: ${lrErr.message}`)

  // --- Tenant B gets a little data so isolation is provable --------------------
  const bEng = await request(app)
    .post("/departments")
    .set("Authorization", `Bearer ${B.adminToken}`)
    .send({ name: `B-Dept ${stamp}` })
  const bDeptId = bEng.body.id
  const bEmpRes = await request(app)
    .post("/employees")
    .set("Authorization", `Bearer ${B.adminToken}`)
    .send({
      email: `rpt-${stamp}-b-emp@example.com`,
      name: "Bianca B",
      password: `Pw-${stamp}-bemp-Dd4!`,
      role: "employee",
      deptId: bDeptId,
    })
  const bEmpId = bEmpRes.body.employeeId
  createdUserIds.push(bEmpRes.body.userId)
  await supabaseAdmin.from("attendance_days").insert({
    tenant_id: B.tenantId,
    employee_id: bEmpId,
    work_date: "2026-05-10",
    worked_minutes: 123,
    late_minutes: 7,
    overtime_minutes: 11,
    night_minutes: 13,
    day_type: "workday",
  })
  await supabaseAdmin.from("payslips").insert({
    tenant_id: B.tenantId,
    employee_id: bEmpId,
    period: PERIOD,
    base: 11111,
    gross: 11111,
  })
  await supabaseAdmin.from("leave_requests").insert({
    tenant_id: B.tenantId,
    employee_id: bEmpId,
    kind: "leave",
    start_at: LEAVE_FROM,
    end_at: LEAVE_TO,
    hours: 99,
    status: "approved",
    current_step: 1,
  })
}, 90_000)

afterAll(async () => {
  // payslips → attendance_days → leave_requests → employees → departments →
  // tenants → auth users (FK-safe order).
  for (const tid of createdTenantIds) {
    await supabaseAdmin.from("payslips").delete().eq("tenant_id", tid)
  }
  for (const tid of createdTenantIds) {
    await supabaseAdmin.from("attendance_days").delete().eq("tenant_id", tid)
  }
  for (const tid of createdTenantIds) {
    await supabaseAdmin.from("leave_requests").delete().eq("tenant_id", tid)
  }
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
}, 90_000)

// --- helpers -----------------------------------------------------------------

interface AttRow {
  employeeId: string
  workedMinutes: number
  lateDays: number
  lateMinutes: number
  overtimeMinutes: number
  nightMinutes: number
  presentDays: number
}

function byEmp(rows: AttRow[]): Map<string, AttRow> {
  const m = new Map<string, AttRow>()
  for (const r of rows) m.set(r.employeeId, r)
  return m
}

describe("F1 attendance report", () => {
  it("aggregates per-employee attendance over from..to (out-of-window ignored)", async () => {
    const res = await request(app)
      .get(`/reports/attendance?from=${FROM}&to=${TO}`)
      .set("Authorization", `Bearer ${A.adminToken}`)
    expect(res.status).toBe(200)
    const rows = res.body.rows as AttRow[]
    expect(Array.isArray(rows)).toBe(true)

    const m = byEmp(rows)
    const r1 = m.get(emp1Id)
    expect(r1).toBeDefined()
    expect(r1!.workedMinutes).toBe(EXPECT_EMP1.workedMinutes)
    expect(r1!.lateDays).toBe(EXPECT_EMP1.lateDays)
    expect(r1!.lateMinutes).toBe(EXPECT_EMP1.lateMinutes)
    expect(r1!.overtimeMinutes).toBe(EXPECT_EMP1.overtimeMinutes)
    expect(r1!.nightMinutes).toBe(EXPECT_EMP1.nightMinutes)
    expect(r1!.presentDays).toBe(EXPECT_EMP1.presentDays)

    const r2 = m.get(emp2Id)
    expect(r2).toBeDefined()
    expect(r2!.workedMinutes).toBe(EXPECT_EMP2.workedMinutes)
    expect(r2!.lateDays).toBe(EXPECT_EMP2.lateDays)
    expect(r2!.lateMinutes).toBe(EXPECT_EMP2.lateMinutes)
    expect(r2!.overtimeMinutes).toBe(EXPECT_EMP2.overtimeMinutes)
    expect(r2!.nightMinutes).toBe(EXPECT_EMP2.nightMinutes)
    expect(r2!.presentDays).toBe(EXPECT_EMP2.presentDays)
  })

  it("deptId filter returns only that department's employees", async () => {
    const res = await request(app)
      .get(`/reports/attendance?from=${FROM}&to=${TO}&deptId=${deptEngId}`)
      .set("Authorization", `Bearer ${A.adminToken}`)
    expect(res.status).toBe(200)
    const rows = res.body.rows as AttRow[]
    const ids = rows.map((r) => r.employeeId)
    expect(ids).toContain(emp1Id)
    expect(ids).not.toContain(emp2Id)
  })

  it("format=csv returns a text/csv body with a header + data rows and a BOM", async () => {
    const res = await request(app)
      .get(`/reports/attendance?from=${FROM}&to=${TO}&format=csv`)
      .set("Authorization", `Bearer ${A.adminToken}`)
    expect(res.status).toBe(200)
    expect(res.headers["content-type"]).toMatch(/text\/csv/)
    const text = res.text
    // UTF-8 BOM so Excel reads CJK correctly.
    expect(text.charCodeAt(0)).toBe(0xfeff)
    const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/)
    // Header + 2 employees.
    expect(lines.length).toBe(3)
    expect(lines[0]).toContain("employeeId")
    // Alice's 1080 worked minutes shows up somewhere in the data rows.
    expect(text).toContain("1080")
  })
})

describe("F1 payroll report", () => {
  it("lists each employee's payslip for the period + a total gross row", async () => {
    const res = await request(app)
      .get(`/reports/payroll?period=${PERIOD}`)
      .set("Authorization", `Bearer ${A.adminToken}`)
    expect(res.status).toBe(200)
    const rows = res.body.rows as Array<{ employeeId: string; gross: number }>
    const r1 = rows.find((r) => r.employeeId === emp1Id)
    const r2 = rows.find((r) => r.employeeId === emp2Id)
    expect(Number(r1?.gross)).toBe(EMP1_SLIP.gross)
    expect(Number(r2?.gross)).toBe(EMP2_SLIP.gross)

    expect(Number(res.body.total?.gross)).toBe(EXPECT_TOTAL_GROSS)
  })
})

describe("F1 leave report", () => {
  it("counts by kind × status with summed hours", async () => {
    const res = await request(app)
      .get(`/reports/leave?from=${FROM}&to=${TO}`)
      .set("Authorization", `Bearer ${A.adminToken}`)
    expect(res.status).toBe(200)
    const rows = res.body.rows as Array<{
      kind: string
      status: string
      count: number
      hours: number
    }>
    const find = (kind: string, status: string) =>
      rows.find((r) => r.kind === kind && r.status === status)

    expect(find("leave", "approved")).toMatchObject({ count: 1, hours: 8 })
    expect(find("leave", "pending")).toMatchObject({ count: 1, hours: 4 })
    expect(find("ot", "approved")).toMatchObject({ count: 1, hours: 2 })
    expect(find("fix_punch", "rejected")).toMatchObject({ count: 1, hours: 0 })
  })
})

describe("F1 headcount report", () => {
  it("totals + breakdown by status / dept / role", async () => {
    const res = await request(app)
      .get(`/reports/headcount`)
      .set("Authorization", `Bearer ${A.adminToken}`)
    expect(res.status).toBe(200)
    const body = res.body as {
      total: number
      byStatus: Record<string, number>
      byDept: Array<{ deptId: string | null; count: number }>
      byRole: Record<string, number>
    }
    // hr_admin (from provisionTenant) + emp1 + emp2 = 3, all active.
    expect(body.total).toBe(3)
    expect(body.byStatus.active).toBe(3)
    expect(body.byStatus.inactive ?? 0).toBe(0)
    expect(body.byRole.hr_admin).toBe(1)
    expect(body.byRole.employee).toBe(2)

    const dept = (id: string | null) => body.byDept.find((d) => d.deptId === id)?.count ?? 0
    expect(dept(deptEngId)).toBe(1)
    expect(dept(deptSalesId)).toBe(1)
  })
})

describe("F1 authorization & cross-tenant isolation", () => {
  it("a plain employee GET /reports/attendance → 403", async () => {
    const res = await request(app)
      .get(`/reports/attendance?from=${FROM}&to=${TO}`)
      .set("Authorization", `Bearer ${aEmployeeToken}`)
    expect(res.status).toBe(403)
  })

  it("a plain employee is forbidden from every report route", async () => {
    for (const path of [
      `/reports/payroll?period=${PERIOD}`,
      `/reports/leave?from=${FROM}&to=${TO}`,
      `/reports/headcount`,
    ]) {
      const res = await request(app)
        .get(path)
        .set("Authorization", `Bearer ${aEmployeeToken}`)
      expect(res.status).toBe(403)
    }
  })

  it("A's HR reports never include tenant B's data", async () => {
    // attendance: only A's employees.
    const att = await request(app)
      .get(`/reports/attendance?from=${FROM}&to=${TO}`)
      .set("Authorization", `Bearer ${A.adminToken}`)
    const attIds = (att.body.rows as AttRow[]).map((r) => r.employeeId)
    expect(attIds.sort()).toEqual([emp1Id, emp2Id].sort())

    // payroll: total gross is exactly A's (B's 11111 not mixed in).
    const pay = await request(app)
      .get(`/reports/payroll?period=${PERIOD}`)
      .set("Authorization", `Bearer ${A.adminToken}`)
    expect(Number(pay.body.total.gross)).toBe(EXPECT_TOTAL_GROSS)

    // leave: A has 4 requests total across the kinds; B's 1 is excluded.
    const lv = await request(app)
      .get(`/reports/leave?from=${FROM}&to=${TO}`)
      .set("Authorization", `Bearer ${A.adminToken}`)
    const totalCount = (lv.body.rows as Array<{ count: number }>).reduce(
      (s, r) => s + r.count,
      0,
    )
    expect(totalCount).toBe(4)

    // headcount: A is 3 (B's employees never counted).
    const hc = await request(app)
      .get(`/reports/headcount`)
      .set("Authorization", `Bearer ${A.adminToken}`)
    expect(hc.body.total).toBe(3)
  })
})
