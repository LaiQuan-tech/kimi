import { pgTable, uuid, text, date, timestamp } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { employees } from "./employees"

/** Prior (external) work experience — 工作經歷 (My Data). N per employee. */
export const employeeWorkHistory = pgTable("employee_work_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  company: text("company").notNull(),
  title: text("title"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
