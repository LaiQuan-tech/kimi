-- =====================================================================
-- 0007  RLS for P2-F3 薪資單 (payslips) 的 DB 層兜底防線
--
-- 沿用 0001/0006 模型:current_tenant_id() 取 JWT app_metadata.tenant_id;
-- is_hr_admin() 為 SECURITY DEFINER（不觸發 employees RLS 遞迴）。
--   • API 用 service_role key → BYPASS RLS,不受影響（API 自身強制 tenant_id）。
--   • 前端/員工端用 anon key + 使用者 JWT → 受 RLS 約束。
-- 表與可見性:
--   • payslips:GROUP B（本人或 HR 可讀薪資單、僅 HR 可寫/月結/finalize）—
--     薪資單為敏感 PII,員工只能看自己的,HR 看全租戶。
-- 每個 CREATE POLICY 前加 DROP POLICY IF EXISTS 以保持冪等可重跑。
-- 套用方式:經 Supabase Management API query 端點。
-- 可逆:ALTER TABLE public.payslips DISABLE ROW LEVEL SECURITY; DROP POLICY ...
-- =====================================================================

-- ── payslips:GROUP B（本人或 HR 可讀;HR 可寫/結算/finalize） ──────────
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ps_self_or_hr_read ON public.payslips;
CREATE POLICY ps_self_or_hr_read ON public.payslips
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

DROP POLICY IF EXISTS ps_hr_write ON public.payslips;
CREATE POLICY ps_hr_write ON public.payslips
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());
