import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { projects } from "./projects"

/**
 * Project documents — 專案知識庫檔案，比照 request_attachments。binary 存
 * 私有 storage bucket 'project-documents' 的 `storagePath`；此表是 tenant-scoped
 * 索引，API 列表 / 授權 / 短效簽名 URL 都靠它。專案文件全租戶可讀（知識庫），
 * 上傳/刪除限 HR / 專案成員 / lead。
 */
export const projectDocuments = pgTable("project_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  fileName: text("file_name").notNull(),
  storagePath: text("storage_path").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  contentType: text("content_type"),
  uploadedByEmpId: uuid("uploaded_by_emp_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
