import { describe, it, expect } from "vitest";
import { parseRuleConfig } from "../rules-schema";
import { computeAttendanceDay } from "../worktime-engine";
import { computePayslip } from "../payroll-engine";
import type {
  AttendanceDay,
  RuleConfig,
  SalaryStructure,
  ShiftDef,
} from "../index";

/**
 * 三大特殊制度黃金測試 — 這三條釘住整個產品最重要的 IP 正確性。
 * 數字以人工算出寫死在期望值;引擎邏輯改動若偏離這些數字即視為回歸。
 */

// ---------------------------------------------------------------------------
// 共用：以「全月累計遲到分鐘」組出 N 天的 AttendanceDay,方便驅動全勤階梯。
// 把所有遲到放在第一天,其餘為 0,總和即為傳入值。
// ---------------------------------------------------------------------------
function daysWithTotalLate(totalLate: number, n = 22): AttendanceDay[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-05-${String(i + 1).padStart(2, "0")}`,
    workedMinutes: 8 * 60,
    lateMinutes: i === 0 ? totalLate : 0,
    overtimeMinutes: 0,
    nightMinutes: 0,
    dayType: "workday" as const,
  }));
}

// =========================================================================
// 規則一：全勤階梯 (base 2000; ≤5→扣0, ≤19→扣600, null→扣2000)
// =========================================================================
describe("規則一 全勤階梯扣款", () => {
  const rules: RuleConfig = parseRuleConfig({
    attendance_bonus: {
      base: 2000,
      tiers: [
        { lateMinutesUpTo: 5, deduct: 0 },
        { lateMinutesUpTo: 19, deduct: 600 },
        { lateMinutesUpTo: null, deduct: 2000 },
      ],
    },
    overtime: { rules: [] },
    night: { window: { from: "00:00", to: "08:30" }, multiplier: 2 },
    payroll: { method: "monthly", dailyRegularHours: 8 },
  });

  const salary: SalaryStructure = { method: "monthly", baseSalary: 0, hourlyWage: 200 };

  // table-driven 邊界：第5 vs 第6、第19 vs 第20
  const cases: { totalLate: number; deduct: number; bonus: number }[] = [
    { totalLate: 0, deduct: 0, bonus: 2000 },
    { totalLate: 5, deduct: 0, bonus: 2000 }, // 邊界:剛好 5 分仍不扣
    { totalLate: 6, deduct: 600, bonus: 1400 }, // 邊界:第6 分跳第二階
    { totalLate: 19, deduct: 600, bonus: 1400 }, // 邊界:剛好 19 分仍第二階
    { totalLate: 20, deduct: 2000, bonus: 0 }, // 邊界:第20 分跳封頂階
    { totalLate: 120, deduct: 2000, bonus: 0 },
  ];

  it.each(cases)(
    "全月累計遲到 $totalLate 分 → 扣 $deduct、全勤實發 $bonus",
    ({ totalLate, deduct, bonus }) => {
      const slip = computePayslip(daysWithTotalLate(totalLate), salary, rules);
      expect(slip.attendanceDeduction).toBe(deduct);
      expect(slip.attendanceBonus).toBe(bonus);
    },
  );
});

// =========================================================================
// 規則二：特殊加班 (hourlyWage=200)
//   例假日 8h × 1.67 不補休 → 2672,且不產生補休
//   夜間 00:00–08:30 8h × 2.0 → 3200
// =========================================================================
describe("規則二 特殊加班與夜間", () => {
  const hourlyWage = 200;

  it("例假日出勤 8 小時 × 1.67 = 2672,且不產生補休", () => {
    const rules: RuleConfig = parseRuleConfig({
      attendance_bonus: { base: 0, tiers: [{ lateMinutesUpTo: null, deduct: 0 }] },
      overtime: { rules: [{ when: "rest_day", multiplier: 1.67, compTime: false }] },
      night: { window: { from: "00:00", to: "08:30" }, multiplier: 2 },
      payroll: { method: "monthly", dailyRegularHours: 8 },
    });
    const salary: SalaryStructure = { method: "monthly", baseSalary: 0, hourlyWage };

    // 09:00–18:00 含 60 分休息 = 在班 9h − 1h = 實作 8h,落在例假日。
    const shift: ShiftDef = { start: "09:00", end: "18:00", breakMinutes: 60 };
    const day = computeAttendanceDay(
      { inAt: "2026-05-10T09:00:00", outAt: "2026-05-10T18:00:00" },
      shift,
      rules,
      { date: "2026-05-10", dayType: "rest_day" },
    );

    expect(day.workedMinutes).toBe(8 * 60);
    expect(day.overtimeMinutes).toBe(8 * 60); // 例假日全時數算加班

    const slip = computePayslip([day], salary, rules);
    expect(slip.overtimePay).toBe(2672); // 8 × 200 × 1.67
    expect(slip.compTimeMinutes).toBe(0); // 不補休
  });

  it("夜間 00:00–08:30 上班 8 小時 × 2.0 = 3200", () => {
    const rules: RuleConfig = parseRuleConfig({
      attendance_bonus: { base: 0, tiers: [{ lateMinutesUpTo: null, deduct: 0 }] },
      overtime: { rules: [] },
      night: { window: { from: "00:00", to: "08:30" }, multiplier: 2 },
      payroll: { method: "monthly", dailyRegularHours: 8 },
    });
    const salary: SalaryStructure = { method: "monthly", baseSalary: 0, hourlyWage };

    // 00:00–08:30 含 30 分休息 = 在班 8.5h − 0.5h = 實作 8h,整段落在夜間視窗。
    const shift: ShiftDef = {
      start: "00:00",
      end: "08:30",
      breakMinutes: 30,
      isNightShift: true,
    };
    const day = computeAttendanceDay(
      { inAt: "2026-05-10T00:00:00", outAt: "2026-05-10T08:30:00" },
      shift,
      rules,
      { date: "2026-05-10", dayType: "workday" },
    );

    expect(day.workedMinutes).toBe(8 * 60);
    expect(day.nightMinutes).toBe(8 * 60); // 實作 8h 全落夜間

    const slip = computePayslip([day], salary, rules);
    expect(slip.nightPay).toBe(3200); // 8 × 200 × 2.0
  });
});

// =========================================================================
// 規則三：計薪 (by_attendance_days, dailyWage 1600, dailyRegularHours 8,
//          overtimeFlatHourly 200)
//   月出勤 22 天 → 本俸 35200
//   某天做 10h(超 8h 兩小時) → 當日加班費 2×200 = 400
// =========================================================================
describe("規則三 按出勤天數計薪 + 固定時薪加班", () => {
  const rules: RuleConfig = parseRuleConfig({
    attendance_bonus: { base: 0, tiers: [{ lateMinutesUpTo: null, deduct: 0 }] },
    overtime: {
      rules: [{ when: "weekday_ot", multiplier: 1.34 }], // 倍率將被 flat 覆蓋
    },
    night: { window: { from: "00:00", to: "08:30" }, multiplier: 2 },
    payroll: {
      method: "by_attendance_days",
      overtimeFlatHourly: 200,
      dailyRegularHours: 8,
    },
  });
  const salary: SalaryStructure = {
    method: "by_attendance_days",
    dailyWage: 1600,
    hourlyWage: 9999, // 故意給離譜時薪,證明 flat 200 覆蓋之
  };

  it("月出勤 22 天 → 本俸 = 22 × 1600 = 35200", () => {
    const days: AttendanceDay[] = Array.from({ length: 22 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, "0")}`,
      workedMinutes: 8 * 60,
      lateMinutes: 0,
      overtimeMinutes: 0,
      nightMinutes: 0,
      dayType: "workday" as const,
    }));
    const slip = computePayslip(days, salary, rules);
    expect(slip.base).toBe(35200);
    expect(slip.regularPay).toBe(35200);
  });

  it("某天做 10 小時(超 8h 兩小時) → 當日加班費 = 2 × 200 = 400", () => {
    // 08:00–19:00 含 60 分休息 = 在班 11h − 1h = 實作 10h;超過 8h 兩小時。
    const shift: ShiftDef = { start: "08:00", end: "19:00", breakMinutes: 60 };
    const day = computeAttendanceDay(
      { inAt: "2026-05-10T08:00:00", outAt: "2026-05-10T19:00:00" },
      shift,
      rules,
      { date: "2026-05-10", dayType: "workday" },
    );
    expect(day.workedMinutes).toBe(10 * 60);
    expect(day.overtimeMinutes).toBe(2 * 60); // 超 8h 的 2h

    const slip = computePayslip([day], salary, rules);
    expect(slip.overtimePay).toBe(400); // 2 × 200 (flat),非倍率 9999×1.34
  });
});

