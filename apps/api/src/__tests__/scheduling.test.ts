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

// A plain employee under tenant A (role='employee'); proves a normal user can
// read only their own schedules and cannot write shifts.
let aEmployeeEmail: string
let aEmployeePassword: string
let aEmployeeToken: string
let aEmployeeId: string
let aEmployeeUserId: string

// A second employee under A, used to prove the first employee cannot see
// somebody else's schedule rows.
let aOtherEmployeeId: string

// A shift created under tenant B, used to prove A cannot mutate it.
let bShiftId: string

async function buildTenant(label: string): Promise<Tenant> {
  const name = `SCHEDTEST ${label} ${stamp}`
  const adminEmail = `sch-${stamp}-${label}-admin@example.com`
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
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY missing — cannot run scheduling test")
  }

  A = await buildTenant("A")
  B = await buildTenant("B")

  // A real employee (own auth user + token) under A.
  aEmployeeEmail = `sch-${stamp}-a-emp@example.com`
  aEmployeePassword = `Pw-${stamp}-emp-Bb2!`
  const empRes = await request(app)
    .post("/employees")
    .set("Authorization", `Bearer ${A.adminToken}`)
    .send({
      email: aEmployeeEmail,
      name: "Alice Employee",
      password: aEmployeePassword,
      role: "employee",
    })
  if (empRes.status !== 201) {
    throw new Error(`beforeAll: create A employee failed (${empRes.status})`)
  }
  aEmployeeId = empRes.body.employeeId
  aEmployeeUserId = empRes.body.userId
  createdUserIds.push(aEmployeeUserId)
  aEmployeeToken = await signIn(aEmployeeEmail, aEmployeePassword)

  // A second employee under A (no auth user needed — just a row).
  const { data: other, error: otherErr } = await supabaseAdmin
    .from("employees")
    .insert({ tenant_id: A.tenantId, name: `Bob Other ${stamp}`, role: "employee" })
    .select("id")
    .single()
  if (otherErr || !other) {
    throw new Error(`beforeAll: A other-employee insert failed: ${otherErr?.message}`)
  }
  aOtherEmployeeId = other.id as string

  // A shift in B that A must never be able to touch.
  const { data: bShift, error: bShiftErr } = await supabaseAdmin
    .from("shifts")
    .insert({
      tenant_id: B.tenantId,
      name: `B-only Shift ${stamp}`,
      start_time: "09:00",
      end_time: "18:00",
    })
    .select("id")
    .single()
  if (bShiftErr || !bShift) {
    throw new Error(`beforeAll: B shift insert failed: ${bShiftErr?.message}`)
  }
  bShiftId = bShift.id as string
}, 60_000)

