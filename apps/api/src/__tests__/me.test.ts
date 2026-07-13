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

// Supabase lowercases stored emails — keep the local-part lowercase so our
// equality assertions against the address match what /me returns.
const stamp = Date.now()
const createdUserIds: string[] = []
const createdTenantIds: string[] = []

interface Tenant {
  tenantId: string
  adminEmail: string
  adminToken: string
}

let A: Tenant
let empEmail: string
let empToken: string
// A user whose JWT carries A's tenant_id but who has NO employees row.
let ghostToken: string

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
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY missing — cannot run me test")
  }

  const adminEmail = `me-${stamp}-admin@example.com`
  const adminPassword = `Pw-${stamp}-Aa1!`
  const { tenantId, userId } = await provisionTenant({
    name: `METEST ${stamp}`,
    adminEmail,
    adminPassword,
  })
  createdTenantIds.push(tenantId)
  createdUserIds.push(userId)
  const adminToken = await signIn(adminEmail, adminPassword)
  A = { tenantId, adminEmail, adminToken }

  // Invite an ordinary employee with a name we can assert on.
  empEmail = `me-${stamp}-emp@example.com`
  const empPassword = `Pw-${stamp}-Bb2!`
  const created = await request(app)
    .post("/employees")
    .set("Authorization", `Bearer ${A.adminToken}`)
    .send({ email: empEmail, name: "梅員工", password: empPassword, role: "employee" })
  if (created.status !== 201) {
    throw new Error(`invite employee failed (${created.status}): ${JSON.stringify(created.body)}`)
  }
  createdUserIds.push(created.body.userId)
  empToken = await signIn(empEmail, empPassword)

  // A user with A's tenant_id in app_metadata but no employees row → /me 404.
  const ghostEmail = `me-${stamp}-ghost@example.com`
  const ghostPassword = `Pw-${stamp}-Dd4!`
  const { data: ghost, error: ghostErr } = await supabaseAdmin.auth.admin.createUser({
    email: ghostEmail,
    password: ghostPassword,
    email_confirm: true,
    app_metadata: { tenant_id: A.tenantId },
  })
  if (ghostErr || !ghost?.user) throw new Error(`create ghost user failed: ${ghostErr?.message}`)
  createdUserIds.push(ghost.user.id)
  ghostToken = await signIn(ghostEmail, ghostPassword)
}, 60_000)

afterAll(async () => {
  // employees → tenants → auth users (respect FK order).
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

describe("F7 GET /me — caller's own employee profile", () => {
  it("an employee GET /me returns their own role/name/email", async () => {
    const res = await request(app).get("/me").set("Authorization", `Bearer ${empToken}`)
    expect(res.status).toBe(200)
    expect(res.body.name).toBe("梅員工")
    expect(res.body.role).toBe("employee")
    expect(res.body.email).toBe(empEmail)
    expect(typeof res.body.id).toBe("string")
    expect(res.body.status).toBe("active")
    // deptId/empNo were not set on invite → null.
    expect(res.body.deptId).toBeNull()
  })

  it("the HR admin GET /me reports the hr_admin role", async () => {
    const res = await request(app).get("/me").set("Authorization", `Bearer ${A.adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.role).toBe("hr_admin")
    expect(res.body.email).toBe(A.adminEmail)
  })

  it("a request with no token → 401", async () => {
    const res = await request(app).get("/me")
    expect(res.status).toBe(401)
  })

  it("a user whose JWT has a tenant but no employee row → 404", async () => {
    const res = await request(app).get("/me").set("Authorization", `Bearer ${ghostToken}`)
    expect(res.status).toBe(404)
  })
})
