-- =====================================================================
-- 0006  RLS for P2-F2 薪資/規則/工時結算 的 DB 層兜底防線
--
-- 沿用 0001 模型：current_tenant_id() 取 JWT app_metadata.tenant_id；
-- is_hr_admin() 為 SECURITY DEFINER（不觸發 employees RLS 遞迴）。
--   • API 用 service_role key → BYPASS RLS，不受影響（API 自身強制 tenant_id）。
--   • 前端/員工端用 anon key + 使用者 JWT → 受 RLS 約束。
-- 表與可見性：
--   • rule_configs：GROUP A（同租戶任一員工皆可讀規則、僅 HR 可寫）。
--   • salary_structures：GROUP B（本人或 HR 可讀薪資、僅 HR 可寫）— 薪資為敏感 PII。
--   • attendance_days：GROUP B（本人或 HR 可讀出勤、僅 HR 可寫/結算）。
-- 每個 CREATE POLICY 前加 DROP POLICY IF EXISTS 以保持冪等可重跑。
-- 套用方式：經 Supabase Management API query 端點。
-- 可逆：ALTER TABLE <t> DISABLE ROW LEVEL SECURITY; DROP POLICY ...
-- =====================================================================

-- ── rule_configs：GROUP A（同租戶可讀，HR 可寫） ────────────────────
ALTER TABLE public.rule_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rule_configs_tenant_read ON public.rule_configs;
CREATE POLICY rule_configs_tenant_read ON public.rule_configs
  FOR SELECT USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS rule_configs_hr_write ON public.rule_configs;
CREATE POLICY rule_configs_hr_write ON public.rule_configs
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());

-- ── salary_structures：GROUP B（本人或 HR 可讀；HR 可寫） ─────────────
ALTER TABLE public.salary_structures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sal_self_or_hr_read ON public.salary_structures;
CREATE POLICY sal_self_or_hr_read ON public.salary_structures
  FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    AND (
      employee_id IN (
        SELECT id FROM public.employees
        WHERE user_id = auth.uid() AND tenant_id = public.current_tenant_id()
      )
      OR public.is_hr_admin()
    )
  );
DROP POLICY IF EXISTS sal_hr_write ON public.salary_structures;
CREATE POLICY sal_hr_write ON public.salary_structures
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());

-- ── attendance_days：GROUP B（本人或 HR 可讀；HR 可寫/結算） ──────────
ALTER TABLE public.attendance_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS att_self_or_hr_read ON public.attendance_days;
CREATE POLICY att_self_or_hr_read ON public.attendance_days
  FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    AND (
      employee_id IN (
        SELECT id FROM public.employees
        WHERE user_id = auth.uid() AND tenant_id = public.current_tenant_id()
      )
      OR public.is_hr_admin()
    )
  );
DROP POLICY IF EXISTS att_hr_write ON public.attendance_days;
CREATE POLICY att_hr_write ON public.attendance_days
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());