afterAll(async () => {
  // schedules → shifts → employees → tenants → auth users (respect FK order).
  for (const tid of createdTenantIds) {
    await supabaseAdmin.from("schedules").delete().eq("tenant_id", tid)
  }
  for (const tid of createdTenantIds) {
    await supabaseAdmin.from("shifts").delete().eq("tenant_id", tid)
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

describe("F2 shifts CRUD — tenant A, HR admin", () => {
  let shiftId: string

  it("POST /shifts creates a shift scoped to A → 201 { id }", async () => {
    const res = await request(app)
      .post("/shifts")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({
        name: `Day ${stamp}`,
        startTime: "09:00",
        endTime: "18:00",
        breakMinutes: 60,
        isNightShift: false,
      })

    expect(res.status).toBe(201)
    expect(typeof res.body.id).toBe("string")
    shiftId = res.body.id

    const { data } = await supabaseAdmin
      .from("shifts")
      .select("tenant_id, name, start_time, end_time, break_minutes, is_night_shift")
      .eq("id", shiftId)
      .single()
    expect(data?.tenant_id).toBe(A.tenantId)
    expect(data?.start_time).toBe("09:00")
    expect(data?.end_time).toBe("18:00")
    expect(data?.break_minutes).toBe(60)
    expect(data?.is_night_shift).toBe(false)
  })

  it("GET /shifts lists ONLY A's shifts (includes the new one, never B's)", async () => {
    const res = await request(app)
      .get("/shifts")
      .set("Authorization", `Bearer ${A.adminToken}`)

    expect(res.status).toBe(200)
    const rows = res.body.shifts as Array<{ id: string; tenant_id: string }>
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.every((r) => r.tenant_id === A.tenantId)).toBe(true)
    expect(rows.some((r) => r.id === shiftId)).toBe(true)
    expect(rows.some((r) => r.id === bShiftId)).toBe(false)
  })

  it("PATCH /shifts/:id updates fields (A only)", async () => {
    const res = await request(app)
      .patch(`/shifts/${shiftId}`)
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ name: `Day-Renamed ${stamp}`, breakMinutes: 30, isNightShift: true })

    expect(res.status).toBe(200)

    const { data } = await supabaseAdmin
      .from("shifts")
      .select("name, break_minutes, is_night_shift")
      .eq("id", shiftId)
      .single()
    expect(data?.name).toBe(`Day-Renamed ${stamp}`)
    expect(data?.break_minutes).toBe(30)
    expect(data?.is_night_shift).toBe(true)
  })

  it("DELETE /shifts/:id → 200, row gone", async () => {
    const res = await request(app)
      .delete(`/shifts/${shiftId}`)
      .set("Authorization", `Bearer ${A.adminToken}`)
    expect(res.status).toBe(200)

    const { data } = await supabaseAdmin
      .from("shifts")
      .select("id")
      .eq("id", shiftId)
      .maybeSingle()
    expect(data).toBeNull()
  })
})

describe("F2 schedules assign & query", () => {
  let shiftId: string
  const workDate = "2026-07-01"

  it("POST /shifts (setup) + POST /schedules assigns A's employee a day → 201", async () => {
    const shiftRes = await request(app)
      .post("/shifts")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ name: `Sched Shift ${stamp}`, startTime: "10:00", endTime: "19:00" })
    expect(shiftRes.status).toBe(201)
    shiftId = shiftRes.body.id

    const res = await request(app)
      .post("/schedules")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ employeeId: aEmployeeId, workDate, shiftId })

    expect(res.status).toBe(201)

    const { data } = await supabaseAdmin
      .from("schedules")
      .select("tenant_id, employee_id, work_date, shift_id, status")
      .eq("tenant_id", A.tenantId)
      .eq("employee_id", aEmployeeId)
      .eq("work_date", workDate)
      .single()
    expect(data?.tenant_id).toBe(A.tenantId)
    expect(data?.shift_id).toBe(shiftId)
    expect(data?.status).toBe("scheduled")
  })

  it("POST /schedules again for same employee+date upserts (no duplicate)", async () => {
    const res = await request(app)
      .post("/schedules")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ employeeId: aEmployeeId, workDate, shiftId: null, status: "day_off" })

    expect(res.status).toBe(201)

    const { data, error } = await supabaseAdmin
      .from("schedules")
      .select("id, shift_id, status")
      .eq("tenant_id", A.tenantId)
      .eq("employee_id", aEmployeeId)
      .eq("work_date", workDate)
    expect(error).toBeNull()
    expect(data?.length).toBe(1)
    expect(data?.[0].shift_id).toBeNull()
    expect(data?.[0].status).toBe("day_off")
  })

  it("POST /schedules supports batch assignments array", async () => {
    const res = await request(app)
      .post("/schedules")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({
        assignments: [
          { employeeId: aEmployeeId, workDate: "2026-07-02", shiftId },
          { employeeId: aOtherEmployeeId, workDate: "2026-07-02", shiftId },
        ],
      })

    expect(res.status).toBe(201)

    const { count } = await supabaseAdmin
      .from("schedules")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", A.tenantId)
      .eq("work_date", "2026-07-02")
    expect(count).toBe(2)
  })

  it("GET /schedules (HR) returns the whole tenant's schedules", async () => {
    const res = await request(app)
      .get("/schedules")
      .set("Authorization", `Bearer ${A.adminToken}`)

    expect(res.status).toBe(200)
    const rows = res.body.schedules as Array<{ employee_id: string; tenant_id: string }>
    expect(rows.every((r) => r.tenant_id === A.tenantId)).toBe(true)
    // Sees both A's employee and the other employee.
    expect(rows.some((r) => r.employee_id === aEmployeeId)).toBe(true)
    expect(rows.some((r) => r.employee_id === aOtherEmployeeId)).toBe(true)
  })

  it("GET /schedules (employee) returns ONLY the caller's own rows", async () => {
    const res = await request(app)
      .get("/schedules")
      .set("Authorization", `Bearer ${aEmployeeToken}`)

    expect(res.status).toBe(200)
    const rows = res.body.schedules as Array<{ employee_id: string }>
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.employee_id === aEmployeeId)).toBe(true)
    // The other employee's rows must not leak.
    expect(rows.some((r) => r.employee_id === aOtherEmployeeId)).toBe(false)
  })

  it("GET /schedules?employeeId=<other> as employee is forced back to self (never sees other)", async () => {
    const res = await request(app)
      .get(`/schedules?employeeId=${aOtherEmployeeId}`)
      .set("Authorization", `Bearer ${aEmployeeToken}`)

    expect(res.status).toBe(200)
    const rows = res.body.schedules as Array<{ employee_id: string }>
    expect(rows.some((r) => r.employee_id === aOtherEmployeeId)).toBe(false)
  })

  it("GET /schedules?from=&to= filters by date window (HR)", async () => {
    const res = await request(app)
      .get(`/schedules?from=2026-07-02&to=2026-07-02`)
      .set("Authorization", `Bearer ${A.adminToken}`)

    expect(res.status).toBe(200)
    const rows = res.body.schedules as Array<{ work_date: string }>
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.work_date === "2026-07-02")).toBe(true)
  })
})

