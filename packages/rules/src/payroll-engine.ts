/**
 * payroll-engine — 純函式。把一個月的 AttendanceDay[] + 員工薪資結構 + 規則,
 * 結算成可稽核的 PayslipBreakdown。無 IO。
 *
 * gross = 本俸 + 加班費 + 夜間加給 + 全勤獎金(已淨額化:base − 階梯扣款)。
 * lines 逐項加總必然等於 gross。
 */

import type { OvertimeWhen, RuleConfig } from "./rules-schema.js";
import type {
  AttendanceDay,
  DayType,
  PayrollMethod,
  PayslipBreakdown,
  PayslipLine,
  SalaryStructure,
} from "./types.js";

/** DayType → 加班規則 when 的對應 (閉集合)。 */
const DAY_TYPE_TO_WHEN: Record<DayType, OvertimeWhen> = {
  workday: "weekday_ot",
  rest_day: "rest_day",
  fixed_holiday: "fixed_holiday",
};

/** 四捨五入到「分」以避免浮點殘差 (金額以整數元呈現)。 */
function round(n: number): number {
  return Math.round(n);
}

/**
 * 全勤獎金:以「全月累計遲到分鐘」套階梯。tiers 由小到大,取第一個
 * lateMinutesUpTo === null(封頂) 或 totalLate <= lateMinutesUpTo 的階。
 * 回傳該階扣款 (找不到任何階則扣 0)。
 */
function resolveAttendanceDeduction(
  totalLateMinutes: number,
  tiers: RuleConfig["attendance_bonus"]["tiers"],
): number {
  for (const tier of tiers) {
    if (tier.lateMinutesUpTo === null || totalLateMinutes <= tier.lateMinutesUpTo) {
      return tier.deduct;
    }
  }
  return 0;
}

export function computePayslip(
  days: AttendanceDay[],
  salary: SalaryStructure,
  rules: RuleConfig,
): PayslipBreakdown {
  const method: PayrollMethod = salary.method ?? rules.payroll.method;
  const hourlyWage = salary.hourlyWage;
  const flatHourly = rules.payroll.overtimeFlatHourly;

  // --- 本俸 -------------------------------------------------------------
  // 出勤天數 = 當天有實際工時的天數。
  const attendanceDays = days.filter((d) => d.workedMinutes > 0).length;
  const base =
    method === "by_attendance_days"
      ? round(attendanceDays * (salary.dailyWage ?? 0))
      : round(salary.baseSalary ?? 0);

  // --- 加班費 / 補休 -----------------------------------------------------
  let overtimePay = 0;
  let compTimeMinutes = 0;
  for (const day of days) {
    if (day.overtimeMinutes <= 0) continue;
    const when = DAY_TYPE_TO_WHEN[day.dayType];
    const rule = rules.overtime.rules.find((r) => r.when === when);
    if (!rule) continue; // 無對應規則 → 不計加班(亦不補休)
    if (rule.compTime) {
      compTimeMinutes += day.overtimeMinutes; // 轉補休,不發現金
      continue;
    }
    const hours = day.overtimeMinutes / 60;
    // 固定時薪制(若設定)覆蓋倍率制。
    overtimePay +=
      flatHourly !== undefined
        ? hours * flatHourly
        : hours * hourlyWage * rule.multiplier;
  }
  overtimePay = round(overtimePay);

  // --- 夜間加給 ----------------------------------------------------------
  const totalNightMinutes = days.reduce((acc, d) => acc + d.nightMinutes, 0);
  const nightPay = round(
    (totalNightMinutes / 60) * hourlyWage * rules.night.multiplier,
  );

  // --- 全勤獎金 (全月累計遲到 → 階梯扣款,從 base 扣) ----------------------
  const totalLateMinutes = days.reduce((acc, d) => acc + d.lateMinutes, 0);
  const bonusBase = rules.attendance_bonus.base;
  const attendanceDeduction = resolveAttendanceDeduction(
    totalLateMinutes,
    rules.attendance_bonus.tiers,
  );
  const attendanceBonus = bonusBase - attendanceDeduction;

  // --- gross + 逐項稽核明細 ---------------------------------------------
  const lines: PayslipLine[] = [
    { label: method === "by_attendance_days" ? "本俸(出勤天數)" : "本俸(月薪)", amount: base },
  ];
  if (overtimePay !== 0) lines.push({ label: "加班費", amount: overtimePay });
  if (nightPay !== 0) lines.push({ label: "夜間加給", amount: nightPay });
  // 全勤以「基準 − 扣款」兩條呈現,淨額即 attendanceBonus,且 lines 加總 = gross。
  lines.push({ label: "全勤獎金(基準)", amount: bonusBase });
  if (attendanceDeduction !== 0) {
    lines.push({ label: "全勤遲到扣款", amount: -attendanceDeduction });
  }

  const gross = base + overtimePay + nightPay + attendanceBonus;

  return {
    base,
    regularPay: base,
    overtimePay,
    nightPay,
    attendanceBonus,
    attendanceDeduction,
    compTimeMinutes,
    gross,
    lines,
  };
}
