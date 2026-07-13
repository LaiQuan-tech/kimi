import { pgTable, uuid, text, integer, boolean, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { departments } from "./departments"

/**
 * Job requisitions — 職缺需求單 (Recruitment). `status` is draft|open|closed;
 * `isInternal` surfaces the opening as an 內部職缺 visible to employees. Approval
 * of a requisition can ride the shared request pipeline later; here it is a plain
 * HR-managed record with an open/closed lifecycle.
 */
export const jobRequisitions = pgTable("job_requisitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  title: text("title").notNull(),
  deptId: uuid("dept_id").references((): AnyPgColumn => departments.id),
  headcount: integer("headcount").notNull().default(1),
  employmentType: text("employment_type").notNull().default("regular"),
  description: text("description"),
  status: text("status").notNull().default("open"),
  isInternal: boolean("is_internal").notNull().default(false),
  createdByEmpId: uuid("created_by_emp_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
