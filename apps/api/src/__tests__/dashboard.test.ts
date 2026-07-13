import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createClient } from "@supabase/supabase-js"
import request from "supertest"
import { supabaseAdmin } from "../lib/supabase"
import { provisionTenant } from "../services/tenants"
import { app } from "../app"

const SUPABASE_URL = process.env.SUPABASE_URL ?? ""
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? ""

const stamp = Date.now()
const createdUserIds: string[] = []
const createdTenantIds: string[] = []

let adminToken: string
let tenantId: string
let empToken: string

async function signIn(email: string, password: string): Promise<string> {
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`signIn(${email}) failed: ${error?.message}`)
  return data.session.access_token
}

beforeAll(async () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("SUPABASE creds missing")
  const adminEmail = `dash-${stamp}-admin@example.com`
  const adminPassword = `Pw-${stamp}-Aa1!`
  const prov = await provisionTenant({ name: `DASHTEST ${stamp}`, adminEmail, adminPassword })
  tenantId = prov.tenantId
  createdTenantIds.push(prov.tenantId)
  createdUserIds.push(prov.userId)
  adminToken = await signIn(adminEmail, adminPassword)

  const empRes = await request(app)
    .post("/employees")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ email: `dash-${stamp}-emp@example.com`, name: "Emp", password: `Pw-${stamp}-Bb2!`, role: "employee" })
  createdUserIds.push(empRes.body.userId)
  empToken = await signIn(`dash-${stamp}-emp@example.com`, `Pw-${stamp}-Bb2!`)

  // Deterministic fixture rows (no auth users needed):
  //   甲 hired 2026-05-10 (May hire) — still active
  //   乙 hired 2026-04-01, terminated 2026-06-15 (June exit)
  //   丙 hired 2026-06-20 (June hire) — still active
  const { error } = await supabaseAdmin.from("employees").insert([
    { tenant_id: tenantId, name: "甲", role: "employee", status: "active", hire_date: "2026-05-10" },
    { tenant_id: tenantId, name: "乙", role: "employee", status: "inactive", hire_date: "2026-04-01", terminated_at: "2026-06-15" },
    { tenant_id: tenantId, name: "丙", role: "employee", status: "active", hire_date: "2026-06-20" },
  ])
  if (error) throw new Error(`seed employees: ${error.message}`)
}, 60_000)

afterAll(async () => {
  for (const tid of createdTenantIds) {
    await supabaseAdmin.from("employees").delete().eq("tenant_id", tid)
    await supabaseAdmin.from("tenants").delete().eq("id", tid)
  }
  for (const uid of createdUserIds) await supabaseAdmin.auth.admin.deleteUser(uid)
}, 60_000)

describe("F-Dash 在職人數分析 — GET /dashboard/headcount", () => {
  it("computes opening/hires/exits/closing per month", async () => {
    const res = await request(app)
      .get("/dashboard/headcount?from=2026-05&to=2026-06")
      .set("Authorization", `Bearer ${adminToken}`)
    expect(res.status).toBe(200)

    const may = res.body.series.find((m: { month: string }) => m.month === "2026-05")
    const jun = res.body.series.find((m: { month: string }) => m.month === "2026-06")
    // May: opening = 乙(hired 4/1) [+admin emp w/o hire_date + Emp w/o hire_date
    // count as employed-forever]; hires = 甲; exits = 0.
    expect(may.hires).toBe(1)
    expect(may.exits).toBe(0)
    // June: hires = 丙, exits = 乙; closing = opening + 1 - 1.
    expect(jun.hires).toBe(1)
    expect(jun.exits).toBe(1)
    expect(jun.closing).toBe(jun.opening)
    // totals aggregate the range.
    expect(res.body.totals.hires).toBe(2)
    expect(res.body.totals.exits).toBe(1)
  })

  it("bad range → 400; non-HR → 403", async () => {
    const bad = await request(app)
      .get("/dashboard/headcount?from=2026-07&to=2026-05")
      .set("Authorization", `Bearer ${adminToken}`)
    expect(bad.status).toBe(400)

    const denied = await request(app)
      .get("/dashboard/headcount?from=2026-05&to=2026-06")
      .set("Authorization", `Bearer ${empToken}`)
    expect(denied.status).toBe(403)
  })
})
