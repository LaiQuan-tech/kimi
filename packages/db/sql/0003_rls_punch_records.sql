-- =====================================================================
-- 0003  RLS for punch_records — F3 打卡 的 DB 層兜底防線
--
-- 沿用 0001/0002 模型：current_tenant_id() 取 JWT app_metadata.tenant_id；
-- is_hr_admin() 為 SECURITY DEFINER（不觸發 employees RLS 遞迴）。
--   • API 用 service_role key → BYPASS RLS，不受影響。
--   • 前端/員工端用 anon key + 使用者 JWT → 受 RLS 約束。
-- 打卡特性：員工只能讀/寫「自己」的紀錄（防代打）；HR 可讀寫全租戶。
-- 每個 CREATE POLICY 前加 DROP POLICY IF EXISTS 以保持冪等可重跑。
-- 套用方式：經 Supabase Management API query 端點。
-- 可逆：ALTER TABLE public.punch_records DISABLE ROW LEVEL SECURITY; DROP POLICY ...
-- =====================================================================

ALTER TABLE public.punch_records ENABLE ROW LEVEL SECURITY;

-- ── 讀：本人或 HR ─────────────────────────────────────────────────
DROP POLICY IF EXISTS punch_self_or_hr_read ON public.punch_records;
CREATE POLICY punch_self_or_hr_read ON public.punch_records
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

-- ── 寫（INSERT）：只能替「自己」打卡（防代打） ───────────────────────
DROP POLICY IF EXISTS punch_self_insert ON public.punch_records;
CREATE POLICY punch_self_insert ON public.punch_records
  FOR INSERT WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND employee_id IN (
      SELECT id FROM public.employees
      WHERE user_id = auth.uid() AND tenant_id = public.current_tenant_id()
    )
  );

-- ── HR 全寫（補卡/更正/刪除） ─────────────────────────────────────
DROP POLICY IF EXISTS punch_hr_write ON public.punch_records;
CREATE POLICY punch_hr_write ON public.punch_records
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());
