# Apollo/MayoHR Feature-Parity Plan

> 目標：以 **Apollo HR Express Edition**（apolloxe.mayohr.com）為對標，將其功能逐步補進本系統。
> 對標盤點日期：2026-07-01。四階段，順序：①差勤補齊 → ②人事主檔強化 → ③招募 ATS → ④台灣薪資法規。
>
> 開發慣例（沿用現有）：每個功能 = `packages/db` schema (Drizzle) + `packages/db/sql` RLS + `apps/api` route (zod 驗證、supabaseAdmin、tenant-scoped、role guard) + `apps/api/src/__tests__` 對真實 Supabase 的 vitest + `apps/web` 前端頁面。測試需 root `.env`（SUPABASE_URL / ANON / SERVICE_ROLE）。

## Apollo 六大模組盤點（對標基準）

- **LinkUp**：可自訂個人入口 Portal（常用流程、流程引導精靈、自定義報表、快捷 widgets：請假/加班/打卡/忘打卡/個人班表/公司規章/部門公告/最新消息/個人資訊/待辦事項/便利貼/我的薪資單/內部連結/內部職缺）。
- **Attendance**：個人（個人班表、我要打卡、忘打卡、打卡紀錄、特殊假別、請假、加班、公出/出差、表單申請紀錄、剩餘假別、待審核表單、班表審核）；管理者（打卡紀錄維護、表單紀錄管理、假別時數管理、結算作業、模組設定、人員基本資料、報表中心、班表匯入）。
- **Foundation**：Hire 報到管理；Org 組織管理（單位 + 公司組織圖）；People 人員管理；My Data（基本/通訊/學歷證照/工作經歷/年資/職務經歷）；報表中心；設定。
- **Payroll**：薪資/保險資料（員工薪資保險、健保眷屬、所得稅扶養親屬、批次調薪）；薪資/獎金作業（執行、查詢/列印）；所得稅/補充保費（非員工資料、其他所得申報、所得稅作業、二代健保補充保費）；報表中心。
- **Recruitment（ATS）**：職缺需求單（+審核）、錄用申請單（+審核）、面試紀錄表、公告管理、人才庫、面試行事曆、公司面試行事曆、錄用/通知單查詢、內部職缺、報表中心。
- **Dashboard**：全公司在職人數分析（期初/新進/離職/期末，可依單位/身分/職務群組篩選）、可自訂儀表板。

---

## 階段 ① 差勤補齊（最接近現有 code，風險低）

| 功能 | 作法 | 需改 schema | 狀態 |
|---|---|---|---|
| 公出/出差 business_trip | `requests.ts` KINDS 加 `business_trip`；approval-flows 同步；ledger 無副作用（no-op）；前端 ESS/Admin 下拉 + 標籤 | 否 | ✅ 完成、測試綠 |
| 班表審核 | `schedules.ts` 新增 `POST /schedules/:id/acknowledge`（→confirmed）、`/dispute`（→disputed）；本人或 HR 可審；複用既有 `status` 欄位 | 否 | ✅ 完成、測試綠 |
| 班表匯入 | `schedules.ts` 新增 `POST /schedules/import`（HR-only，CSV 解析，逐列驗證，複用 upsert） | 否 | ✅ 完成、測試綠 |
| 特殊假別 | `leave_types` 加 `special boolean default false`（migration 0010，已套用 HR-Ai）；`GET /leave-types?special=` 篩選；Admin 假別頁 特殊假別 開關+標籤 | 是（新增欄位，additive，已套用） | ✅ 完成、測試綠 |

## 階段 ② 人事主檔強化

- **Hire 報到管理**：✅ 完成、測試綠。`onboardings` 表（migration 0011）+ RLS(HR-only)；`GET/POST/PATCH/DELETE /onboardings` + `POST /onboardings/:id/complete`（建 employee 並連結，pending→completed）；Admin `/admin/onboarding` 頁。
- **公司組織圖**：✅ 完成、測試綠。`departments.parent_id` 本已存在（免 migration）；`GET /org-chart` 回巢狀樹（全員工可讀）；Admin `/admin/org-chart` 樹狀圖頁 + 首頁入口。
- **豐富員工履歷**：✅ 完成、測試綠。`employee_profiles`(1:1 通訊)/`employee_educations`/`employee_certifications`/`employee_work_history`/`employee_job_history` + self-or-HR RLS；`GET/PUT /employees/:id/profile` 聚合(含年資 seniorityDays) + educations/certifications/work-history/job-history 子資源 CRUD；ESS `/ess/mydata` 與 Admin `/admin/employees` 皆可維護。

## 階段 ③ 招募 ATS — ✅ 完成、測試綠

- `job_requisitions`（職缺需求單，draft/open/closed + is_internal）、`candidates`（人才庫，pipeline status）、`interviews`（面試紀錄+行事曆 scheduled_at/result）、`offers`（錄用 draft/approved/sent/accepted/declined）。migration 0013 + RLS(0013：HR-only；job_requisitions 另加內部 open 全員可讀)。
- 路由：HR-CRUD factory 統一 `/job-requisitions`、`/candidates`、`/interviews`、`/offers`（GET 支援 filter/PATCH/DELETE）；`GET /internal-jobs`（全員可讀內部職缺）。
- Web：Admin `/admin/recruitment`（職缺需求單、待審核職缺、人才庫 pipeline、面試紀錄/個人與公司行事曆、錄用申請/通知狀態、招募統計）+ ESS `/ess/jobs` 內部職缺。
- 招募簽核：✅ 職缺需求單與錄用單支援待審核/核准/駁回狀態，管理者可在招募頁處理。

## 階段 ④ 台灣薪資法規 — ✅ 完成、測試綠

- **計算核心** `packages/rules/tw-tax.ts`（純函式 + 7 golden tests）：`bonusSupplementaryPremium`（高額獎金逾投保 4 倍 → 補充保費）、`otherIncomeSupplementaryPremium`（其他類所得單筆 ≥20,000 計費）、`salaryWithholdingFixedRate`（薪資定率扣繳）、`nonResidentWithholding`、`nhiEmployeePremium`（本人+眷屬，眷口 3 封頂）。**費率/門檻皆參數化**（不寫死會逐年變動的法定值）。
- **資料表**（migration 0014 + RLS 0014）：`nhi_dependents`(健保眷屬)、`income_tax_dependents`(扶養親屬)（本人或 HR）、`salary_adjustments`(批次調薪)、`non_employee_income`(非員工所得)（HR-only）。
- **路由** `payroll-tax.ts`：四表 HR-CRUD；`POST /salary-adjustments/import`（批次調薪 CSV）；`POST /non-employee-income` 建立時自動算扣繳+補充保費；`POST /payroll/tax/compute`（bonus_premium/nhi_premium/withholding 薄包裝 rules）。
- **Web**：Admin `/admin/payroll-tax`（批次調薪匯入、非員工所得、所得稅/補充保費試算、CSV 匯出）+ 首頁入口。
- **法規報表**：✅ 所得稅作業/補充保費作業支援試算與匯出；扣繳規則採參數化引擎，避免寫死年度法規值。

---

## 驗證與交付

- 每個功能：`npm -w @hr/api run typecheck` + 對應 vitest 綠燈；schema 變更先 `npm run db:generate` 產 migration，經 Supabase 套用後再測。
- 需改 prod schema 的功能，套用前先確認（線上 API 與測試共用同一 Supabase 專案 `HR-Ai`）。
