CREATE TABLE IF NOT EXISTS "personal_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "personal_notes" ADD CONSTRAINT "personal_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "personal_notes" ADD CONSTRAINT "personal_notes_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "personal_notes_tenant_employee_unique" ON "personal_notes" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.is_hr_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.user_id = auth.uid()
      AND e.tenant_id = public.current_tenant_id()
      AND e.role IN ('hr_admin', 'platform_admin')
  );
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_hr_admin() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO anon, authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_hr_admin() TO anon, authenticated, service_role;--> statement-breakpoint
ALTER TABLE public.personal_notes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS personal_notes_self_or_hr_read ON public.personal_notes;--> statement-breakpoint
CREATE POLICY personal_notes_self_or_hr_read ON public.personal_notes
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      employee_id IN (
        SELECT id FROM public.employees
        WHERE user_id = (select auth.uid())
          AND tenant_id = public.current_tenant_id()
      )
      OR public.is_hr_admin()
    )
  );--> statement-breakpoint
DROP POLICY IF EXISTS personal_notes_self_write ON public.personal_notes;--> statement-breakpoint
CREATE POLICY personal_notes_self_write ON public.personal_notes
  FOR ALL
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND employee_id IN (
      SELECT id FROM public.employees
      WHERE user_id = (select auth.uid())
        AND tenant_id = public.current_tenant_id()
    )
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND employee_id IN (
      SELECT id FROM public.employees
      WHERE user_id = (select auth.uid())
        AND tenant_id = public.current_tenant_id()
    )
  );--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_notes TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_notes TO service_role;
