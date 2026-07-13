import { pgTable, uuid, text, numeric, date, timestamp, index } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { employees } from "./employees"
import { leaveRequests } from "./leave-requests"

/**
 * Comp-time ledger (補休) — an append-only ledger of compensatory-leave movements
 * for one employee. Approving an overtime request whose matching rule has
 * compTime=true posts an `hoursEarned` row (sourced from `sourceRequestId`); HR
 * can post manual adjustments (earn or use) via the API. The running balance is
 * sum(hoursEarned) − sum(hoursUsed) over the employee's rows. `expiresAt` is an
 * optional expiry date for an earned block (informational at P2). The
 * (tenant_id, employee_id) index powers "this employee's comp-time" reads.
 */
export const compTimeLedger = pgTable(
  "comp_time_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    sourceRequestId: uuid("source_request_id").references(() => leaveRequests.id),
    hoursEarned: numeric("hours_earned").notNull().default("0"),
    hoursUsed: numeric("hours_used").notNull().default("0"),
    note: text("note"),
    expiresAt: date("expires_at"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantEmployeeIdx: index("comp_time_ledger_tenant_employee_idx").on(
      table.tenantId,
      table.employeeId,
    ),
  }),
)
