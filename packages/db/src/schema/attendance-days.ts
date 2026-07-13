import { pgTable, uuid, text, date, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { employees } from "./employees"

/**
 * Attendance days — the materialised output of the worktime engine: one settled
 * row per employee per `work_date`. The settlement job pairs that day's punches
 * with the employee's shift + the tenant's active rule config, calls
 * `computeAttendanceDay`, and upserts the resulting worked/late/overtime/night
 * minutes here (all integer minutes). `day_type` mirrors the engine's DayType
 * ('workday' | 'rest_day' | 'fixed_holiday'); `anomaly` carries optional
 * settlement notes (e.g. an unpaired punch). The unique (tenant_id,
 * employee_id, work_date) index makes the settlement idempotent (re-running
 * updates rather than duplicates) and powers payroll/report reads downstream.
 */
export const attendanceDays = pgTable(
  "attendance_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    workDate: date("work_date").notNull(),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    nightMinutes: integer("night_minutes").notNull().default(0),
    dayType: text("day_type").notNull().default("workday"),
    anomaly: jsonb("anomaly"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantEmployeeDateUnique: uniqueIndex("attendance_days_tenant_employee_date_uq").on(
      table.tenantId,
      table.employeeId,
      table.workDate,
    ),
  }),
)