// =========================================================================
// 補充：邊界 / 組合 (table-driven)
// =========================================================================
describe("worktime-engine 邊界", () => {
  const rules: RuleConfig = parseRuleConfig({
    attendance_bonus: { base: 0, tiers: [{ lateMinutesUpTo: null, deduct: 0 }] },
    overtime: { rules: [] },
    night: { window: { from: "00:00", to: "08:30" }, multiplier: 2 },
    payroll: { method: "monthly", dailyRegularHours: 8 },
  });

  it("遲到分鐘 = 上班時間 − 班表 start (早到記 0)", () => {
    const shift: ShiftDef = { start: "09:00", end: "18:00", breakMinutes: 60 };
    const late = computeAttendanceDay(
      { inAt: "2026-05-10T09:13:00", outAt: "2026-05-10T18:00:00" },
      shift,
      rules,
      { date: "2026-05-10", dayType: "workday" },
    );
    expect(late.lateMinutes).toBe(13);

    const early = computeAttendanceDay(
      { inAt: "2026-05-10T08:45:00", outAt: "2026-05-10T18:00:00" },
      shift,
      rules,
      { date: "2026-05-10", dayType: "workday" },
    );
    expect(early.lateMinutes).toBe(0);
  });

  it("跨午夜班 22:00→02:00 正確算工時與夜間重疊", () => {
    // 22:00 隔日 02:00 = 4h 在班,無休息。夜間視窗 00:00–08:30 → 只有 00:00–02:00
    // 這 2h 落在夜間。
    const shift: ShiftDef = { start: "22:00", end: "02:00", breakMinutes: 0 };
    const day = computeAttendanceDay(
      { inAt: "2026-05-10T22:00:00", outAt: "2026-05-11T02:00:00" },
      shift,
      rules,
      { date: "2026-05-10", dayType: "workday" },
    );
    expect(day.workedMinutes).toBe(4 * 60);
    expect(day.nightMinutes).toBe(2 * 60);
  });

  it("PunchRecord[] 多段(含中離)聚合為當日工時", () => {
    const shift: ShiftDef = { start: "09:00", end: "18:00", breakMinutes: 0 };
    const day = computeAttendanceDay(
      [
        { inAt: "2026-05-10T09:00:00", outAt: "2026-05-10T12:00:00" },
        { inAt: "2026-05-10T13:00:00", outAt: "2026-05-10T18:00:00" },
      ],
      shift,
      rules,
      { date: "2026-05-10", dayType: "workday" },
    );
    // 3h + 5h = 8h 實作;遲到以最早一段對班表 start 計 = 0。
    expect(day.workedMinutes).toBe(8 * 60);
    expect(day.overtimeMinutes).toBe(0);
    expect(day.lateMinutes).toBe(0);
  });
});

