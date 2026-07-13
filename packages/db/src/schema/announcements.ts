import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { employees } from "./employees"

/**
 * Announcements — the tenant bulletin board (公佈欄). HR publishes entries that
 * every employee in the tenant can read. `audience` is a coarse targeting tag
 * (default 'all'); `createdBy` records the authoring employee (nullable so a
 * deleted author does not cascade away the post). The (tenant_id, created_at)
 * index supports the common "latest announcements for my tenant" listing.
 */
export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    title: text("title").notNull(),
    body: text("body").notNull(),
    audience: text("audience").notNull().default("all"),
    createdBy: uuid("created_by").references(() => employees.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCreatedIdx: index("announcements_tenant_created_idx").on(table.tenantId, table.createdAt),
  }),
)
