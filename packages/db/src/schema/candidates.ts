import { pgTable, uuid, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { jobRequisitions } from "./job-requisitions"

/**
 * Candidates — 人才庫 (Recruitment talent pool). Optionally linked to a
 * requisition. `status` tracks the pipeline: new|screening|interviewing|offered|
 * hired|rejected.
 */
export const candidates = pgTable("candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  requisitionId: uuid("requisition_id").references((): AnyPgColumn => jobRequisitions.id),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  source: text("source"),
  resumeUrl: text("resume_url"),
  status: text("status").notNull().default("new"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
