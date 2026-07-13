import { pgTable, uuid, date, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { employees } from "./employees"
import { shifts } from "./shifts"

/**
 * Schedules — the assignment of a `shift` to one `employee` on a given
 * `workDate`. `shiftId` is nullable so a day can be marked (e.g. day off /
 * leave placeholder via `status`) without a concrete shift. The unique index on
 * (tenant_id, employee_id, work_date) makes "one schedule per employee per day"
 * a hard DB invariant and is what powers the upsert in the assign API.
 */
export const schedules = pgTable(
  "schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    workDate: date("work_date").notNull(),
    shiftId: uuid("shift_id").references(() => shifts.id),
    status: text("status").notNull().default("scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantEmployeeDateUnique: uniqueIndex("schedules_tenant_employee_date_uq").on(
      table.tenantId,
      table.employeeId,
      table.workDate,
    ),
  }),
)
