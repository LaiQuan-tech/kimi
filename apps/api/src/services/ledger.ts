import type { SupabaseClient } from "@supabase/supabase-js"
import { parseRuleConfig, type RuleConfig } from "@hr/rules"
import { logger } from "../lib/logger.js"
import { DEFAULT_RULE_CONFIG } from "../lib/default-rule-config.js"

/**
 * The fields of a leave_requests row the ledger effects need. Numerics arrive
 * from PostgREST as strings; `hours` may be null (estimate from the period).
 */
export interface ApprovedRequest {
  id: string
  employee_id: string
  kind: string
  leave_type_id: string | null
  hours: string | number | null
  start_at: string
  end_at: string
  /** OT 給付方式 the filer chose ('pay' | 'comp_time'); null/absent → rule config decides. */
  payout?: string | null
}

/** Whole hours between two ISO timestamps (>= 0), used when a request omits an
 * explicit `hours`. Rounded to 2dp so a 90-minute span reads 1.5, not 1.49999. */
function hoursBetween(startAt: string, endAt: string): number {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.round((ms / 3_600_000) * 100) / 100
}

/** Resolve the effective hours for a request: explicit `hours` wins, else derive
 * from start/end, else 0. */
function resolveHours(req: ApprovedRequest): number {
  if (req.hours != null) {
    const n = Number(req.hours)
    if (Number.isFinite(n)) return n
  }
  return hoursBetween(req.start_at, req.end_at)
}

/** The calendar year of a request's start, used as the leave_balances bucket. */
function requestYear(req: ApprovedRequest): number {
  const y = new Date(req.start_at).getUTCFullYear()
  return Number.isFinite(y) ? y : new Date().getUTCFullYear()
}

/**
 * Load the tenant's active rule config (parsed) or the default. A missing or
 * malformed stored config must never break approval — fall back safely.
 */
async function loadRules(supabase: SupabaseClient, tenantId: string): Promise<RuleConfig> {
  const { data, error } = await supabase
    .from("rule_configs")
    .select("config")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`ledger loadRules: ${error.message}`)
  if (!data?.config) return DEFAULT_RULE_CONFIG
  try {
    return parseRuleConfig(data.config)
  } catch {
    return DEFAULT_RULE_CONFIG
  }
}

/**
 * Does this tenant convert the given overtime to comp-time? P2 simplifies the
 * OT request to weekday overtime: prefer the explicit 'weekday_ot' rule, but if
 * it is absent treat ANY compTime:true rule as the signal (so a tenant that only
 * configured comp-time on rest_day/holiday still accrues).
 */
function overtimeIsCompTime(rules: RuleConfig): boolean {
  const weekday = rules.overtime.rules.find((r) => r.when === "weekday_ot")
  if (weekday) return weekday.compTime === true
  return rules.overtime.rules.some((r) => r.compTime === true)
}

/** Credit a comp-time block (hours_earned) sourced from the approved OT request. */
async function creditCompTime(
  supabase: SupabaseClient,
  tenantId: string,
  req: ApprovedRequest,
  hours: number,
): Promise<void> {
  const { error } = await supabase.from("comp_time_ledger").insert({
    tenant_id: tenantId,
    employee_id: req.employee_id,
    source_request_id: req.id,
    hours_earned: hours,
    hours_used: 0,
    note: "approved overtime → comp-time",
  })
  if (error) throw new Error(`ledger creditCompTime: ${error.message}`)
}

/**
 * Debit a leave balance: add `hours` to leave_balances.used for the
 * (tenant, employee, leave_type, year) bucket, creating the row at
 * used=hours / entitled=0 when it does not exist yet. Done read-then-write
 * (no DB trigger) — acceptable because approval is single-writer per request.
 */
async function debitLeaveBalance(
  supabase: SupabaseClient,
  tenantId: string,
  req: ApprovedRequest,
  leaveTypeId: string,
  hours: number,
): Promise<void> {
  const year = requestYear(req)

  const { data: existing, error: selErr } = await supabase
    .from("leave_balances")
    .select("id, used")
    .eq("tenant_id", tenantId)
    .eq("employee_id", req.employee_id)
    .eq("leave_type_id", leaveTypeId)
    .eq("year", year)
    .maybeSingle()
  if (selErr) throw new Error(`ledger debitLeaveBalance (select): ${selErr.message}`)

  if (existing) {
    const nextUsed = Number(existing.used ?? 0) + hours
    const { error: upErr } = await supabase
      .from("leave_balances")
      .update({ used: nextUsed, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
    if (upErr) throw new Error(`ledger debitLeaveBalance (update): ${upErr.message}`)
    return
  }

  const { error: insErr } = await supabase.from("leave_balances").insert({
    tenant_id: tenantId,
    employee_id: req.employee_id,
    leave_type_id: leaveTypeId,
    year,
    entitled: 0,
    used: hours,
    deferred: 0,
  })
  if (insErr) throw new Error(`ledger debitLeaveBalance (insert): ${insErr.message}`)
}

/**
 * Apply the ledger side-effects of FINAL approval of a request.
 *
 *   • kind='leave' with a leave_type_id → debit that leave balance by the
 *     request's hours (auto-creating the year bucket if needed).
 *   • kind='ot' whose tenant rule converts overtime to comp-time → credit a
 *     comp_time_ledger block of the request's hours.
 *   • anything else → no-op.
 *
 * MUST be best-effort: a ledger failure logs and returns without throwing so it
 * can never turn a successful approval into a 500. Reject/cancel never call this.
 */
export async function applyApprovalEffects(
  supabase: SupabaseClient,
  tenantId: string,
  req: ApprovedRequest,
): Promise<void> {
  try {
    const hours = resolveHours(req)

    if (req.kind === "leave" && req.leave_type_id) {
      if (hours > 0) {
        await debitLeaveBalance(supabase, tenantId, req, req.leave_type_id, hours)
      }
      return
    }

    if (req.kind === "ot") {
      if (hours <= 0) return
      // Explicit 給付方式 on the request wins (Apollo's 加班費/補休 choice);
      // only when the filer didn't choose do we fall back to the rule config.
      if (req.payout === "comp_time") {
        await creditCompTime(supabase, tenantId, req, hours)
        return
      }
      if (req.payout === "pay") return
      const rules = await loadRules(supabase, tenantId)
      if (overtimeIsCompTime(rules)) {
        await creditCompTime(supabase, tenantId, req, hours)
      }
      return
    }
  } catch (err) {
    // Never propagate — the approval itself already succeeded.
    logger.error({ err, requestId: req.id, tenantId }, "applyApprovalEffects failed")
  }
}
