import { supabaseAdmin } from "../lib/supabase.js"

export interface ProvisionTenantInput {
  name: string
  adminEmail: string
  adminPassword: string
}

export interface ProvisionTenantResult {
  tenantId: string
  userId: string
}

/**
 * Provision a brand-new tenant and its first HR admin. Runs with the
 * service_role client (bypasses RLS) — only ever called behind the
 * platform-operator gate.
 *
 * Steps:
 *   1. insert tenants row (sane branding/features defaults)
 *   2. create the auth user with app_metadata.tenant_id = tenantId so the JWT
 *      carries the tenant on every future request (this is what RLS reads)
 *   3. insert the matching employees row (role hr_admin, active)
 *
 * P0 deliberately does NOT seed rule_configs (that table arrives in P2).
 *
 * Best-effort rollback: if a later step fails we tear down what we already
 * created so onboarding failures don't leave orphaned tenants/users behind.
 */
export async function provisionTenant({
  name,
  adminEmail,
  adminPassword,
}: ProvisionTenantInput): Promise<ProvisionTenantResult> {
  // 1. tenant
  const { data: tenant, error: tenantErr } = await supabaseAdmin
    .from("tenants")
    .insert({
      name,
      branding: { logoUrl: null, primaryColor: "#1F4E79", appName: name },
      features: { payroll: true, kpi: true, ai_assistant: true },
    })
    .select("id")
    .single()

  if (tenantErr || !tenant) {
    throw new Error(`provisionTenant: failed to create tenant: ${tenantErr?.message}`)
  }
  const tenantId = tenant.id as string

  // 2. auth user (carries tenant_id in app_metadata → drives JWT → RLS)
  const { data: created, error: userErr } = await supabaseAdmin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId },
  })

  if (userErr || !created?.user) {
    await supabaseAdmin.from("tenants").delete().eq("id", tenantId)
    throw new Error(`provisionTenant: failed to create admin user: ${userErr?.message}`)
  }
  const userId = created.user.id

  // 3. employees row
  const { error: empErr } = await supabaseAdmin.from("employees").insert({
    tenant_id: tenantId,
    user_id: userId,
    name,
    role: "hr_admin",
    employment_type: "regular",
    status: "active",
  })

  if (empErr) {
    await supabaseAdmin.auth.admin.deleteUser(userId)
    await supabaseAdmin.from("tenants").delete().eq("id", tenantId)
    throw new Error(`provisionTenant: failed to create employee: ${empErr.message}`)
  }

  return { tenantId, userId }
}
