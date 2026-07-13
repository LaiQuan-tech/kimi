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
  const adminEmail = `rms-${stamp}-admin@example.com`
  const adminPassword = `Pw-${stamp}-Aa1!`
  const prov = await provisionTenant({ name: `RMSTEST ${stamp}`, adminEmail, adminPassword })
  tenantId = prov.tenantId
  createdTenantIds.push(prov.tenantId)
  createdUserIds.push(prov.userId)
  adminToken = await signIn(adminEmail, adminPassword)

  const empEmail = `rms-${stamp}-emp@example.com`
  const empPassword = `Pw-${stamp}-emp-Bb2!`
  const empRes = await request(app)
    .post("/employees")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ email: empEmail, name: "Emp One", password: empPassword, role: "employee" })
  if (empRes.status !== 201) throw new Error(`create emp failed (${empRes.status})`)
  createdUserIds.push(empRes.body.userId)
  empToken = await signIn(empEmail, empPassword)
}, 60_000)

afterAll(async () => {
  for (const tid of createdTenantIds) {
    for (const t of ["offers", "interviews", "candidates", "job_requisitions"]) {
      await supabaseAdmin.from(t).delete().eq("tenant_id", tid)
    }
    await supabaseAdmin.from("employees").delete().eq("tenant_id", tid)
    await supabaseAdmin.from("tenants").delete().eq("id", tid)
  }
  for (const uid of createdUserIds) await supabaseAdmin.auth.admin.deleteUser(uid)
}, 60_000)

describe("F-RMS 招募 ATS — requisition → candidate → interview → offer", () => {
  let reqId: string
  let candId: string

  it("HR creates an internal job requisition", async () => {
    const res = await request(app)
      .post("/job-requisitions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Backend Engineer", headcount: 2, isInternal: true, status: "open" })
    expect(res.status).toBe(201)
    reqId = res.body.id
  })

  it("GET /internal-jobs (any member) shows the open internal posting", async () => {
    const res = await request(app).get("/internal-jobs").set("Authorization", `Bearer ${empToken}`)
    expect(res.status).toBe(200)
    const jobs = res.body.internalJobs as Array<{ id: string; title: string }>
    expect(jobs.some((j) => j.id === reqId && j.title === "Backend Engineer")).toBe(true)
  })

  it("HR adds a candidate linked to the requisition", async () => {
    const res = await request(app)
      .post("/candidates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Cathy Candidate", email: "cathy@example.com", requisitionId: reqId })
    expect(res.status).toBe(201)
    candId = res.body.id

    const list = await request(app)
      .get(`/candidates?requisitionId=${reqId}`)
      .set("Authorization", `Bearer ${adminToken}`)
    expect(list.status).toBe(200)
    expect((list.body.candidates as Array<{ id: string }>).some((c) => c.id === candId)).toBe(true)
  })

  it("HR schedules an interview and records a pass result", async () => {
    const create = await request(app)
      .post("/interviews")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ candidateId: candId, scheduledAt: "2026-08-10T02:00:00.000Z", stage: "1st" })
    expect(create.status).toBe(201)
    const ivId = create.body.id

    const patch = await request(app)
      .patch(`/interviews/${ivId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ result: "pass", notes: "strong" })
    expect(patch.status).toBe(200)

    const { data } = await supabaseAdmin.from("interviews").select("result").eq("id", ivId).single()
    expect(data?.result).toBe("pass")
  })

  it("HR extends an offer and marks it accepted", async () => {
    const create = await request(app)
      .post("/offers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ candidateId: candId, salary: 65000, startDate: "2026-09-01", status: "sent" })
    expect(create.status).toBe(201)
    const offerId = create.body.id

    const patch = await request(app)
      .patch(`/offers/${offerId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "accepted" })
    expect(patch.status).toBe(200)
    const { data } = await supabaseAdmin.from("offers").select("status").eq("id", offerId).single()
    expect(data?.status).toBe("accepted")
  })

  it("a non-HR employee cannot manage requisitions/candidates → 403", async () => {
    const a = await request(app).get("/job-requisitions").set("Authorization", `Bearer ${empToken}`)
    expect(a.status).toBe(403)
    const b = await request(app)
      .post("/candidates")
      .set("Authorization", `Bearer ${empToken}`)
      .send({ name: "Nope" })
    expect(b.status).toBe(403)
  })

  it("invalid body → 400 (candidate requires a name)", async () => {
    const res = await request(app)
      .post("/candidates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "no-name@example.com" })
    expect(res.status).toBe(400)
  })
})