describe("payroll-engine 組合與稽核", () => {
  it("compTime=true 的加班只記補休、不發現金", () => {
    const rules: RuleConfig = parseRuleConfig({
      attendance_bonus: { base: 0, tiers: [{ lateMinutesUpTo: null, deduct: 0 }] },
      overtime: { rules: [{ when: "rest_day", multiplier: 2, compTime: true }] },
      night: { window: { from: "00:00", to: "08:30" }, multiplier: 2 },
      payroll: { method: "monthly", dailyRegularHours: 8 },
    });
    const salary: SalaryStructure = { method: "monthly", baseSalary: 0, hourlyWage: 200 };
    const day: AttendanceDay = {
      date: "2026-05-10",
      workedMinutes: 4 * 60,
      lateMinutes: 0,
      overtimeMinutes: 4 * 60,
      nightMinutes: 0,
      dayType: "rest_day",
    };
    const slip = computePayslip([day], salary, rules);
    expect(slip.overtimePay).toBe(0); // 轉補休不發現金
    expect(slip.compTimeMinutes).toBe(4 * 60);
  });

  it("月薪制本俸用 baseSalary;lines 逐項加總 = gross", () => {
    const rules: RuleConfig = parseRuleConfig({
      attendance_bonus: {
        base: 2000,
        tiers: [
          { lateMinutesUpTo: 5, deduct: 0 },
          { lateMinutesUpTo: null, deduct: 2000 },
        ],
      },
      overtime: { rules: [{ when: "weekday_ot", multiplier: 1.34 }] },
      night: { window: { from: "00:00", to: "08:30" }, multiplier: 2 },
      payroll: { method: "monthly", dailyRegularHours: 8 },
    });
    const salary: SalaryStructure = {
      method: "monthly",
      baseSalary: 40000,
      hourlyWage: 200,
    };
    const days: AttendanceDay[] = [
      {
        date: "2026-05-10",
        workedMinutes: 10 * 60,
        lateMinutes: 3,
        overtimeMinutes: 2 * 60,
        nightMinutes: 60,
        dayType: "workday",
      },
    ];
    const slip = computePayslip(days, salary, rules);
    // base 40000;OT 2h×200×1.34 = 536;夜間 1h×200×2 = 400;全勤累計遲到 3 分 → 扣 0 → 全勤 2000。
    expect(slip.base).toBe(40000);
    expect(slip.overtimePay).toBe(536);
    expect(slip.nightPay).toBe(400);
    expect(slip.attendanceBonus).toBe(2000);
    expect(slip.attendanceDeduction).toBe(0);
    expect(slip.gross).toBe(40000 + 536 + 400 + 2000);

    // lines 必須逐項加總回 gross (可稽核)。
    const sum = slip.lines.reduce((acc, l) => acc + l.amount, 0);
    expect(sum).toBe(slip.gross);
  });
});

