import { pgTable, uuid, text, jsonb, integer, boolean, timestamp } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"

/**
 * Rule configs — the per-tenant 差勤/薪資規則 DSL (validated by @hr/rules'
 * `parseRuleConfig`) stored as `config` jsonb. `scope` defaults to 'all'
 * (P2 supports a single tenant-wide config); `version` + `active` let a tenant
 * keep history while exactly one row is the live config the engines read.
 *
 * The worktime / payroll settlement loads the active row for the tenant and
 * feeds `config` straight into the rules engine.
 */
export const ruleConfigs = pgTable("rule_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  scope: text("scope").notNull().default("all"),
  config: jsonb("config").notNull(),
  version: integer("version").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
