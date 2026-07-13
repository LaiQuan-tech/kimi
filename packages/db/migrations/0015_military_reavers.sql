CREATE TABLE IF NOT EXISTS "employee_job_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"action" text NOT NULL,
	"dept_id" uuid,
	"dept_name" text,
	"grade" text,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_educations" ADD COLUMN "is_highest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_educations" ADD COLUMN "major_category" text;--> statement-breakpoint
ALTER TABLE "employee_educations" ADD COLUMN "study_type" text;--> statement-breakpoint
ALTER TABLE "employee_educations" ADD COLUMN "study_status" text;--> statement-breakpoint
ALTER TABLE "employee_educations" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "english_name" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "id_type" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "id_number" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "id_expiry" date;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "id_type2" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "id_number2" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "id_expiry2" date;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "id_type3" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "id_number3" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "id_expiry3" date;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "entry_date" date;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "phone_mobile2" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "phone_landline" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "registered_address" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "company_email" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "emergency_relationship" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_job_history" ADD CONSTRAINT "employee_job_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_job_history" ADD CONSTRAINT "employee_job_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_job_history" ADD CONSTRAINT "employee_job_history_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
