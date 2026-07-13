/**
 * worktime-engine — 純函式。把一天的打卡 + 班別 + 規則 + 日屬性,結算成
 * AttendanceDay(工時 / 遲到 / 加班 / 夜間,皆以分鐘計)。無 IO。
 */

import type { RuleConfig } from "./rules-schema.js";
import type {
  AttendanceDay,
  DayContext,
  PunchPair,
  ShiftDef,
} from "./types.js";

const MS_PER_MIN = 60_000;
const MIN_PER_DAY = 24 * 60;

/** Date | ISO string → epoch ms。 */
function toMs(d: Date | string): number {
  const ms = d instanceof Date ? d.getTime() : new Date(d).getTime();
  if (Number.isNaN(ms)) {
    throw new Error(`worktime-engine: invalid date value: ${String(d)}`);
  }
  return ms;
}

/** 'HH:MM' → 自午夜起的分鐘數。 */
function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** 取某 epoch ms 當天午夜(本地時區)的 epoch ms。 */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

interface Interval {
  start: number; // epoch ms
  end: number; // epoch ms
}

function normalizePairs(input: PunchPair | PunchPair[]): Interval[] {
  const pairs = Array.isArray(input) ? input : [input];
  return pairs.map((p) => {
    const start = toMs(p.inAt);
    const end = toMs(p.outAt);
    if (end < start) {
      throw new Error(
        `worktime-engine: outAt (${String(p.outAt)}) is before inAt (${String(p.inAt)})`,
      );
    }
    return { start, end };
  });
}

/**
 * 計算多個工作區間與「夜間視窗」重疊的分鐘數。
 * 夜間視窗以 from/to 的 'HH:MM' 給定;當 from >= to 視為跨午夜 (例如
 * 22:00–06:00、或 00:00–08:30 其實不跨,但 00:00–00:00 等特例一律當整日)。
 *
 * 作法:對每個工作區間所橫跨的每一個「本地日」,在該日投影出夜間視窗
 * 的實際 epoch 區段 (跨午夜則延伸到隔日),再與工作區間取交集累加。
 */
function nightOverlapMinutes(
  intervals: Interval[],
  windowFrom: string,
  windowTo: string,
): number {
  const fromMin = hhmmToMinutes(windowFrom);
  const toMin = hhmmToMinutes(windowTo);
  const crossesMidnight = fromMin >= toMin;

  let total = 0;
  for (const iv of intervals) {
    // 列舉工作區間覆蓋到的每個本地日午夜 (含起點前一日,以涵蓋跨午夜視窗)。
    const firstDay = startOfLocalDay(iv.start) - MIN_PER_DAY * MS_PER_MIN;
    const lastDay = startOfLocalDay(iv.end);
    for (let day = firstDay; day <= lastDay; day += MIN_PER_DAY * MS_PER_MIN) {
      const winStart = day + fromMin * MS_PER_MIN;
      const winEnd = crossesMidnight
        ? day + (toMin + MIN_PER_DAY) * MS_PER_MIN
        : day + toMin * MS_PER_MIN;
      const lo = Math.max(iv.start, winStart);
      const hi = Math.min(iv.end, winEnd);
      if (hi > lo) total += (hi - lo) / MS_PER_MIN;
    }
  }
  return Math.round(total);
}

/**
 * 結算一天。
 * @param punches 一個 in/out 對,或多段 (含中離)。
 * @param shift   班別 (start/end 'HH:MM'、breakMinutes)。
 * @param rules   RuleConfig (取 night.window 與 payroll.dailyRegularHours)。
 * @param ctx     該日屬性 (date + dayType)。
 */
export function computeAttendanceDay(
  punches: PunchPair | PunchPair[],
  shift: ShiftDef,
  rules: RuleConfig,
  ctx: DayContext,
): AttendanceDay {
  const intervals = normalizePairs(punches);
  if (intervals.length === 0) {
    return {
      date: ctx.date,
      workedMinutes: 0,
      lateMinutes: 0,
      overtimeMinutes: 0,
      nightMinutes: 0,
      dayType: ctx.dayType,
    };
  }

  // 在班總分鐘(各段相加)減去當日休息。
  const grossMinutes =
    intervals.reduce((acc, iv) => acc + (iv.end - iv.start) / MS_PER_MIN, 0);
  const workedMinutes = Math.max(
    0,
    Math.round(grossMinutes - shift.breakMinutes),
  );

  // 遲到:最早一段 inAt 相對「班表 start 投影到該 inAt 當天」的差。
  const earliestIn = Math.min(...intervals.map((iv) => iv.start));
  const shiftStartMs =
    startOfLocalDay(earliestIn) + hhmmToMinutes(shift.start) * MS_PER_MIN;
  const lateMinutes = Math.max(
    0,
    Math.round((earliestIn - shiftStartMs) / MS_PER_MIN),
  );

  // 加班:平日 = 超過 dailyRegularHours 的部分;例假/固定假 = 全部工時。
  const regularMinutes = rules.payroll.dailyRegularHours * 60;
  const overtimeMinutes =
    ctx.dayType === "workday"
      ? Math.max(0, workedMinutes - regularMinutes)
      : workedMinutes;

  // 夜間:工作區間與 night.window 的重疊,再上限到實際工時(避免把休息算進
  // 夜間;當整班都在夜間視窗時,休息分鐘自然從夜間時數扣除)。
  const rawNight = nightOverlapMinutes(
    intervals,
    rules.night.window.from,
    rules.night.window.to,
  );
  const nightMinutes = Math.min(rawNight, workedMinutes);

  return {
    date: ctx.date,
    workedMinutes,
    lateMinutes,
    overtimeMinutes,
    nightMinutes,
    dayType: ctx.dayType,
  };
}
