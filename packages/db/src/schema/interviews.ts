import { pgTable, uuid, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { candidates } from "./candidates"

/**
 * Interviews — 面試紀錄表 + 面試行事曆 (Recruitment). Belongs to a candidate;
 * `scheduledAt` powers the interview calendar. `result` is pending|pass|fail.
 * `interviewerEmpId` has no DB FK (kept flexible, mirrors managerEmpId style).
 */
export const interviews = pgTable("interviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  candidateId: uuid("candidate_id")
    .notNull()
    .references((): AnyPgColumn => candidates.id),
  interviewerEmpId: uuid("interviewer_emp_id"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  stage: text("stage"),
  result: text("result").notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
