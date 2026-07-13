# P2 規則引擎與薪資 — 功能規格與進度

P2 把「差勤規則 → 工時結算 → 薪資單」這條最核心的 IP 變成純函式套件
（`packages/rules`，無 IO、可單元測試、可 white-label）。每個功能 TDD：
先寫測試 → 紅 → 實作 → 綠 → commit。閉集合宣告式 DSL，不做圖靈完備腳本。

## 功能清單

- [x] **F1 規則引擎 + 薪資引擎 + 宣告式規則 DSL**（`packages/rules`，純函式）：
  - DSL（`rules-schema.ts`，Zod 閉集合）：`attendance_bonus`（base + 遲到階梯 tiers）、
    `overtime`（when ∈ {weekday_ot|rest_day|fixed_holiday} × multiplier × compTime）、
    `night`（HH:MM window + multiplier）、`payroll`（method monthly|by_attendance_days、
    overtimeFlatHourly、dailyRegularHours）。匯出 `RuleConfigSchema` / `parseRuleConfig`。
  - 領域型別（`types.ts`）：PunchPair / ShiftDef / DayContext / AttendanceDay /
    SalaryStructure / PayslipBreakdown（含逐項 lines 可稽核）。
  - 工時引擎（`worktime-engine.ts`）：`computeAttendanceDay` — 配對上下班、扣除 break、
    依班表起始算遲到、超過 dailyRegularHours 算加班（例假/固定假則全時數為加班）、
    依 night.window 算夜間（正確處理跨午夜 00:00–08:30 及 22:00→02:00 跨日班）。
  - 薪資引擎（`payroll-engine.ts`）：`computePayslip` — 本俸（月薪/出勤天數×日薪）、
    加班費（依 dayType 套倍率；overtimeFlatHourly 覆蓋為固定時薪；compTime 轉補休不發現金）、
    夜間加給、全勤獎金（全月累計遲到套階梯從 base 扣）、逐項 lines 加總 = gross。
  - **三大特殊制度黃金測試**（`__tests__/golden.test.ts`）全綠。
  - 驗收：`npm -w @hr/rules test` 全綠、`npm -w @hr/rules run typecheck` 0 error、
    全 workspace `npm run typecheck` 0 error、不碰 DB/api。
- [x] **F2 租戶規則設定 + 員工薪資結構 + 工時結算批次**：把 `packages/rules` 的工時引擎接到真實資料。
  - **@hr/rules 變成可部署 workspace 套件**：`packages/rules/package.json` 加 `main`/`types`/`exports`
    （→ `dist/index.js`+`dist/index.d.ts`）+ `build`（`tsc -p tsconfig.build.json`，新增該 build config，
    rootDir src / outDir dist / declaration / 排除 __tests__）;`index.ts` re-export 補 `.js` 副檔名（ESM
    runtime 解析必要）。`apps/api` 加相依 `@hr/rules:*`、root install 連 symlink、`apps/api/tsconfig.json`
    清掉 `@hr/rules` path mapping 改走 node_modules dist（避免把套件 src 拉進 api rootDir）。
    `railway.json` buildCommand 改 `build -w @hr/rules && build -w @hr/api`。
  - **DB**：`rule_configs`/`salary_structures`/`attendance_days` 三表（皆 tenant_id NOT NULL、
    salary 與 attendance 帶 unique(tenant,employee[,work_date])）+ migration 0005 + RLS 0006
    （rule_configs 同租戶可讀/HR 寫；salary、attendance 本人或 HR 讀/HR 寫）。
  - **API**：`/rule-config`（GET 預設範本 fallback、PUT 以 `parseRuleConfig` 驗證 DSL→版本化 active upsert）、
    `/salary/:employeeId`（HR GET/PUT upsert）、`/attendance/settle`（HR 批次:配對 punch + schedule→shift +
    租戶 rule_config → `computeAttendanceDay` → upsert attendance_days，冪等）、`/attendance-days`（HR 全租戶/員工本人）。
    結算把 UTC 打卡瞬間轉「商業本地牆鐘」餵引擎（與班表 HH:MM 對齊、跨時區決定性一致）。
- [x] **F3 薪資單產生 + API**：以 `computePayslip` 為核心，HR 觸發月結，產 payslip（含 lines）
  落地 + GET API（HR 全租戶、員工本人）；租戶隔離 + RLS。
- [x] **F4 補休 / 特休 ledger**：compTime 加班轉補休時數入帳、特休給假/動用，餘額查詢；
  與 F1 的 `compTimeMinutes` 串接。