describe("F2 authorization — non-HR employee cannot write shifts", () => {
  it("a role='employee' user POST /shifts → 403", async () => {
    const res = await request(app)
      .post("/shifts")
      .set("Authorization", `Bearer ${aEmployeeToken}`)
      .send({ name: `Nope ${stamp}`, startTime: "09:00", endTime: "18:00" })

    expect(res.status).toBe(403)
  })

  it("a role='employee' user POST /schedules → 403", async () => {
    const res = await request(app)
      .post("/schedules")
      .set("Authorization", `Bearer ${aEmployeeToken}`)
      .send({ employeeId: aEmployeeId, workDate: "2026-07-03" })

    expect(res.status).toBe(403)
  })
})

describe("F2 cross-tenant — A cannot mutate B's shift", () => {
  it("PATCH /shifts/:id of a B shift with A's token does NOT change B's row", async () => {
    const before = await supabaseAdmin
      .from("shifts")
      .select("name")
      .eq("id", bShiftId)
      .single()

    const res = await request(app)
      .patch(`/shifts/${bShiftId}`)
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ name: "HIJACKED BY A" })

    expect(res.status).toBe(404)

    const after = await supabaseAdmin
      .from("shifts")
      .select("name")
      .eq("id", bShiftId)
      .single()
    expect(after.data?.name).toBe(before.data?.name)
    expect(after.data?.name).not.toBe("HIJACKED BY A")
  })

  it("DELETE /shifts/:id of a B shift with A's token does NOT delete B's row", async () => {
    const res = await request(app)
      .delete(`/shifts/${bShiftId}`)
      .set("Authorization", `Bearer ${A.adminToken}`)

    expect(res.status).toBe(404)

    const { data } = await supabaseAdmin
      .from("shifts")
      .select("id")
      .eq("id", bShiftId)
      .maybeSingle()
    expect(data?.id).toBe(bShiftId)
  })
})

