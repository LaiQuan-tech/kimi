import {
  computeAttendanceDay,
  parseRuleConfig,
  type PunchPair,
  type RuleConfig,
  type ShiftDef,
} from "@hr/rules"
import { supabaseAdmin } from "../lib/supabase.js"
import { DEFAULT_RULE_CONFIG } from "../lib/default-rule-config.js"

/**
 * Worktime settlement — the glue that wires the @hr/rules engine to real data.
 *
 * For a tenant + date range (+ optional single employee) it gathers, per
 * employee per work_date that has any punch or schedule:
 *   • that day's punch_records, paired into in/out PunchPairs,
 *   • the employee's schedule → shift (start/end/break) for the day,
 *   • the tenant's active rule_config (falling back to the default template),
 * then calls computeAttendanceDay and upserts the result into attendance_days.
 *
 * Idempotent: the (tenant_id, employee_id, work_date) unique index means a
 * re-run updates the existing settled row rather than duplicating it.
 */

const dateRe = /^\d{4}-\d{2}-\d{2}$/

interface PunchRow {
  employee_id: string
  type: string
  punch_at: string
}

interface ScheduleRow {
  employee_id: string
  work_date: string
  shift_id: string | null
}

interface ShiftRow {
  id: string
  start_time: string
  end_time: string
  break_minutes: number
}

/** ISO instant → "YYYY-MM-DD" day key by its UTC calendar date. */
function dayKeyOf(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

/**
 * Convert a stored UTC punch instant into a *business-local-naive* Date whose
 * LOCAL wall-clock fields (getHours/getMinutes/…) equal the instant's UTC
 * fields. The worktime engine projects the shift's "HH:MM" using local-time
 * `setHours`, so it must receive punches on the same wall clock as the shift.
 *
 * The product's business clock is UTC (the punch API scopes "today" with
 * Date.UTC), so we interpret every punch's UTC wall-clock as the business
 * clock. This makes settlement deterministic regardless of the host timezone
 * (a server in +08:00 and one in UTC produce identical attendance_days).
 */
function toBusinessLocal(iso: string): Date {
  const d = new Date(iso)
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  )
}

/**
 * Pair a single day's punches into in/out intervals. Punches are sorted by time
 * then walked: an 'in' opens a pair, the next 'out' closes it. Unpaired punches
 * (e.g. a lone 'in' with no 'out') are reported via `anomaly` and skipped.
 */
function pairPunches(punches: PunchRow[]): { pairs: PunchPair[]; unpaired: number } {
  const sorted = [...punches].sort(
    (a, b) => new Date(a.punch_at).getTime() - new Date(b.punch_at).getTime(),
  )
  const pairs: PunchPair[] = []
  let openIn: string | null = null
  let unpaired = 0
  for (const p of sorted) {
    if (p.type === "in") {
      if (openIn !== null) unpaired++ // previous 'in' never closed
      openIn = p.punch_at
    } else if (p.type === "out") {
      if (openIn !== null) {
        // Feed the engine business-local-naive Dates so its shift "HH:MM"
        // projection lines up with the punches' wall clock (see toBusinessLocal).
        pairs.push({ inAt: toBusinessLocal(openIn), outAt: toBusinessLocal(p.punch_at) })
        openIn = null
      } else {
        unpaired++ // 'out' with no preceding 'in'
      }
    }
  }
  if (openIn !== null) unpaired++ // trailing unmatched 'in'
  return { pairs, unpaired }
}

export interface SettleInput {
  tenantId: string
  from: string
  to: string
  employeeId?: string
}

export interface SettleResult {
  settled: number
}

