# P4 智能化與自動化 — 功能規格與進度

P4 把已落地的差勤/薪資/報表資料推進到「主動偵測 + 自動觸達 + AI 輔助」：先做
**規則型偵測引擎**（忘打卡偵測、遲到統計、異常出勤預警）與**通知佇列**（投遞接口，
實際 LINE/Email 之後接），再接 AI 報表/問答與排程。純後端、多租戶強制隔離 + HR 守衛。
每個功能 TDD：先寫測試 → 紅 → 實作 → 綠 → commit。

## 功能清單

- [x] **F1 規則型偵測引擎 + 通知佇列**（本次）：
  - 新表 `notifications`（`packages/db/src/schema/notifications.ts`，drizzle migration
    `0008_empty_marten_broadcloak.sql`）：id / tenant_id / employee_id(收件人 FK) /
    type(missing_punch|anomaly|approval|report|announcement) / title / body /
    channel(inapp|line|email，預設 inapp) / status(pending|sent|failed，預設 pending) /
    payload jsonb 預設 `{}` / created_at / sent_at；index(tenant_id, employee_id, status)。
  - RLS `packages/db/sql/0009_rls_notifications.sql`（GROUP B 本人或 HR 可讀、僅 HR 可寫）：
    `notif_self_or_hr_read`(SELECT)、`notif_hr_write`(ALL)；ENABLE RLS、DROP IF EXISTS 冪等。
  - 偵測服務 `apps/api/src/services/detection.ts`（純查詢 + supabaseAdmin，可被 API 與未來 worker cron 共用）：
    - `scanMissingPunches(tenantId, date)`：撈當日有排班(schedules)的員工，比對該 UTC 日窗的 punch_records →
      缺 in 標 `no_in`、有 in 無 out 標 `no_out`；對每筆 insert 一筆 `missing_punch` 通知（inapp/pending，
      payload 含 date/issue，title/body 中文）；以「該員工+該日已有 pending missing_punch」判重 → 重跑冪等。
      回 `{ missing:[{employeeId,issue}], queued:N }`。
    - `computeLateStats(tenantId, {from,to,deptId?,trendPeriods?})`：彙整 attendance_days（late_minutes>0）→
      依員工的遲到天數/分鐘；可選 deptId 篩選、可選回近 N 月遲到分鐘趨勢數列。回 `{ rows, trend }`。
    - `detectAnomalies(tenantId, {from,to,queue?})`：掃 attendance_days 標記
      `consecutive_late`（連續曆日遲到 ≥3）、`frequent_missing`（有排班但 worked_minutes=0 ≥2 天）、
      `excess_overtime`（單月加班合計 > 46×60=2760 分鐘，勞基法 §32 月上限）；可選 queue 對每筆入列 `anomaly` 通知。
      回 `{ anomalies:[{employeeId,type,detail}], queued }`。
  - 偵測 API `apps/api/src/routes/detection.ts`（皆 requireAuth+requireTenant+requireHrAdmin）：
    `POST /attendance/scan-missing-punch {date}`、`GET /attendance/anomalies?from=&to=`、
    `GET /attendance/late-stats?from=&to=&deptId=&trendPeriods=`。
  - 通知 API `apps/api/src/routes/notifications.ts`：
    `GET /notifications?status=`（requireAuth+requireTenant；員工只看自己、HR 看全租戶，newest first）、
    `POST /notifications/:id/read`（本人或 HR；設 payload.read=true；非本人非 HR / 跨租戶 → 404 不洩漏存在）。
  - `app.ts` 掛載 detectionRouter、notificationsRouter。
- [x] **F2 AI 自動報表**（需 Gemini）：
      `POST /ai/report-summary` 由 HR 觸發，以 Gemini 彙整同租戶出勤、請假/表單、薪資、人力、異常偵測與通知資料，
      產生繁中 Markdown 月報摘要；Admin `/admin/ai` 提供日期區間、薪資年月、單位篩選與月報產生入口。
- [x] **F3 AI 問答**（需 Gemini）：
      `POST /ai/ask` 支援 HR/員工自然語言問答。HR scope 讀同租戶彙總資料；員工 scope 只讀自己的差勤、表單、薪資與通知資料，
      prompt 明確禁止推論或揭露 scope 外資料。Admin `/admin/ai` 與 ESS `/ess/ai` 皆有問答入口。
- [x] **F4 LINE / Email 投遞**（需憑證）：
      `deliverPendingNotifications` 會把 `channel=email|line` 的 pending 通知實際送出並標
      sent/failed + sent_at；`channel=inapp` 可透過 `payload.channels` 或
      `NOTIFICATION_DEFAULT_CHANNELS=email,line` 額外外送且保留未讀狀態。Admin
      `/admin/notifications` 可手動投遞；worker 每 5 分鐘呼叫
      `/internal/notifications/deliver-pending`。Email 使用 Resend
      (`RESEND_API_KEY`, `NOTIFICATION_EMAIL_FROM`)，LINE 使用 Messaging API
      (`LINE_CHANNEL_ACCESS_TOKEN`，recipient 由通知 payload.lineUserId / line_user_id
      或員工 My Data 通訊資料 `line_user_id` 指定)。
