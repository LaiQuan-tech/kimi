import { z } from "zod";

/**
 * RuleConfig — the tenant-configurable 差勤/薪資規則 DSL.
 *
 * Deliberately a *closed* declarative config (not a Turing-complete script):
 * every knob is a value the worktime / payroll engines read, so a tenant can
 * express the three special schemes the product must support out of the box
 * without ever running arbitrary code.
 *
 *   - attendance_bonus 全勤獎金: base 金額 + 遲到階梯扣款 (tiers)
 *   - overtime 加班: 多條條件式倍率規則 (可選補休 compTime)
 *   - night 夜間: 時段視窗 + 倍率
 *   - payroll 薪資: 計薪方式 (月薪 / 按出勤天數) + 加班參數
 */

// 'HH:MM' 24-hour clock literal, e.g. "00:00", "08:30", "23:59".
const HHMM = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected 'HH:MM' 24-hour time");

// 全勤獎金階梯：lateMinutesUpTo 為「累計遲到分鐘數上限」(含)，null 代表
// 「以上不封頂」(最後一階)。deduct 為落在該階時的扣款金額。
const AttendanceTierSchema = z.object({
  lateMinutesUpTo: z.number().nullable(),
  deduct: z.number(),
});

const AttendanceBonusSchema = z.object({
  base: z.number(),
  tiers: z.array(AttendanceTierSchema),
});

// 加班觸發情境的閉集合，對應 DayContext.dayType：
//   weekday_ot   ← workday      平日延長工時
//   rest_day     ← rest_day     例假日出勤
//   fixed_holiday ← fixed_holiday 國定/固定假日出勤
export const OvertimeWhenSchema = z.enum([
  "weekday_ot",
  "rest_day",
  "fixed_holiday",
]);
export type OvertimeWhen = z.infer<typeof OvertimeWhenSchema>;

// 加班規則：when 觸發情境、multiplier 倍率、compTime 是否改以補休
// (true = 不發現金，轉補休時數;預設 false 發現金)。
const OvertimeRuleSchema = z.object({
  when: OvertimeWhenSchema,
  multiplier: z.number(),
  compTime: z.boolean().optional(),
});

const OvertimeSchema = z.object({
  rules: z.array(OvertimeRuleSchema),
});

// 夜間加給：window 時段視窗 ("HH:MM"，允許跨午夜如 00:00–08:30)，multiplier 倍率。
const NightSchema = z.object({
  window: z.object({
    from: HHMM,
    to: HHMM,
  }),
  multiplier: z.number(),
});

// 計薪設定：
//   method            'monthly' 月薪 / 'by_attendance_days' 按出勤天數
//   overtimeFlatHourly 若設定，加班一律以此固定時薪計 (覆蓋倍率制)
//   dailyRegularHours  每日正常工時 (超過即算加班;折算時薪用)。預設 8。
const PayrollSchema = z.object({
  method: z.enum(["monthly", "by_attendance_days"]),
  overtimeFlatHourly: z.number().optional(),
  dailyRegularHours: z.number().default(8),
});

export const RuleConfigSchema = z.object({
  attendance_bonus: AttendanceBonusSchema,
  overtime: OvertimeSchema,
  night: NightSchema,
  payroll: PayrollSchema,
});

export type RuleConfig = z.infer<typeof RuleConfigSchema>;

/**
 * Parse-and-validate an unknown input into a typed RuleConfig.
 * Throws a ZodError when the input does not match the schema.
 */
export function parseRuleConfig(input: unknown): RuleConfig {
  return RuleConfigSchema.parse(input);
}
