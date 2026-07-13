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
let empId: string

async function signIn(email: string, password: string): Promise<string> {
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`signIn(${email}) failed: ${error?.message}`)
  return data.session.access_token
}

beforeAll(async () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("SUPABASE creds missing")
  const adminEmail = `tax-${stamp}-admin@example.com`
  const adminPassword = `Pw-${stamp}-Aa1!`
  const prov = await provisionTenant({ name: `TAXTEST ${stamp}`, adminEmail, adminPassword })
  tenantId = prov.tenantId
  createdTenantIds.push(prov.tenantId)
  createdUserIds.push(prov.userId)
  adminToken = await signIn(adminEmail, adminPassword)

  const empRes = await request(app)
    .post("/employees")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ email: `tax-${stamp}-emp@example.com`, name: "Emp One", password: `Pw-${stamp}-Bb2!`, role: "employee" })
  if (empRes.status !== 201) throw new Error(`create emp failed (${empRes.status})`)
  empId = empRes.body.employeeId
  createdUserIds.push(empRes.body.userId)
  empToken = await signIn(`tax-${stamp}-emp@example.com`, `Pw-${stamp}-Bb2!`)
}, 60_000)

afterAll(async () => {
  for (const tid of createdTenantIds) {
    for (const t of [
      "nhi_dependents",
      "income_tax_dependents",
      "salary_adjustments",
      "non_employee_income",
      "salary_structures",
    ]) {
      await supabaseAdmin.from(t).delete().eq("tenant_id", tid)
    }
    await supabaseAdmin.from("employees").delete().eq("tenant_id", tid)
    await supabaseAdmin.from("tenants").delete().eq("id", tid)
  }
  for (const uid of createdUserIds) await supabaseAdmin.auth.admin.deleteUser(uid)
}, 60_000)

describe("F-Tax 台灣薪資法規 — 計算端點 (@hr/rules 薄包裝)", () => {
  it("bonus_premium: 100k 先前 + 100k 本次, 投保 40k → 844", async () => {
    const res = await request(app)
      .post("/payroll/tax/compute")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ kind: "bonus_premium", monthlyInsuredSalary: 40000, cumulativeBonusBefore: 100000, thisBonus: 100000 })
    expect(res.status).toBe(200)
    expect(res.body.premium).toBe(844)
  })

  it("nhi_premium: 30k, 2 眷屬, 5.17%, 自付 30% → 1396", async () => {
    const res = await request(app)
      .post("/payroll/tax/compute")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ kind: "nhi_premium", insuredSalary: 30000, dependents: 2, rate: 0.0517, employeeShareRatio: 0.3 })
    expect(res.status).toBe(200)
    expect(res.body.premium).toBe(1396)
  })

  it("withholding: 100k, 門檻 88501 → 5000", async () => {
    const res = await request(app)
      .post("/payroll/tax/compute")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ kind: "withholding", monthlyPayment: 100000, threshold: 88501 })
    expect(res.status).toBe(200)
    expect(res.body.withholding).toBe(5000)
  })
})

describe("F-Tax 資料表 CRUD", () => {
  it("HR adds an NHI dependent; ?employeeId lists it", async () => {
    const res = await request(app)
      .post("/nhi-dependents")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ employeeId: empId, name: "配偶", relationship: "spouse" })
    expect(res.status).toBe(201)
    const list = await request(app)
      .get(`/nhi-dependents?employeeId=${empId}`)
      .set("Authorization", `Bearer ${adminToken}`)
    expect(list.status).toBe(200)
    expect((list.body["nhi-dependents"] as Array<{ employee_id: string }>).every((r) => r.employee_id === empId)).toBe(true)
  })

  it("HR adds an income-tax dependent", async () => {
    const res = await request(app)
      .post("/income-tax-dependents")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ employeeId: empId, name: "子女", relationship: "child", birthYear: 2015 })
    expect(res.status).toBe(201)
    const list = await request(app)
      .get(`/income-tax-dependents?employeeId=${empId}`)
      .set("Authorization", `Bearer ${adminToken}`)
    expect(list.status).toBe(200)
    expect(list.body["income-tax-dependents"][0].support_status).toBe("claimed")
  })

  it("批次調薪 import: 2 rows, 1 bad → count 1, errors 1", async () => {
    const csv = [
      "employeeId,effectiveDate,newSalary,reason",
      `${empId},2026-08-01,55000,merit`,
      `${empId},BAD,60000,typo`,
    ].join("\n")
    const res = await request(app)
      .post("/salary-adjustments/import")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ csv })
    expect(res.status).toBe(201)
    expect(res.body.count).toBe(1)
    expect(res.body.errors.length).toBe(1)
  })

  it("非員工所得: 50k → 自動算補充保費 1055", async () => {
    const res = await request(app)
      .post("/non-employee-income")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ payeeName: "講師甲", incomeType: "執行業務", amount: 50000, withholdRate: 0.1 })
    expect(res.status).toBe(201)
    expect(res.body.supplementaryPremium).toBe(1055)
    expect(res.body.taxWithheld).toBe(5000)
  })

  it("gap G: insured grades roundtrip on salary structure", async () => {
    const put = await request(app)
      .put(`/salary/${empId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ baseSalary: 40000, hourlyWage: 200, laborInsuredSalary: 40100, healthInsuredSalary: 40100 })
    expect(put.status).toBe(200)
    const get = await request(app)
      .get(`/salary/${empId}`)
      .set("Authorization", `Bearer ${adminToken}`)
    expect(get.status).toBe(200)
    expect(Number(get.body.salary.labor_insured_salary)).toBe(40100)
    expect(Number(get.body.salary.health_insured_salary)).toBe(40100)
  })

  it("gap I: tax-filing export returns CSV with the seeded payee", async () => {
    const res = await request(app)
      .get("/tax-filing/export?type=withholding")
      .set("Authorization", `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.headers["content-type"]).toContain("text/csv")
    expect(res.text).toContain("講師甲")
    const bad = await request(app)
      .get("/tax-filing/export?type=nope")
      .set("Authorization", `Bearer ${adminToken}`)
    expect(bad.status).toBe(400)
  })

  it("non-HR employee blocked from payroll-tax resources → 403", async () => {
    const a = await request(app).get("/salary-adjustments").set("Authorization", `Bearer ${empToken}`)
    expect(a.status).toBe(403)
    const b = await request(app)
      .post("/payroll/tax/compute")
      .set("Authorization", `Bearer ${empToken}`)
      .send({ kind: "withholding", monthlyPayment: 100000 })
    expect(b.status).toBe(403)
  })
})
