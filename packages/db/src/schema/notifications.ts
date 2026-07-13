import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { employees } from "./employees"

/**
 * Notifications — the delivery queue for the P4 detection engine and beyond. One
 * row per message addressed to a single recipient `employee` of a tenant. The
 * rule-based detectors (忘打卡 / 異常出勤) enqueue rows here with `status` 'pending';
 * a later delivery worker (LINE / Email) marks them 'sent' or 'failed' and
 * stamps `sentAt`. `type` classifies the message
 * (missing_punch | anomaly | approval | report | announcement), `channel` picks
 * the transport (inapp | line | email, default 'inapp'), and `payload` carries
 * structured context (e.g. the offending date / issue) for rendering and audit.
 *
 * The (tenant_id, employee_id, status) index powers both the in-app inbox read
 * ("my unread") and the worker's "pending in this tenant" sweep.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    channel: text("channel").notNull().default("inapp"),
    status: text("status").notNull().default("pending"),
    payload: jsonb("payload").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => ({
    tenantEmployeeStatusIdx: index("notifications_tenant_employee_status_idx").on(
      table.tenantId,
      table.employeeId,
      table.status,
    ),
  }),
)
