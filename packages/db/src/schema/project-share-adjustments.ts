import { pgTable, uuid, text, numeric, timestamp } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { projects } from "./projects"
import { employees } from "./employees"

/**
 * Project share adjustments — 分潤異動稽核（「隨時可調整」留痕），比照
 * salary_adjustments。每次改動一位成員的 pct/amount 或專案 pool 就寫一列。
 * `field`：'pct' | 'amount' | 'pool'；oldValue/newValue 為對應數值（可空）。
 * `changedByEmpId` 記錄操作者（HR/lead/部門主管）的 employee id。
 * 可見性同 project_members（本人 / lead / 部門主管 / HR）。
 */
export const projectShareAdjustments = pgTable("project_share_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  employeeId: uuid("employee_id").references(() => employees.id),
  field: text("field").notNull(),
  oldValue: numeric("old_value"),
  newValue: numeric("new_value"),
  reason: text("reason"),
  changedByEmpId: uuid("changed_by_emp_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
