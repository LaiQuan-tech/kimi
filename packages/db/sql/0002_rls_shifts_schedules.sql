-- =====================================================================
-- 0002  RLS for shifts & schedules — F2 班別與排班 的 DB 層兜底防線
--
-- 沿用 0001 的模型：current_tenant_id() 取 JWT app_metadata.tenant_id；
-- is_hr_admin() 為 SECURITY DEFINER（不觸發 employees RLS 遞迴）。
--   • API 用 service_role key → BYPASS RLS，不受影響。
--   • 前端/員工端用 anon key + 使用者 JWT → 受 RLS 約束。
-- 每個 CREATE POLICY 前加 DROP POLICY IF EXISTS 以保持冪等可重跑。
-- 套用方式：經 Supabase Management API query 端點。
-- 可逆：ALTER TABLE <t> DISABLE ROW LEVEL SECURITY; DROP POLICY ...
-- =====================================================================

-- ── shifts：GROUP A（同租戶可讀，HR 可寫） ──────────────────────────
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shifts_tenant_read ON public.shifts;
CREATE POLICY shifts_tenant_read ON public.shifts
  FOR SELECT USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS shifts_hr_write ON public.shifts;
CREATE POLICY shifts_hr_write ON public.shifts
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());

-- ── schedules：本人或 HR 可讀；HR 可寫 ─────────────────────────────
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedules_self_or_hr_read ON public.schedules;
CREATE POLICY schedules_self_or_hr_read ON public.schedules
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

DROP POLICY IF EXISTS schedules_hr_write ON public.schedules;
CREATE POLICY schedules_hr_write ON public.schedules
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());
