import { pgTable, uuid, integer, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { employees } from "./employees"
import { leaveTypes } from "./leave-types"

/**
 * Leave balances (特休/請假餘額) — one row per employee per leave_type per `year`
 * tracking that entitlement bucket. HR sets `entitled` (and optional `deferred`
 * carry-over) via the API; approving a leave request of that type increments
 * `used` by the requested hours (auto-creating the row at used=hours when none
 * exists yet). The running remainder is entitled + deferred − used. The unique
 * (tenant_id, employee_id, leave_type_id, year) index makes the upsert idempotent
 * and is the conflict key for both HR's set and the approval-driven accrual.
 */
export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    year: integer("year").notNull(),
    entitled: numeric("entitled").notNull().default("0"),
    used: numeric("used").notNull().default("0"),
    deferred: numeric("deferred").notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantEmployeeTypeYearUnique: uniqueIndex("leave_balances_tenant_emp_type_year_uq").on(
      table.tenantId,
      table.employeeId,
      table.leaveTypeId,
      table.year,
    ),
  }),
)
