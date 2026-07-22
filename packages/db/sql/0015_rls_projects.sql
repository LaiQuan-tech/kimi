-- =====================================================================
-- 0015  RLS for 專案 / 分潤 / 知識庫（DB 層兜底防線）
--
-- 沿用 0001 模型：current_tenant_id() 取 JWT app_metadata.tenant_id；
-- is_hr_admin() 為 SECURITY DEFINER（不觸發 employees RLS 遞迴）。
--   • API 用 service_role key → BYPASS RLS，不受影響（API 自身強制 tenant_id
--     並在 handler 內依角色分流；那才是 load-bearing 的隱私把關）。
--   • 前端/員工端用 anon key + 使用者 JWT → 受本檔 RLS 約束（兜底）。
-- 表與可見性：
--   • projects：GROUP A（同租戶皆可讀＝知識庫全公司可見；HR 或該專案 lead 可寫）。
--   • project_documents：GROUP A 讀（全員可讀/下載）；HR / 專案成員 / lead 可寫。
--   • project_members：敏感（含分潤金額）。讀＝本人 or HR or 該專案 lead or
--     該專案所屬部門的主管（遞迴子部門）；寫＝HR / lead / 部門主管。
--   • project_share_adjustments：同 project_members 可見規則。
-- 每個 CREATE POLICY 前加 DROP POLICY IF EXISTS 以保持冪等可重跑。
-- 套用方式：經 Supabase Management API query 端點。
-- 可逆：ALTER TABLE <t> DISABLE ROW LEVEL SECURITY; DROP POLICY ...; DROP FUNCTION ...
-- =====================================================================

-- ── 輔助函式（SECURITY DEFINER，避免遞迴查表觸發 RLS） ────────────────

-- 呼叫者是否為某專案的負責人：projects.lead_emp_id 指向自己，或在
-- project_members 內以 role_in_project='lead' 掛在該專案。
CREATE OR REPLACE FUNCTION public.is_project_lead(p_project_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.user_id = auth.uid()
      AND e.tenant_id = public.current_tenant_id()
      AND (
        EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = p_project_id
            AND p.tenant_id = public.current_tenant_id()
            AND p.lead_emp_id = e.id
        )
        OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = p_project_id
            AND pm.tenant_id = public.current_tenant_id()
            AND pm.employee_id = e.id
            AND pm.role_in_project = 'lead'
        )
      )
  );
$$;

-- 呼叫者是否為某專案成員（掛在 project_members，任何 role）。
CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_members pm
    JOIN public.employees e ON e.id = pm.employee_id
    WHERE pm.project_id = p_project_id
      AND pm.tenant_id = public.current_tenant_id()
      AND e.user_id = auth.uid()
      AND e.tenant_id = public.current_tenant_id()
  );
$$;

-- 呼叫者是否為某專案所屬部門的主管（含子部門，遞迴 parent_id）。
-- 主管＝departments.manager_emp_id 指向呼叫者的 employee id。
CREATE OR REPLACE FUNCTION public.manages_project_dept(p_project_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  WITH RECURSIVE managed AS (
    SELECT d.id
    FROM public.departments d
    WHERE d.tenant_id = public.current_tenant_id()
      AND d.manager_emp_id IN (
        SELECT id FROM public.employees
        WHERE user_id = auth.uid() AND tenant_id = public.current_tenant_id()
      )
    UNION
    SELECT c.id
    FROM public.departments c
    JOIN managed m ON c.parent_id = m.id
    WHERE c.tenant_id = public.current_tenant_id()
  )
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id
      AND p.tenant_id = public.current_tenant_id()
      AND p.dept_id IS NOT NULL
      AND p.dept_id IN (SELECT id FROM managed)
  );
$$;

REVOKE ALL ON FUNCTION public.is_project_lead(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manages_project_dept(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_project_lead(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manages_project_dept(uuid) TO anon, authenticated, service_role;

-- ── projects：GROUP A（同租戶可讀；HR 或 lead 可寫） ─────────────────
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projects_tenant_read ON public.projects;
CREATE POLICY projects_tenant_read ON public.projects
  FOR SELECT USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS projects_hr_or_lead_write ON public.projects;
CREATE POLICY projects_hr_or_lead_write ON public.projects
  FOR ALL USING (
    tenant_id = public.current_tenant_id()
    AND (public.is_hr_admin() OR public.is_project_lead(id))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.is_hr_admin() OR public.is_project_lead(id))
  );

-- ── project_documents：GROUP A 讀；HR / 成員 / lead 可寫 ──────────────
ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_documents_tenant_read ON public.project_documents;
CREATE POLICY project_documents_tenant_read ON public.project_documents
  FOR SELECT USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS project_documents_write ON public.project_documents;
CREATE POLICY project_documents_write ON public.project_documents
  FOR ALL USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.is_hr_admin()
      OR public.is_project_lead(project_id)
      OR public.is_project_member(project_id)
    )
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (
      public.is_hr_admin()
      OR public.is_project_lead(project_id)
      OR public.is_project_member(project_id)
    )
  );

-- ── project_members：敏感（本人 / HR / lead / 部門主管 可讀；後三者可寫） ──
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_members_scoped_read ON public.project_members;
CREATE POLICY project_members_scoped_read ON public.project_members
  FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    AND (
      employee_id IN (
        SELECT id FROM public.employees
        WHERE user_id = auth.uid() AND tenant_id = public.current_tenant_id()
      )
      OR public.is_hr_admin()
      OR public.is_project_lead(project_id)
      OR public.manages_project_dept(project_id)
    )
  );
DROP POLICY IF EXISTS project_members_manage_write ON public.project_members;
CREATE POLICY project_members_manage_write ON public.project_members
  FOR ALL USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.is_hr_admin()
      OR public.is_project_lead(project_id)
      OR public.manages_project_dept(project_id)
    )
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (
      public.is_hr_admin()
      OR public.is_project_lead(project_id)
      OR public.manages_project_dept(project_id)
    )
  );

-- ── project_share_adjustments：同 project_members 可見規則 ─────────────
ALTER TABLE public.project_share_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_share_adj_scoped_read ON public.project_share_adjustments;
CREATE POLICY project_share_adj_scoped_read ON public.project_share_adjustments
  FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    AND (
      employee_id IN (
        SELECT id FROM public.employees
        WHERE user_id = auth.uid() AND tenant_id = public.current_tenant_id()
      )
      OR public.is_hr_admin()
      OR public.is_project_lead(project_id)
      OR public.manages_project_dept(project_id)
    )
  );
DROP POLICY IF EXISTS project_share_adj_manage_write ON public.project_share_adjustments;
CREATE POLICY project_share_adj_manage_write ON public.project_share_adjustments
  FOR ALL USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.is_hr_admin()
      OR public.is_project_lead(project_id)
      OR public.manages_project_dept(project_id)
    )
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (
      public.is_hr_admin()
      OR public.is_project_lead(project_id)
      OR public.manages_project_dept(project_id)
    )
  );
