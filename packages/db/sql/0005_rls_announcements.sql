-- =====================================================================
-- 0005  RLS for F5 公佈欄(announcements) 的 DB 層兜底防線
--
-- 沿用 0001 模型：current_tenant_id() 取 JWT app_metadata.tenant_id；
-- is_hr_admin() 為 SECURITY DEFINER（不觸發 employees RLS 遞迴）。
--   • API 用 service_role key → BYPASS RLS，不受影響（API 自身強制 tenant_id）。
--   • 前端/員工端用 anon key + 使用者 JWT → 受 RLS 約束。
-- 表與可見性：
--   • announcements：GROUP A（同租戶任一員工皆可讀、僅 HR 可寫）。
-- 每個 CREATE POLICY 前加 DROP POLICY IF EXISTS 以保持冪等可重跑。
-- 套用方式：經 Supabase Management API query 端點。
-- 可逆：ALTER TABLE public.announcements DISABLE ROW LEVEL SECURITY; DROP POLICY ...
-- =====================================================================

-- ── announcements：GROUP A（同租戶可讀，HR 可寫） ────────────────────
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ann_tenant_read ON public.announcements;
CREATE POLICY ann_tenant_read ON public.announcements
  FOR SELECT USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS ann_hr_write ON public.announcements;
CREATE POLICY ann_hr_write ON public.announcements
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());
