import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"

/**
 * Approval flows — per-tenant configuration of who approves a given request kind
 * and in what order. `appliesTo` is the request kind ('leave' | 'ot' |
 * 'fix_punch'); `approverEmpIds` is an ORDERED jsonb array of employee ids —
 * step 1 is the first id, step 2 the second, and so on. An empty array means
 * "no configured flow" and the request API falls back to a single HR-admin step.
 * Unique (tenant_id, applies_to) → exactly one flow per kind per tenant (upsert).
 */
export const approvalFlows = pgTable(
  "approval_flows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    appliesTo: text("applies_to").notNull(),
    approverEmpIds: jsonb("approver_emp_ids").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantAppliesToUnique: uniqueIndex("approval_flows_tenant_applies_to_uq").on(
      table.tenantId,
      table.appliesTo,
    ),
  }),
)
