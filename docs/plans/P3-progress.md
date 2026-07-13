# P3 報表與考核 — 功能規格與進度

P3 把已落地的差勤/薪資/請假/組織資料變成「可決策的彙整視圖」：先做後端報表 API
（純查詢 + Node 端 group/sum，不寫新表）並支援 CSV 匯出，再接考核 KPI 與前端頁。
每個功能 TDD：先寫測試 → 紅 → 實作 → 綠 → commit；報表全程強制租戶隔離 + HR 守衛。

## 功能清單

- [x] **F1 報表 API（出勤/薪資/請假/人力彙整）+ CSV 匯出**（本次）：
  - 新 `apps/api/src/routes/reports.ts`（掛 `app.ts`），全部 `requireAuth + requireTenant + requireHrAdmin`，
    每條查詢都 `.eq("tenant_id", res.locals.tenantId)`（supabaseAdmin 繞過 RLS，故此 filter 為承重防線）。
    全部支援 `?format=csv`（回 `text/csv; charset=utf-8` + `Content-Disposition` 檔名；預設 JSON）。
  - `GET /reports/attendance?from=&to=&deptId=`：依員工彙整 `attendance_days`（work_date 落 from..to）：
    工作分鐘合計、遲到次數（late_minutes>0 的天數）、遲到分鐘合計、加班分鐘合計、夜間分鐘合計、出勤天數；
    可選 deptId 篩選（先撈該部門員工再以 `.in(employee_id)` 限縮）。
  - `GET /reports/payroll?period=`：依員工列出該 period `payslips`（base/overtime_pay/night_pay/
    attendance_bonus/gross，PostgREST 數值字串 → Number）+ `total.gross` 合計（CSV 末附「合計」列）。
  - `GET /reports/leave?from=&to=`：彙整 `leave_requests`（建立於區間 OR 起訖與區間重疊）：
    依 kind × status 計數 + 總時數；另附 `details` 依員工明細。
  - `GET /reports/headcount`：員工總數 + 依 status / dept(dept_id，null bucket) / role 計數。
  - `apps/api/src/lib/csv.ts`：`toCsv(rows, columns:{key,label}[])` — 逗號/引號/換行跳脫（`"`→`""`、
    含特殊字元才加引號）、CRLF 換行、前綴 UTF-8 BOM（Excel 正確顯示中文）。
- [x] **F2 考核 KPI**（本次）：考核表（kpi_templates，加權題項）+ 指派/評分/提交/定版（kpi_reviews 狀態機 draft→submitted→finalized）：
  - 新 schema `packages/db/src/schema/kpi-templates.ts`、`kpi-reviews.ts`（皆帶 `tenant_id NOT NULL`；
    kpi_reviews `unique(tenant_id, employee_id, template_id, period)`）→ migration `0009_empty_iron_monger.sql`、
    RLS `0010_rls_kpi.sql`（templates=GROUP A 同租戶讀/HR 寫；reviews=HR 全租戶／受評者看自己／評核者看被指派的，HR 可寫）。
  - 新 `apps/api/src/routes/kpi-templates.ts`（讀 `requireTenant`、寫 `requireHrAdmin`）GET/POST/PATCH/DELETE。
  - 新 `apps/api/src/routes/kpi-reviews.ts`：POST 指派（HR，建 draft）；GET 角色可見性（HR 全租戶／評核者看指派／受評者僅 finalized）；
    PATCH 評分（評核者或 HR；用 template.items 的 weight 算 `total_score = Σ(score/maxScore × weight)`，四捨五入 2 位；finalized→409）；
    submit（評核者 draft→submitted）；finalize（HR submitted→finalized 終態）。皆 `.eq("tenant_id", …)` 為承重防線。
  - `apps/api/src/app.ts` 掛載 kpiTemplatesRouter、kpiReviewsRouter。
- [x] **F3 報表前端頁**：將 F1 各報表接成 HR 後台頁面（篩選 + 表格 + 下載 CSV）。

