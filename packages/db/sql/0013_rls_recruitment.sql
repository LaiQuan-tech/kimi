-- =====================================================================
-- 0013  RLS for recruitment (ATS) — 招募模組 的 DB 層兜底防線
-- candidates / interviews / offers：HR-only 讀寫。
-- job_requisitions：HR 讀寫 + 全員可讀「內部且 open」職缺 (內部職缺)。
-- service_role BYPASS RLS；冪等可重跑。套用：Management API /database/query 逐條。
-- =====================================================================
-- candidates / interviews / offers 各套 (以 <T> 代):
--   ALTER TABLE public.<T> ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY <T>_hr_all ON public.<T> FOR ALL
--     USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
--     WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());

ALTER TABLE public.job_requisitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_requisitions_hr_all ON public.job_requisitions;
CREATE POLICY job_requisitions_hr_all ON public.job_requisitions
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());

DROP POLICY IF EXISTS job_requisitions_internal_read ON public.job_requisitions;
CREATE POLICY job_requisitions_internal_read ON public.job_requisitions
  FOR SELECT USING (
    tenant_id = public.current_tenant_id() AND is_internal = true AND status = 'open'
  );
