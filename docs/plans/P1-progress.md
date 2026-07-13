# P1 差勤核心 — 功能規格與進度（Ralph 自主開發）

每個功能：TDD（對真實 Supabase ref xpbxfeslajiwkmfigjul）→ 測試綠 → commit → CI 自動部署。
完成標記 `[x]`。所有業務表帶 `tenant_id`，RLS 雙防線；API 經 `requireTenant` + 角色守衛。

## 功能清單

- [x] **F1 組織與員工管理 API**（HR admin）：departments CRUD；employees list/invite(建 Auth user+列)/update(dept/role/status)/deactivate。驗收：HR 可管理、租戶隔離、非 HR 不可寫、跨租戶讀不到、測試綠。
- [x] **F2 班別與排班**（schema 擴充 shifts/schedules + RLS）：shifts CRUD；schedules 指派/查詢（依員工/日期）。驗收：表建+RLS、CRUD 租戶隔離、測試綠。
- [x] **F3 打卡 API**（schema punch_records + RLS）：員工 punch in/out（GPS lat/lng/source）；查當日狀態；不可代打。驗收：打卡寫入正確、本人限定、租戶隔離、測試綠。
- [x] **F4 請假/加班/補卡 + 多關簽核**（schema leave_types/leave_requests/approval_flows/approval_steps + RLS）：送單、簽核流程、approve/reject 狀態機。驗收：狀態轉移正確、簽核者權限、測試綠。
- [x] **F5 公佈欄**（schema announcements + RLS）：HR 發佈、員工讀。驗收：租戶隔離、測試綠。
- [x] **F6 ESS 員工自助頁**（apps/web /ess）：登入、打卡、我的出勤、送申請。驗收：build 綠、可呼叫 API。
- [x] **F7 後台管理頁**（apps/web /admin）：departments/employees/shifts/schedules/簽核。驗收：build 綠。
- [ ] **F8 LINE 通知**：忘打卡/簽核通知（LINE Messaging API）。驗收：發送函式 + 測試。

## 進度日誌
（每完成一個功能在此追加一行：日期 / 功能 / commit / 測試結果）
- 2026-06-24 / F1 組織與員工管理 API / commit 6bb04f4 / org-management.test.ts 13 passed（API 全套 28 passed、typecheck 0 error）
- 2026-06-24 / F2 班別與排班 / scheduling.test.ts 15 passed（API 全套 43 passed、typecheck 0 error）；新增 shifts/schedules 表 + RLS（relrowsecurity=true、4 policies）、shifts/schedules CRUD/assign API
- 2026-06-24 / F3 打卡 API / punch.test.ts 12 passed（API 全套 55 passed、typecheck 0 error）；新增 punch_records 表（migration 0002 + index）+ RLS 0003（relrowsecurity=true、3 policies：self_or_hr_read / self_insert 防代打 / hr_write）、POST /punch（自動推斷 in/out、本人限定）/ GET /punch/today（含 working|off 狀態）/ GET /punch 查詢（HR 全租戶、非 HR 強制本人、日期窗）
- 2026-06-24 / F4 請假/加班/補卡 + 多關簽核 / requests.test.ts 21 passed（API 全套 76 passed、typecheck 0 error、build 綠）；新增 leave_types/approval_flows/leave_requests/approval_steps 4 表（migration 0003）+ RLS 0004（4 表 relrowsecurity=true、共 9 policies：leave_types/approval_flows 各 tenant_read+hr_write、lr_read/lr_self_insert/lr_hr_write、as_read/as_hr_write）；leave-types CRUD（HR）、approval-flows GET/PUT:kind upsert（HR）、requests 送單（依 kind 解析 approval_flow 建有序 approval_steps，無流程則退回任一 hr_admin 單關）/ GET 依角色（HR 全租戶、員工本人∪當前輪到自己簽的、?status 篩選）/ approve（推進 current_step 或最後一關→approved）/ reject（→rejected）/ cancel（送單本人限 pending）；狀態機守衛：非當前簽核人 403、非 pending 409、非送單者 cancel 403
- 2026-06-24 / F5 公佈欄 / announcements.test.ts 7 passed（API 全套 83 passed、typecheck 0 error）；新增 announcements 表（migration 0004_shiny_vance_astro + index(tenant_id,created_at)）+ RLS 0005（relrowsecurity=true、2 policies：ann_tenant_read 同租戶可讀 / ann_hr_write 僅 HR 全寫）；GET /announcements（全員工可讀、created_at desc）、POST（HR、反查 created_by employee id）/ PATCH（HR、更新 title/body/audience+updated_at）/ DELETE（HR）；皆強制 tenant_id 隔離，跨租戶 PATCH/DELETE→404
- 2026-06-24 / F6 ESS 員工自助頁 / `npm -w @hr/web run build` 綠（5 routes：/、/login、/ess、/ess/requests、/_not-found 全 static prerender）、typecheck 0 error；加 @supabase/supabase-js；新增 lib（supabase-browser singleton、api-client apiFetch 自動帶 supabase access_token、ess-api 型別化呼叫、use-session hook）+ AuthGate/EssHeader 元件；/login（signInWithPassword）、/ess（GET /punch/today + 大顆上下班打卡 POST /punch 帶 GPS fallback web、GET /announcements）、/ess/requests（GET /requests 狀態色標、POST /requests 表單 leave/ot/fix_punch、pending 可 POST /requests/:id/cancel）；/ 依 session redirect。注意：GET /leave-types 是 HR-only，員工取不到時假別選單優雅降級（不指定 leaveTypeId 仍可送單）
- 2026-06-24 / F7 後台管理頁 + GET /me / `npm -w @hr/web run build` 綠（14 routes：原 5 + /admin、/admin/{departments,employees,shifts,schedules,approvals,announcements,leave-types} 全 static prerender）、web tsc 0 error；API `npm -w @hr/api test` 87 passed（83→87，新增 me.test.ts 4 case：員工/HR 取自己 role+email、無 token 401、有租戶但無員工列 404，不回歸）、API typecheck 0 error。後端：新增 GET /me（requireAuth+requireTenant，由 userId+tenantId 反查 employees 回 {id,name,role,deptId,empNo,status,email}，查不到 404）掛進 app.ts。前端：admin-api.ts（型別化 me/departments/employees/shifts/schedules/requests(approve/reject)/announcements/leave-types/approval-flows，沿用 apiFetch 自動帶 Bearer）、AdminGate（取 /me 非 hr_admin/platform_admin 顯示無權限+回 /ess，含 403/404 降級）、admin/layout（側欄導航+branding appName/主色+登出，render-prop 傳 me）、各頁 CRUD（總覽待簽核數＝GET /requests?status=pending 長度+快捷連結；departments/employees(邀請+編輯+停用)/shifts/schedules(指派+查詢)/approvals(approve|reject)/announcements/leave-types(+approval-flows 勾選簽核者依序 PUT)）；ESS 端 EssHeader 依 GET /me role 顯示「後台」連結到 /admin（best-effort，不影響 ESS 核心）
