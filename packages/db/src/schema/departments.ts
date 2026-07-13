import {
  pgTable,
  uuid,
  text,
  timestamp,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import { tenants } from "./tenants"

/**
 * Departments — organisational units scoped to a tenant. `parentId` is a
 * self-reference for the org tree (deferred reference to allow the
 * self-pointing FK). `managerEmpId` intentionally has NO DB-level FK to avoid a
 * circular dependency with `employees` (which references departments).
 */
export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  parentId: uuid("parent_id").references((): AnyPgColumn => departments.id),
  name: text("name").notNull(),
  managerEmpId: uuid("manager_emp_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
