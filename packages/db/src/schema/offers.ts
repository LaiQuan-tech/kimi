import { pgTable, uuid, text, numeric, date, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { candidates } from "./candidates"

/**
 * Offers — 錄用申請單 / 錄用通知單 (Recruitment). Belongs to a candidate. `status`
 * is draft|approved|sent|accepted|declined. Accepting an offer is where a hire
 * would later flow into onboardings/employees.
 */
export const offers = pgTable("offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  candidateId: uuid("candidate_id")
    .notNull()
    .references((): AnyPgColumn => candidates.id),
  salary: numeric("salary"),
  startDate: date("start_date"),
  status: text("status").notNull().default("draft"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