## 進度日誌
（每完成一個功能在此追加一行：日期 / 功能 / commit / 測試結果）
- 2026-06-24 / F4 補休 / 特休 ledger（接入 F4 簽核「最終核准」）/ ledger.test.ts 10 passed
  （@hr/api 全套 118 passed、無回歸先前 108；全 workspace typecheck 5/5 0 error）。
  DB：comp_time_ledger（tenant_id NOT NULL、employee_id、source_request_id→leave_requests、
  hours_earned/hours_used numeric、note、expires_at、index(tenant,employee)）+ leave_balances
  （unique(tenant,employee,leave_type,year)、entitled/used/deferred numeric）+ migration 0007_abandoned_wildside
  + RLS 0008_rls_ledger（經 Management API 套用：兩表 relrowsecurity=true、各 *_self_or_hr_read SELECT +
  *_hr_write ALL 共 4 條 policy 就緒）。Service：`services/ledger.ts` `applyApprovalEffects`，在
  `requests.ts` decide() 最終核准（status→approved）點呼叫，try/catch 兜底（ledger 失敗不讓 approve 失敗）：
  kind=leave+leaveTypeId→leave_balances.used += hours（無該年列則建 used=hours/entitled=0）；
  kind=ot 且租戶 rule overtime weekday_ot.compTime=true（缺則任一 rule compTime）→ comp_time_ledger
  記 hours_earned=hours；reject/cancel 不入帳。API：`GET /leave-balances?employeeId=&year=`（HR 全租戶／員工本人）、
  `PUT /leave-balances`（HR；upsert 保留既有 used）、`GET /comp-time?employeeId=`（回 entries+結餘 Σearned−Σused）、
  `POST /comp-time/adjust`（HR；手動加一筆 earned/used）。實測：特休 entitled 80→請 8h 核准→used 8 結餘 72；
  OT 2h（compTime）核准→補休結餘 2；HR 手動 used 1→結餘 1；員工 PUT/adjust 皆 403、員工 GET 只看自己、
  A 的 HR 看不到 B 的餘額/ledger。Supabase 測試資料 afterAll 清乾淨（0 殘留 ledger/balance/tenant/auth user）。
- 2026-06-24 / F1 規則引擎 + 薪資引擎 + DSL / commit bb2fad1 / golden.test.ts 19 passed +
  rules-schema.test.ts 4 passed（@hr/rules 全套 23 passed、@hr/rules typecheck 0 error、
  全 workspace typecheck 5/5 successful）。三大黃金測試實算 = 期望：
  ① 全勤階梯 遲到 5→扣0/實發2000、6→600/1400、19→600/1400、20→2000/0；
  ② 例假日 8h×1.67 = 2672（不補休 compTime=0）、夜間 00:00–08:30 8h×2.0 = 3200；
  ③ 按出勤天數 22×1600 = 35200、某日 10h 超 8h 兩小時 → flat 2×200 = 400（覆蓋倍率）。
- 2026-06-24 / F3 薪資單產生 + API（接入 payroll-engine `computePayslip`）/ payroll-run.test.ts 7 passed
  （@hr/api 全套 108 passed、無回歸先前 101；全 workspace typecheck 5/5 0 error）。
  DB：payslips 表（tenant_id NOT NULL、unique(tenant,employee,period)、breakdown jsonb 存引擎 lines、
  status draft|finalized、version）+ migration 0006_lumpy_union_jack + RLS 0007_rls_payslips（經 Management API
  套用：relrowsecurity=true、ps_self_or_hr_read SELECT + ps_hr_write ALL 兩條 policy、unique index 就緒）。
  API：`POST /payroll/run`（HR；單一/全租戶有 salary 員工，蒐集該月 attendance_days+salary+rule_config→
  computePayslip→upsert draft；已 finalized 跳過並列 skipped；回 {generated,skipped}）、
  `GET /payslips`（HR 全租戶／員工本人）、`GET /payslips/:id`（本人或 HR，別人/跨租戶 404）、
  `POST /payslips/:id/finalize`（HR；draft→finalized，已 finalized 409，finalize 後 run 不覆蓋）。
  薪資單實算對引擎 = 期望：monthly base 36000、加班 2h×200×1.34=536、夜間 1h×200×1.34=268、
  全勤 2000−600（遲到10>5階）=1400、gross 38204。Supabase 測試資料 afterAll 清乾淨（0 殘留 tenant/payslip/auth user）。
- 2026-06-24 / F2 規則設定+薪資結構+工時結算（接入 @hr/rules 引擎）/ payroll-settle.test.ts 14 passed
  （@hr/api 全套 101 passed、無回歸先前 87；全 workspace typecheck 5/5 0 error；@hr/rules 23、@hr/db 5 仍綠）。
  **node dist smoke test（部署關鍵）**：`build -w @hr/rules && build -w @hr/api`（乾淨重建 exit 0）後
  `PORT=4099 node apps/api/dist/index.js` → `curl /health` 回 `{"status":"ok"}`、process 存活、
  **無 ERR_MODULE_NOT_FOUND**（@hr/rules 經 node_modules symlink→exports→dist/index.js 正確解析）。
  migration 0005 + RLS 0006 經 Management API 套用:三表 relrowsecurity=true、6 條 policy（讀+寫）皆建立、
  unique index 就緒。結算實算對引擎 = 期望:打卡 09:10→19:00／班表 09:00 start／break 60 →
  worked 530、late 10、overtime 50、night 0。
