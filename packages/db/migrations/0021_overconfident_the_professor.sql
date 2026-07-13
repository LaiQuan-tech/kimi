ALTER TABLE "employee_certifications" ADD COLUMN "attachment_file_name" text;--> statement-breakpoint
ALTER TABLE "employee_certifications" ADD COLUMN "attachment_storage_path" text;--> statement-breakpoint
ALTER TABLE "employee_certifications" ADD COLUMN "attachment_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "employee_certifications" ADD COLUMN "attachment_content_type" text;--> statement-breakpoint
ALTER TABLE "employee_educations" ADD COLUMN "proof_file_name" text;--> statement-breakpoint
ALTER TABLE "employee_educations" ADD COLUMN "proof_storage_path" text;--> statement-breakpoint
ALTER TABLE "employee_educations" ADD COLUMN "proof_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "employee_educations" ADD COLUMN "proof_content_type" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "photo_file_name" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "photo_storage_path" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "photo_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "photo_content_type" text;--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('employee-documents', 'employee-documents', false, 3145728, ARRAY['image/png','image/jpeg','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;
