import { describe, it, expect } from "vitest";
import { parseRuleConfig, RuleConfigSchema } from "../rules-schema";

// A realistic valid sample exercising the three special schemes the product
// must support out of the box:
//  1) 全勤獎金階梯：遲到累計 1–5 分鐘不扣、6 分鐘扣 600、20 分鐘以上扣 2000
//  2) 例假日加班 ×1.67 不補休；夜間 00:00–08:30 ×2
//  3) 薪資以實際出勤天數計算 (by_attendance_days)，加班以平日時薪 200 計
const validSample = {
  attendance_bonus: {
    base: 3000,
    tiers: [
      { lateMinutesUpTo: 5, deduct: 0 },
      { lateMinutesUpTo: 19, deduct: 600 },
      { lateMinutesUpTo: null, deduct: 2000 },
    ],
  },
  overtime: {
    rules: [
      { when: "rest_day", multiplier: 1.67, compTime: false },
      { when: "weekday_ot", multiplier: 1.34 },
    ],
  },
  night: {
    window: { from: "00:00", to: "08:30" },
    multiplier: 2,
  },
  payroll: {
    method: "by_attendance_days",
    overtimeFlatHourly: 200,
    dailyRegularHours: 8,
  },
};

describe("rules-schema", () => {
  it("parses a valid RuleConfig sample without throwing and returns the structure", () => {
    const parsed = parseRuleConfig(validSample);

    expect(parsed.attendance_bonus.base).toBe(3000);
    expect(parsed.attendance_bonus.tiers).toHaveLength(3);
    expect(parsed.attendance_bonus.tiers[0]).toEqual({ lateMinutesUpTo: 5, deduct: 0 });
    expect(parsed.attendance_bonus.tiers[2].lateMinutesUpTo).toBeNull();
    expect(parsed.attendance_bonus.tiers[2].deduct).toBe(2000);

    expect(parsed.overtime.rules[0]).toEqual({
      when: "rest_day",
      multiplier: 1.67,
      compTime: false,
    });
    expect(parsed.overtime.rules[1].multiplier).toBe(1.34);

    expect(parsed.night.window).toEqual({ from: "00:00", to: "08:30" });
    expect(parsed.night.multiplier).toBe(2);

    expect(parsed.payroll.method).toBe("by_attendance_days");
    expect(parsed.payroll.overtimeFlatHourly).toBe(200);
    expect(parsed.payroll.dailyRegularHours).toBe(8);
  });

  it("also accepts the monthly payroll method", () => {
    const monthly = {
      ...validSample,
      payroll: { method: "monthly" as const },
    };
    expect(() => parseRuleConfig(monthly)).not.toThrow();
  });

  it("throws on an invalid RuleConfig sample", () => {
    const invalidSample = {
      attendance_bonus: { base: "not-a-number", tiers: [] },
      overtime: { rules: [{ when: "holiday" }] }, // missing multiplier
      night: { window: { from: "00:00" }, multiplier: 2 }, // missing to
      payroll: { method: "weekly" }, // not an allowed method
    };
    expect(() => parseRuleConfig(invalidSample)).toThrow();
  });

  it("exposes RuleConfigSchema for direct safeParse use", () => {
    const result = RuleConfigSchema.safeParse(validSample);
    expect(result.success).toBe(true);
  });
});
