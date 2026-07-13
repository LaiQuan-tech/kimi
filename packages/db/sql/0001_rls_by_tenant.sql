-- =====================================================================
-- 0001  RLS by tenant — 多租戶行級隔離（DB 層兜底防線）
--
-- 模型（沿用 Realreal migration 0036 的 is_admin() SECURITY DEFINER 思路，
-- 改成 tenant 維度）：
--   • API 用 service_role key → BYPASS RLS，server 端讀寫不受影響。
--   • 前端/員工端用 anon key + 使用者 JWT 直接讀 → 受 RLS 約束。
--   • current_tenant_id() 從 JWT 的 app_metadata.tenant_id 取租戶。
--   • is_hr_admin() 為 SECURITY DEFINER（owner=postgres，BYPASSRLS）→
--     在函式內查 employees 不會觸發 RLS 遞迴。
-- 套用方式：經 Supabase Management API query 端點（本專案無直連 DB 密碼）。
-- 可逆：ALTER TABLE <t> DISABLE ROW LEVEL SECURITY; DROP FUNCTION ...
-- =====================================================================

-- ── 取目前請求的 tenant_id（來自 JWT app_metadata.tenant_id） ──────────
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid $$;

-- ── 目前使用者在該租戶是否為 HR/平台管理者 ────────────────────────────
CREATE OR REPLACE FUNCTION public.is_hr_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.user_id = auth.uid()
      AND e.tenant_id = public.current_tenant_id()
      AND e.role IN ('hr_admin', 'platform_admin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_hr_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_hr_admin() TO anon, authenticated, service_role;

-- ── departments：GROUP A（同租戶可讀，HR 可寫） ──────────────────────
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS departments_tenant_read ON public.departments;
CREATE POLICY departments_tenant_read ON public.departments
  FOR SELECT USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS departments_hr_write ON public.departments;
CREATE POLICY departments_hr_write ON public.departments
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());

-- ── employees：GROUP B（本人或 HR 可讀；HR 可寫） ───────────────────
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employees_self_or_hr_read ON public.employees;
CREATE POLICY employees_self_or_hr_read ON public.employees
  FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    AND (user_id = auth.uid() OR public.is_hr_admin())
  );
DROP POLICY IF EXISTS employees_hr_write ON public.employees;
CREATE POLICY employees_hr_write ON public.employees
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());

-- ── tenants：本體僅 service_role（啟 RLS、不給 policy → anon/authenticated 全擋） ──
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
