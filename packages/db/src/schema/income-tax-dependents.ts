import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { employees } from "./employees"

/** 所得稅扶養親屬資料 — dependents claimed for income-tax exemptions. */
export const incomeTaxDependents = pgTable("income_tax_dependents", {
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
  birthYear: integer("birth_year"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