describe("parseRuleConfig 防呆", () => {
  it("valid sample 不丟", () => {
    expect(() =>
      parseRuleConfig({
        attendance_bonus: { base: 1, tiers: [{ lateMinutesUpTo: null, deduct: 0 }] },
        overtime: { rules: [{ when: "rest_day", multiplier: 1.5 }] },
        night: { window: { from: "00:00", to: "08:30" }, multiplier: 2 },
        payroll: { method: "monthly", dailyRegularHours: 8 },
      }),
    ).not.toThrow();
  });

  it("tiers 非陣列 → 丟", () => {
    expect(() =>
      parseRuleConfig({
        attendance_bonus: { base: 1, tiers: "nope" },
        overtime: { rules: [] },
        night: { window: { from: "00:00", to: "08:30" }, multiplier: 2 },
        payroll: { method: "monthly" },
      }),
    ).toThrow();
  });

  it("overtime when 非閉集合值 → 丟", () => {
    expect(() =>
      parseRuleConfig({
        attendance_bonus: { base: 1, tiers: [{ lateMinutesUpTo: null, deduct: 0 }] },
        overtime: { rules: [{ when: "weekend_party", multiplier: 1.5 }] },
        night: { window: { from: "00:00", to: "08:30" }, multiplier: 2 },
        payroll: { method: "monthly" },
      }),
    ).toThrow();
  });

  it("night.window 非 HH:MM → 丟", () => {
    expect(() =>
      parseRuleConfig({
        attendance_bonus: { base: 1, tiers: [{ lateMinutesUpTo: null, deduct: 0 }] },
        overtime: { rules: [] },
        night: { window: { from: "25:00", to: "08:30" }, multiplier: 2 },
        payroll: { method: "monthly" },
      }),
    ).toThrow();
  });
});
