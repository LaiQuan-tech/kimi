import { pgTable, uuid, text, jsonb, boolean, timestamp } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"

/**
 * KPI templates — a reusable 考核表 definition owned by a tenant. `items` is the
 * scored line-item list, each `{ key, label, weight, maxScore }`; weights are
 * conventionally expected to sum to 100 so a review's total is a 0–100 score.
 * `active` lets HR retire a template without deleting historical reviews that
 * reference it. The concrete per-employee scores live in the sibling
 * kpi_reviews rows.
 */
export const kpiTemplates = pgTable("kpi_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  name: text("name").notNull(),
  items: jsonb("items").notNull().default("[]"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
