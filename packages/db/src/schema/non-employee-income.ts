import { pgTable, uuid, text, numeric, date, timestamp } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"

/**
 * 非員工所得 — payments to non-employees (講師費/稿費/執行業務所得…) needing
 * withholding + possible 2nd-gen NHI supplementary premium. Not linked to an
 * employees row.
 */
export const nonEmployeeIncome = pgTable("non_employee_income", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  payeeName: text("payee_name").notNull(),
  idNumber: text("id_number"),
  incomeType: text("income_type"),
  amount: numeric("amount").notNull(),
  taxWithheld: numeric("tax_withheld").notNull().default("0"),
  supplementaryPremium: numeric("supplementary_premium").notNull().default("0"),
  payDate: date("pay_date"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
