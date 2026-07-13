-- =====================================================================
-- 0011  RLS for onboardings — 報到管理 (Foundation ▸ Hire) 的 DB 層兜底防線
-- 沿用 0001 模型：service_role BYPASS RLS；anon/authenticated 受約束。
-- onboardings 為 HR-only（讀寫皆限 HR）。冪等可重跑。
-- 套用方式：Supabase Management API /database/query（單語句逐條送）。
-- =====================================================================
ALTER TABLE public.onboardings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboardings_hr_read ON public.onboardings;
CREATE POLICY onboardings_hr_read ON public.onboardings
  FOR SELECT USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin());

DROP POLICY IF EXISTS onboardings_hr_write ON public.onboardings;
CREATE POLICY onboardings_hr_write ON public.onboardings
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());
