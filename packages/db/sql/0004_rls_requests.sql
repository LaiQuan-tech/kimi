-- =====================================================================
-- 0004  RLS for F4 請假/加班/補卡 + 多關簽核 的 DB 層兜底防線
--
-- 沿用 0001 模型：current_tenant_id() 取 JWT app_metadata.tenant_id；
-- is_hr_admin() 為 SECURITY DEFINER（不觸發 employees RLS 遞迴）。
--   • API 用 service_role key → BYPASS RLS，不受影響（API 自身強制 tenant_id）。
--   • 前端/員工端用 anon key + 使用者 JWT → 受 RLS 約束。
-- 表與可見性：
--   • leave_types / approval_flows：GROUP A（同租戶可讀、HR 可寫設定檔）。
--   • leave_requests：本人（送單者）、HR、或「該單任一關的簽核人」可讀；
--                      本人可 INSERT 自己的單；HR 全寫。
--   • approval_steps：HR、該 step 的簽核人、或該單送單者本人可讀；HR 全寫。
-- 每個 CREATE POLICY 前加 DROP POLICY IF EXISTS 以保持冪等可重跑。
-- 套用方式：經 Supabase Management API query 端點。
-- 可逆：ALTER TABLE <t> DISABLE ROW LEVEL SECURITY; DROP POLICY ...
-- =====================================================================

-- ── leave_types：GROUP A（同租戶可讀，HR 可寫） ──────────────────────
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leave_types_tenant_read ON public.leave_types;
CREATE POLICY leave_types_tenant_read ON public.leave_types
  FOR SELECT USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS leave_types_hr_write ON public.leave_types;
CREATE POLICY leave_types_hr_write ON public.leave_types
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());

-- ── approval_flows：GROUP A（同租戶可讀，HR 可寫） ───────────────────
ALTER TABLE public.approval_flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approval_flows_tenant_read ON public.approval_flows;
CREATE POLICY approval_flows_tenant_read ON public.approval_flows
  FOR SELECT USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS approval_flows_hr_write ON public.approval_flows;
CREATE POLICY approval_flows_hr_write ON public.approval_flows
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());

-- ── leave_requests ──────────────────────────────────────────────────
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- 讀：本人（送單者）、HR、或該單任一關簽核人。
DROP POLICY IF EXISTS lr_read ON public.leave_requests;
CREATE POLICY lr_read ON public.leave_requests
  FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    AND (
      employee_id IN (
        SELECT id FROM public.employees
        WHERE user_id = auth.uid() AND tenant_id = public.current_tenant_id()
      )
      OR public.is_hr_admin()
      OR EXISTS (
        SELECT 1 FROM public.approval_steps s
        JOIN public.employees e ON e.id = s.approver_emp_id
        WHERE s.request_id = leave_requests.id AND e.user_id = auth.uid()
      )
    )
  );

-- 寫（INSERT）：只能替「自己」送單（員工本人）。
DROP POLICY IF EXISTS lr_self_insert ON public.leave_requests;
CREATE POLICY lr_self_insert ON public.leave_requests
  FOR INSERT WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND employee_id IN (
      SELECT id FROM public.employees
      WHERE user_id = auth.uid() AND tenant_id = public.current_tenant_id()
    )
  );

-- HR 全寫（簽核狀態機 / 更正）。
DROP POLICY IF EXISTS lr_hr_write ON public.leave_requests;
CREATE POLICY lr_hr_write ON public.leave_requests
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());

-- ── approval_steps ──────────────────────────────────────────────────
ALTER TABLE public.approval_steps ENABLE ROW LEVEL SECURITY;

-- 讀：HR、該 step 的簽核人、或該單送單者本人。
DROP POLICY IF EXISTS as_read ON public.approval_steps;
CREATE POLICY as_read ON public.approval_steps
  FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.is_hr_admin()
      OR approver_emp_id IN (
        SELECT id FROM public.employees
        WHERE user_id = auth.uid() AND tenant_id = public.current_tenant_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.leave_requests r
        JOIN public.employees e ON e.id = r.employee_id
        WHERE r.id = approval_steps.request_id AND e.user_id = auth.uid()
      )
    )
  );

-- HR 全寫（兜底；正常路徑由 API 以 service_role 驅動狀態機）。
DROP POLICY IF EXISTS as_hr_write ON public.approval_steps;
CREATE POLICY as_hr_write ON public.approval_steps
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());
