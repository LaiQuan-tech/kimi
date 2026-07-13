import type { RuleConfig } from "@hr/rules"

/**
 * The default 差勤/薪資規則 template returned by GET /rule-config when a tenant
 * has not yet saved one of its own. It is a *valid* RuleConfig (passes
 * parseRuleConfig) describing sane Taiwan-flavoured defaults: a full-attendance
 * bonus with a single late tier, the three statutory overtime multipliers, a
 * 22:00–06:00 night window, and monthly payroll with an 8h regular day. Tenants
 * override any of this via PUT /rule-config.
 */
export const DEFAULT_RULE_CONFIG: RuleConfig = {
  attendance_bonus: {
    base: 0,
    tiers: [{ lateMinutesUpTo: null, deduct: 0 }],
  },
  overtime: {
    rules: [
      { when: "weekday_ot", multiplier: 1.34 },
      { when: "rest_day", multiplier: 1.67 },
      { when: "fixed_holiday", multiplier: 2 },
    ],
  },
  night: { window: { from: "22:00", to: "06:00" }, multiplier: 1.34 },
  payroll: { method: "monthly", dailyRegularHours: 8 },
}