export async function settleAttendance({
  tenantId,
  from,
  to,
  employeeId,
}: SettleInput): Promise<SettleResult> {
  if (!dateRe.test(from) || !dateRe.test(to)) {
    throw new Error("settleAttendance: from/to must be YYYY-MM-DD")
  }

  // --- tenant rule config (active) or default --------------------------------
  const { data: cfgRow, error: cfgErr } = await supabaseAdmin
    .from("rule_configs")
    .select("config")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (cfgErr) throw new Error(`settleAttendance (rule_config): ${cfgErr.message}`)
  let rules: RuleConfig
  try {
    rules = cfgRow?.config ? parseRuleConfig(cfgRow.config) : DEFAULT_RULE_CONFIG
  } catch {
    // A malformed stored config should not block settlement — fall back safely.
    rules = DEFAULT_RULE_CONFIG
  }

  // --- punches in window -----------------------------------------------------
  let punchQuery = supabaseAdmin
    .from("punch_records")
    .select("employee_id, type, punch_at")
    .eq("tenant_id", tenantId)
    .gte("punch_at", `${from}T00:00:00.000Z`)
    .lte("punch_at", `${to}T23:59:59.999Z`)
  if (employeeId) punchQuery = punchQuery.eq("employee_id", employeeId)
  const { data: punchData, error: punchErr } = await punchQuery
  if (punchErr) throw new Error(`settleAttendance (punches): ${punchErr.message}`)
  const punches = (punchData ?? []) as PunchRow[]

  // --- schedules in window ---------------------------------------------------
  let schedQuery = supabaseAdmin
    .from("schedules")
    .select("employee_id, work_date, shift_id")
    .eq("tenant_id", tenantId)
    .gte("work_date", from)
    .lte("work_date", to)
  if (employeeId) schedQuery = schedQuery.eq("employee_id", employeeId)
  const { data: schedData, error: schedErr } = await schedQuery
  if (schedErr) throw new Error(`settleAttendance (schedules): ${schedErr.message}`)
  const schedules = (schedData ?? []) as ScheduleRow[]

  // --- shift lookup ----------------------------------------------------------
  const shiftIds = Array.from(
    new Set(schedules.map((s) => s.shift_id).filter((id): id is string => !!id)),
  )
  const shiftById = new Map<string, ShiftRow>()
  if (shiftIds.length > 0) {
    const { data: shiftData, error: shiftErr } = await supabaseAdmin
      .from("shifts")
      .select("id, start_time, end_time, break_minutes")
      .eq("tenant_id", tenantId)
      .in("id", shiftIds)
    if (shiftErr) throw new Error(`settleAttendance (shifts): ${shiftErr.message}`)
    for (const s of (shiftData ?? []) as ShiftRow[]) shiftById.set(s.id, s)
  }

  // --- index punches & schedules by (employee, day) --------------------------
  const punchesByKey = new Map<string, PunchRow[]>()
  for (const p of punches) {
    const key = `${p.employee_id}|${dayKeyOf(p.punch_at)}`
    const arr = punchesByKey.get(key)
    if (arr) arr.push(p)
    else punchesByKey.set(key, [p])
  }
  const shiftByKey = new Map<string, ShiftRow | null>()
  const keys = new Set<string>()
  for (const s of schedules) {
    const key = `${s.employee_id}|${s.work_date}`
    keys.add(key)
    shiftByKey.set(key, s.shift_id ? (shiftById.get(s.shift_id) ?? null) : null)
  }
  // Punched days with no schedule still get settled (using a default shift).
  for (const key of punchesByKey.keys()) keys.add(key)

  // --- settle each (employee, day) -------------------------------------------
  const rows: Array<Record<string, unknown>> = []
  for (const key of keys) {
    const [empId, workDate] = key.split("|")
    const dayPunches = punchesByKey.get(key) ?? []
    const { pairs, unpaired } = pairPunches(dayPunches)

    const scheduledShift = shiftByKey.get(key) ?? null
    // Default shift when none is scheduled: a plain 9h day, no break. With no
    // shift the worked/late values still come straight from the punches.
    const shift: ShiftDef = scheduledShift
      ? {
          start: scheduledShift.start_time,
          end: scheduledShift.end_time,
          breakMinutes: scheduledShift.break_minutes ?? 0,
        }
      : { start: "00:00", end: "23:59", breakMinutes: 0 }

    const result = computeAttendanceDay(pairs, shift, rules, {
      date: workDate,
      // P2 has no calendar yet → every settled day is a workday.
      dayType: "workday",
    })

    rows.push({
      tenant_id: tenantId,
      employee_id: empId,
      work_date: workDate,
      worked_minutes: result.workedMinutes,
      late_minutes: result.lateMinutes,
      overtime_minutes: result.overtimeMinutes,
      night_minutes: result.nightMinutes,
      day_type: result.dayType,
      anomaly: unpaired > 0 ? { unpairedPunches: unpaired } : null,
    })
  }

  if (rows.length === 0) return { settled: 0 }

  const { error: upsertErr } = await supabaseAdmin
    .from("attendance_days")
    .upsert(rows, { onConflict: "tenant_id,employee_id,work_date" })
  if (upsertErr) throw new Error(`settleAttendance (upsert): ${upsertErr.message}`)

  return { settled: rows.length }
}
