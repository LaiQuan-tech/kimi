-- =====================================================================
-- 0008  RLS for P2-F4 補休 / 特休餘額 ledgers 的 DB 層兜底防線
--
-- 沿用 0001/0006/0007 模型:current_tenant_id() 取 JWT app_metadata.tenant_id;
-- is_hr_admin() 為 SECURITY DEFINER（不觸發 employees RLS 遞迴）。
--   • API 用 service_role key → BYPASS RLS,不受影響（API 自身強制 tenant_id）。
--   • 前端/員工端用 anon key + 使用者 JWT → 受 RLS 約束。
-- 表與可見性（皆為 GROUP B：本人或 HR 可讀、僅 HR 可寫):
--   • comp_time_ledger:補休 ledger — 員工只能看自己的補休,HR 看全租戶;
--     僅 HR 可寫（手動調整;簽核流程經 service_role 寫入,不受此限）。
--   • leave_balances:特休/請假餘額 — 同上敏感度,本人或 HR 可讀、僅 HR 可寫。
-- 每個 CREATE POLICY 前加 DROP POLICY IF EXISTS 以保持冪等可重跑。
-- 套用方式:經 Supabase Management API query 端點。
-- 可逆:ALTER TABLE <t> DISABLE ROW LEVEL SECURITY; DROP POLICY ...
-- =====================================================================

-- ── comp_time_ledger:GROUP B（本人或 HR 可讀;HR 可寫） ────────────────
ALTER TABLE public.comp_time_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comp_time_ledger_self_or_hr_read ON public.comp_time_ledger;
CREATE POLICY comp_time_ledger_self_or_hr_read ON public.comp_time_ledger
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

DROP POLICY IF EXISTS comp_time_ledger_hr_write ON public.comp_time_ledger;
CREATE POLICY comp_time_ledger_hr_write ON public.comp_time_ledger
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());

-- ── leave_balances:GROUP B（本人或 HR 可讀;HR 可寫） ──────────────────
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_balances_self_or_hr_read ON public.leave_balances;
CREATE POLICY leave_balances_self_or_hr_read ON public.leave_balances
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

DROP POLICY IF EXISTS leave_balances_hr_write ON public.leave_balances;
CREATE POLICY leave_balances_hr_write ON public.leave_balances
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());
