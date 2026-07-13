import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { employees } from "./employees"

/** 健保眷屬投保資料 — an employee's NHI-enrolled dependents (眷口數 → 健保費). */
export const nhiDependents = pgTable("nhi_dependents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  name: text("name").notNull(),
  relationship: text("relationship"),
  idNumber: text("id_number"),
  insured: boolean("insured").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