## 進度日誌
（每完成一個功能在此追加一行：日期 / 功能 / commit / 測試結果）
- 2026-06-24 / F1 報表 API（出勤/薪資/請假/人力彙整）+ CSV 匯出 / reports.test.ts 9 passed
  （@hr/api 全套 127 passed、無回歸先前 118；全 workspace typecheck 5/5 0 error）。
  改檔：新增 `apps/api/src/lib/csv.ts`、`apps/api/src/routes/reports.ts`、`apps/api/src/__tests__/reports.test.ts`，
  `apps/api/src/app.ts` 掛載 reportsRouter。彙整全在 Node 端對 supabaseAdmin 查回列做 group/sum（資料量小、無 SQL aggregate）。
  實測對手算 = 期望：
  ① 出勤（窗 2026-05-01..31，emp1 兩日 + 一筆窗外 2026-04-30 須忽略）：
     emp1 工作 480+600=1080、遲到次數 1（僅 05-05 late>0）、遲到分鐘 10、加班 60+120=180、夜間 30、出勤 2 日；
     emp2 工作 450、遲到次數 1、遲到分鐘 5、加班 0、夜間 60、出勤 1 日；deptId=Eng 只回 emp1。
  ② 薪資（period 2026-05）：emp1 gross 32600、emp2 gross 30300、total.gross 62900。
  ③ 請假（kind×status）：leave/approved 1 件 8h、leave/pending 1 件 4h、ot/approved 1 件 2h、fix_punch/rejected 1 件 0h。
  ④ 人力：總數 3（hr_admin 1 + employee 2）、active 3 / inactive 0、role hr_admin 1 / employee 2、dept Eng 1 / Sales 1。
  權限/隔離：員工 GET 四條報表皆 403；A 的 HR 報表完全不含 B（B 另 seed 出勤/薪資/請假各一筆驗證，皆未混入）。
  CSV：回含 BOM（首字 U+FEFF）+ 表頭 + 資料列；含逗號的中文姓名（如「李, 大華」）正確以雙引號包裹。
  Supabase 測試資料 afterAll 依 FK 安全序清乾淨（payslips→attendance_days→leave_requests→employees→
  departments→tenants→auth users，0 殘留）。
- 2026-06-24 / F2 考核 KPI（templates + 指派/評分/提交/定版，加權總分）/ kpi.test.ts 15 passed
  （@hr/api 全套無回歸；全 workspace typecheck 5/5 0 error）。
  改檔：新增 `packages/db/src/schema/kpi-templates.ts`、`kpi-reviews.ts`（更新 schema/index.ts barrel）、
  drizzle migration `packages/db/migrations/0009_empty_iron_monger.sql`、RLS `packages/db/sql/0010_rls_kpi.sql`、
  `apps/api/src/routes/kpi-templates.ts`、`apps/api/src/routes/kpi-reviews.ts`、`apps/api/src/__tests__/kpi.test.ts`，
  `apps/api/src/app.ts` 掛載兩個 router。
  migration + RLS 經 Supabase Management API 套用（ref xpbxfeslajiwkmfigjul）；事後查 pg_class.relrowsecurity 兩表皆 true、
  pg_policies 四條到位（kpi_templates_tenant_read/kpi_templates_hr_write、kpi_read/kpi_hr_write）。
  加權法：`total_score = Σ(score/maxScore × weight)`（四捨五入 2 位）；
  實測 quality 8/10×60 + attitude 9/10×40 = 48+36 = 84（期望 84 = 實算 84，斷言通過）。
  權限/狀態：員工建範本→403、員工指派→403、非評核者非 HR 評分→403、finalized 後 PATCH→409；
  draft→submitted（評核者）→finalized（HR）。
  可見性：評核者看得到被指派的；受評者 finalize 前看不到、finalize 後看得到自己；無關第三人（emp2）看不到；A 的 HR 看不到 B。
  Supabase 測試資料 afterAll 依 FK 安全序清乾淨（kpi_reviews→kpi_templates→employees→tenants→auth users，0 殘留）。
- 2026-07-06 / F3 報表前端頁 / `apps/web/src/app/admin/reports/page.tsx` 接上
  `GET /reports/attendance`、`/reports/leave`、`/reports/payroll`、`/reports/headcount` JSON 預覽：
  查詢條件（日期區間、薪資年月、出勤單位）、摘要卡、出勤/表單/薪資/人力表格、表單明細預覽，以及單項/批次 CSV 下載。
  `apps/web/src/lib/admin-api.ts` 新增 typed report client，讓前端不只下載 CSV，也能呈現 Apollo 報表中心所需欄位。
