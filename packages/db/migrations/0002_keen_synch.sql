CREATE TABLE IF NOT EXISTS "punch_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"punch_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"device_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "punch_records" ADD CONSTRAINT "punch_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "punch_records" ADD CONSTRAINT "punch_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "punch_records_tenant_employee_punch_at_idx" ON "punch_records" USING btree ("tenant_id","employee_id","punch_at");