- [x] **F5 worker cron 排程**：
      `@hr/worker` 每天 02:00（Asia/Taipei）呼叫
      `/internal/attendance/daily-settle` 結算昨日出勤、每天 03:00 呼叫
      `/internal/attendance/detect-and-notify` 對所有 active tenant 執行
      `scanMissingPunches`（昨日）與 `detectAnomalies`（預設近 7 日、queue=true），
      並每 5 分鐘呼叫 `/internal/notifications/deliver-pending` 投遞外部通知。內部端點以
      `INTERNAL_JOB_TOKEN` 保護；異常通知新增 pending 判重，避免排程重跑重複塞相同期間/類型提醒。
      目前線上排程預設停用：worker 需 `ENABLE_WORKER_SCHEDULERS=true` 才註冊 cron，API internal jobs 需
      `ENABLE_INTERNAL_JOBS=true` 才執行。

## 進度日誌
（每完成一個功能在此追加一行：日期 / 功能 / commit / 測試結果）
- 2026-06-24 / F1 規則型偵測引擎 + 通知佇列 / detection.test.ts 15 passed
  （@hr/api 全套 142 passed、無回歸先前 127；全 workspace typecheck 5/5 0 error）。
  改檔：新增 `packages/db/src/schema/notifications.ts`（更新 schema/index.ts）、drizzle migration
  `0008_empty_marten_broadcloak.sql`、`packages/db/sql/0009_rls_notifications.sql`、
  `apps/api/src/services/detection.ts`、`apps/api/src/routes/detection.ts`、
  `apps/api/src/routes/notifications.ts`、`apps/api/src/__tests__/detection.test.ts`，
  `apps/api/src/app.ts` 掛載 detection/notifications router。
  Supabase（ref xpbxfeslajiwkmfigjul，經 Management API）：套 notifications 表（11 欄、index 齊全）+ 套 0009 RLS；
  驗 pg_class.relrowsecurity=true、pg_policies 有 notif_hr_write(ALL) / notif_self_or_hr_read(SELECT)。
  實測（對手算 = 期望）:
  ① 忘打卡（SCAN_DATE 2026-03-10，emp1 有排班無打卡、emp2 有排班且完整 in/out、B 員工有排班無打卡）：
     missing 含 emp1 issue=no_in、不含 emp2、不含 B 員工；queued≥1；emp1 token GET /notifications 看到自己那筆
     missing_punch、emp2 看不到 emp1 的；員工跑 scan → 403；重跑 scan 通知數不變（冪等）。
  ② 異常（窗 2026-03-01..31，emp1 連 3 日 late>0 + 單月加班 3000m>2760m）：anomalies 含 emp1 的
     consecutive_late 與 excess_overtime、emp2（散落 2 短遲到 + 小加班）無；A 的 HR 不含 B；員工 → 403。
  ③ 遲到統計（同窗）：emp1 遲到 3 日 / 45 分（15+20+10，0 分日不計）、emp2 2 日 / 10 分；A 不含 B；員工 → 403。
  ④ 通知佇列：未登入 GET → 401；HR 看全租戶（含 emp1 那筆）且 tenant_id 全為 A、B 的佇列隔離；
     收件人可標自己已讀（200）、emp2 標 emp1 的 → 404。
- 2026-07-06 / F5 worker cron 排程 / 內部端點 `POST /internal/attendance/detect-and-notify`
  會遍歷 active tenants，對昨日執行忘打卡掃描、對預設近 7 日執行異常偵測並產生通知佇列；
  `@hr/worker` 新增每日 03:00 `detect-and-notify-attendance` scheduler，並保留每日 02:00 結算與每 5 分鐘投遞。
  `detectAnomalies(queue:true)` 加入 pending 通知判重，避免相同 employee/anomalyType/from/to 在 cron 重跑時重複建立。
- 2026-07-07 / 停止線上排程 / API internal jobs 加上 `ENABLE_INTERNAL_JOBS=true` 總開關，未開啟時回
  `internal_jobs_paused`；worker 加上 `ENABLE_WORKER_SCHEDULERS=true` 開關，未開啟時會移除既有 BullMQ
  job schedulers 並不再註冊新 cron。手動 HR 操作（例如後台通知中心手動投遞）不受影響。
- 2026-07-07 / F2-F3 AI 自動報表 + AI 問答 / 新增 `apps/api/src/services/ai-insights.ts` 與
  `apps/api/src/routes/ai.ts`。Gemini 憑證支援 `GEMINI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` / `GOOGLE_API_KEY`，
  model 預設 `gemini-2.0-flash`、可用 `GEMINI_MODEL` 覆蓋。所有 Supabase 查詢皆 `.eq("tenant_id", tenantId)`；
  員工問答以 caller employee_id 再限縮 attendance / leave / payslip / notification / anomaly context。
  Web 新增 Admin `/admin/ai`（月報摘要 + HR 問答）與 ESS `/ess/ai`（個人問答），並接入後台/ESS 導航。
  GitHub Actions `deploy-api.yml` 會在 `GEMINI_API_KEY` GitHub Secret 存在時，以 stdin 安全同步到 Railway API service。
