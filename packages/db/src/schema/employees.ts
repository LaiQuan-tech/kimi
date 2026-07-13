import { pgTable, uuid, text, date, timestamp } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { departments } from "./departments"

/**
 * Employees — people belonging to a tenant. `userId` links to the auth user
 * (nullable until invited/registered). `deptId` references departments.
 */
export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  userId: uuid("user_id"),
  empNo: text("emp_no"),
  name: text("name").notNull(),
  deptId: uuid("dept_id").references(() => departments.id),
  employmentType: text("employment_type").notNull().default("regular"),
  hireDate: date("hire_date"),
  role: text("role").notNull().default("employee"),
  status: text("status").notNull().default("active"),
  // 離職日 — set when the employee is deactivated; drives Dashboard 離職 counts.
  terminatedAt: date("terminated_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
