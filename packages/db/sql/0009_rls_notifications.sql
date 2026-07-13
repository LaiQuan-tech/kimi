-- =====================================================================
-- 0009  RLS for P4-F1 通知佇列 (notifications) 的 DB 層兜底防線
--
-- 沿用 0001/0006/0007/0008 模型:current_tenant_id() 取 JWT app_metadata.tenant_id;
-- is_hr_admin() 為 SECURITY DEFINER（不觸發 employees RLS 遞迴）。
--   • API 用 service_role key → BYPASS RLS,不受影響(偵測引擎/worker 自身強制 tenant_id 寫入)。
--   • 前端/員工端用 anon key + 使用者 JWT → 受 RLS 約束。
-- 表與可見性(GROUP B:本人或 HR 可讀、僅 HR 可寫):
--   • notifications:通知佇列 — 收件員工只能看寄給自己的通知,HR 看全租戶;
--     僅 HR 可寫(偵測引擎/簽核流程經 service_role 入列,不受此限)。
-- 每個 CREATE POLICY 前加 DROP POLICY IF EXISTS 以保持冪等可重跑。
-- 套用方式:經 Supabase Management API query 端點。
-- 可逆:ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY; DROP POLICY ...
-- =====================================================================

-- ── notifications:GROUP B(本人或 HR 可讀;HR 可寫) ───────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_self_or_hr_read ON public.notifications;
CREATE POLICY notif_self_or_hr_read ON public.notifications
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

DROP POLICY IF EXISTS notif_hr_write ON public.notifications;
CREATE POLICY notif_hr_write ON public.notifications
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());
