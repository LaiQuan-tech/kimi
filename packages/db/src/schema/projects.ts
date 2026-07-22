import { pgTable, uuid, text, numeric, timestamp } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { departments } from "./departments"

/**
 * Projects — 專案，內部知識庫與獎金分潤的核心單位。
 * `deptId` 指向專案所屬部門（可空），驅動「部門主管可見旗下專案分潤」。
 * `leadEmpId` 是專案負責人的 employee id；比照 departments.managerEmpId
 * 刻意不設 DB FK 以避免與 employees 循環依賴。分潤兩種模式：
 *   • shareMode='pool_pct'  → 設 bonusPool 總額，每位成員給 sharePct（%），金額 = pool × pct。
 *   • shareMode='fixed_amount' → 直接對每位成員填 shareAmount，忽略 bonusPool。
 * 專案「資訊」全租戶可讀（知識庫），但成員分潤金額由 project_members 的 RLS 收斂。
 */
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  status: text("status").notNull().default("active"),
  deptId: uuid("dept_id").references(() => departments.id),
  leadEmpId: uuid("lead_emp_id"),
  shareMode: text("share_mode").notNull().default("pool_pct"),
  bonusPool: numeric("bonus_pool"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