describe("F2 班表匯入 — HR bulk-imports a roster from CSV", () => {
  it("POST /schedules/import upserts every valid row → 201 { count, errors:[] }", async () => {
    const csv = [
      "employeeId,workDate,status",
      `${aEmployeeId},2026-07-10,scheduled`,
      `${aEmployeeId},2026-07-11,day_off`,
    ].join("\n")

    const res = await request(app)
      .post("/schedules/import")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ csv })

    expect(res.status).toBe(201)
    expect(res.body.count).toBe(2)
    expect(res.body.errors).toEqual([])

    const { count } = await supabaseAdmin
      .from("schedules")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", A.tenantId)
      .eq("employee_id", aEmployeeId)
      .in("work_date", ["2026-07-10", "2026-07-11"])
    expect(count).toBe(2)
  })

  it("a bad row is reported per-line and skipped; valid rows still import", async () => {
    const csv = [
      "employeeId,workDate",
      `${aEmployeeId},2026-07-12`,
      `${aEmployeeId},NOT-A-DATE`,
    ].join("\n")

    const res = await request(app)
      .post("/schedules/import")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ csv })

    expect(res.status).toBe(201)
    expect(res.body.count).toBe(1)
    expect(res.body.errors.length).toBe(1)
    expect(res.body.errors[0].line).toBe(3)
  })

  it("a CSV with no valid rows → 400 no_valid_rows", async () => {
    const csv = ["employeeId,workDate", `${aEmployeeId},NOPE`].join("\n")
    const res = await request(app)
      .post("/schedules/import")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ csv })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("no_valid_rows")
  })

  it("a non-HR employee cannot import → 403", async () => {
    const csv = ["employeeId,workDate", `${aEmployeeId},2026-07-13`].join("\n")
    const res = await request(app)
      .post("/schedules/import")
      .set("Authorization", `Bearer ${aEmployeeToken}`)
      .send({ csv })
    expect(res.status).toBe(403)
  })
})

describe("F2 班表審核 — employee acknowledges / disputes their roster", () => {
  let myScheduleId: string
  let otherScheduleId: string

  it("setup: HR assigns a row to the employee and to the other employee", async () => {
    const mine = await request(app)
      .post("/schedules")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ employeeId: aEmployeeId, workDate: "2026-07-20" })
    expect(mine.status).toBe(201)
    myScheduleId = mine.body.ids[0]

    const other = await request(app)
      .post("/schedules")
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({ employeeId: aOtherEmployeeId, workDate: "2026-07-20" })
    expect(other.status).toBe(201)
    otherScheduleId = other.body.ids[0]
  })

  it("the assigned employee acknowledges → status 'confirmed'", async () => {
    const res = await request(app)
      .post(`/schedules/${myScheduleId}/acknowledge`)
      .set("Authorization", `Bearer ${aEmployeeToken}`)
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("confirmed")

    const { data } = await supabaseAdmin
      .from("schedules")
      .select("status")
      .eq("id", myScheduleId)
      .single()
    expect(data?.status).toBe("confirmed")
  })

  it("the assigned employee disputes → status 'disputed'", async () => {
    const res = await request(app)
      .post(`/schedules/${myScheduleId}/dispute`)
      .set("Authorization", `Bearer ${aEmployeeToken}`)
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("disputed")
  })

  it("an employee cannot review someone else's schedule → 403", async () => {
    const res = await request(app)
      .post(`/schedules/${otherScheduleId}/acknowledge`)
      .set("Authorization", `Bearer ${aEmployeeToken}`)
      .send({})
    expect(res.status).toBe(403)

    // The other employee's row is untouched.
    const { data } = await supabaseAdmin
      .from("schedules")
      .select("status")
      .eq("id", otherScheduleId)
      .single()
    expect(data?.status).toBe("scheduled")
  })

  it("HR may acknowledge any row in the tenant", async () => {
    const res = await request(app)
      .post(`/schedules/${otherScheduleId}/acknowledge`)
      .set("Authorization", `Bearer ${A.adminToken}`)
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("confirmed")
  })

  it("reviewing a non-existent schedule → 404", async () => {
    const res = await request(app)
      .post(`/schedules/00000000-0000-0000-0000-000000000000/acknowledge`)
      .set("Authorization", `Bearer ${aEmployeeToken}`)
      .send({})
    expect(res.status).toBe(404)
  })
})
