import { pgTable, uuid, text, jsonb, numeric, timestamp, unique } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { employees } from "./employees"
import { kpiTemplates } from "./kpi-templates"

/**
 * KPI reviews — one performance evaluation of `employeeId` (the reviewee) by
 * `reviewerEmpId` (the appraiser) against `templateId` for a `period`
 * (e.g. '2026-H1' / '2026-Q2'). `scores` mirrors the template's items as
 * `{ key, score, comment }`; `totalScore` is the weighted roll-up the API
 * computes from the template weights at score time. `status` is the review
 * state machine: draft → submitted → finalized (finalized is terminal and may
 * no longer be edited). The unique key keeps a reviewee/template/period to a
 * single review per tenant.
 */
export const kpiReviews = pgTable(
  "kpi_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    reviewerEmpId: uuid("reviewer_emp_id")
      .notNull()
      .references(() => employees.id),
    templateId: uuid("template_id")
      .notNull()
      .references(() => kpiTemplates.id),
    period: text("period").notNull(),
    scores: jsonb("scores").notNull().default("[]"),
    totalScore: numeric("total_score"),
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqReview: unique("kpi_reviews_tenant_emp_template_period_uq").on(
      table.tenantId,
      table.employeeId,
      table.templateId,
      table.period,
    ),
  }),
)
