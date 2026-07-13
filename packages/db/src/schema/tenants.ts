import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core"

/**
 * Tenants — the top-level white-label boundary. Every business table carries a
 * `tenant_id` that references this table for multi-tenant isolation.
 */
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  branding: jsonb("branding").notNull().default({}),
  features: jsonb("features").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
