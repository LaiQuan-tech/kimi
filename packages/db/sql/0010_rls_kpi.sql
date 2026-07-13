-- =====================================================================
-- 0010  RLS for P3-F2 考核 KPI（kpi_templates / kpi_reviews）的 DB 層兜底防線
--
-- 沿用 0001/0005/0008 模型:current_tenant_id() 取 JWT app_metadata.tenant_id;
-- is_hr_admin() 為 SECURITY DEFINER（不觸發 employees RLS 遞迴）。
--   • API 用 service_role key → BYPASS RLS,不受影響（API 自身強制 tenant_id +
--     評核者/HR 守衛）。
--   • 前端/員工端用 anon key + 使用者 JWT → 受 RLS 約束。
-- 表與可見性:
--   • kpi_templates:GROUP A（同租戶任一員工皆可讀、僅 HR 可寫）。考核表為
--     租戶共用設定,讓員工/評核者讀得到題項定義;建立/維護僅 HR。
--   • kpi_reviews:GROUP B 變體(三方可讀:HR 全租戶、受評者看自己、評核者看
--     自己被指派評的;僅 HR 可寫)。實際填分由評核者經 service_role 寫入,不受
--     此 write policy 限制——此處只是 anon 端兜底,確保前端直連時不能越權寫。
-- 每個 CREATE POLICY 前加 DROP POLICY IF EXISTS 以保持冪等可重跑。
-- 套用方式:經 Supabase Management API query 端點。
-- 可逆:ALTER TABLE <t> DISABLE ROW LEVEL SECURITY; DROP POLICY ...
-- =====================================================================

-- ── kpi_templates:GROUP A（同租戶可讀,HR 可寫） ─────────────────────
ALTER TABLE public.kpi_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kpi_templates_tenant_read ON public.kpi_templates;
CREATE POLICY kpi_templates_tenant_read ON public.kpi_templates
  FOR SELECT USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS kpi_templates_hr_write ON public.kpi_templates;
CREATE POLICY kpi_templates_hr_write ON public.kpi_templates
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());

-- ── kpi_reviews:HR 全租戶 / 受評者看自己 / 評核者看自己被指派的;HR 可寫 ──
ALTER TABLE public.kpi_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kpi_read ON public.kpi_reviews;
CREATE POLICY kpi_read ON public.kpi_reviews
  FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.is_hr_admin()
      OR employee_id IN (
        SELECT id FROM public.employees
        WHERE user_id = auth.uid() AND tenant_id = public.current_tenant_id()
      )
      OR reviewer_emp_id IN (
        SELECT id FROM public.employees
        WHERE user_id = auth.uid() AND tenant_id = public.current_tenant_id()
      )
    )
  );

DROP POLICY IF EXISTS kpi_hr_write ON public.kpi_reviews;
CREATE POLICY kpi_hr_write ON public.kpi_reviews
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());
