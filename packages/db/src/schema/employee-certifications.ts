import { pgTable, uuid, text, date, timestamp, integer } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { employees } from "./employees"

/** Employee certifications/licenses — 證照 (My Data ▸ 學歷證照). N per employee. */
export const employeeCertifications = pgTable("employee_certifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  name: text("name").notNull(),
  issuer: text("issuer"),
  issuedDate: date("issued_date"),
  expiryDate: date("expiry_date"),
  attachmentFileName: text("attachment_file_name"),
  attachmentStoragePath: text("attachment_storage_path"),
  attachmentSizeBytes: integer("attachment_size_bytes"),
  attachmentContentType: text("attachment_content_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
