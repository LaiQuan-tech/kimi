# HR 差勤 SaaS — 系統設計文件

> 狀態：已核准（2026-06-23）。本文件為高階設計；逐步實作見同目錄的 `*-p0-foundation.md` 等 Phase 計畫。

## 背景與戰略

把客戶提供的「人資雲端管理系統」架構圖，落地成**多租戶白標 SaaS（一次開發、多家賣）**，用 SaaS 商業模式打贏 Apollo、打卡之星等月租競品。競爭點不在「打卡」這個 commodity，而在 **可設定規則引擎 + AI 自動化 + 資料自主**。

## 四個已拍板決策

1. **多租戶白標 SaaS**：每家公司資料隔離；特殊制度用「設定檔 + feature toggle」客製，不改程式碼。
2. **全功能範圍**：差勤 + 排班 + 請假/加班/補卡簽核 + 工時 + 薪資 + 考核 KPI + 報表 + AI（分階段交付，架構一開始即支援）。
3. **平台**：響應式 Web（後台 + 員工自助）為主；員工端先 **PWA + LINE**，原生 App 延後（將用 Expo/RN）。
4. **技術棧**：沿用既有 house stack。

## 技術棧

Monorepo（npm workspace + Turbo）｜`apps/web` Next.js 16 App Router + shadcn/ui + Tailwind 4（Vercel）｜`apps/api` Express 5 + Supabase SDK（Railway）｜`apps/worker` BullMQ + Redis + Cron（Railway）｜`packages/db` Supabase Postgres + Drizzle + RLS｜`packages/rules` 純 TS 規則/薪資引擎｜Auth: Supabase Auth + JWT｜Email: Resend｜AI: Gemini + 多供應商容錯｜員工端: PWA + LINE Messaging API。

## 重用既有資產（取自 Realreal / ifoodmap / CoVyzer / PikTag）

- `Realreal/apps/api/src/worker.ts` — BullMQ cron 骨架。
- `Realreal/packages/db/migrations/0036_CRITICAL_enable_rls.sql` — RLS 模板（`is_admin()` SECURITY DEFINER + GROUP A/B/E）。
- `Realreal/apps/api/src/middleware/{auth,admin}.ts` — `requireAuth`/`requireAdmin`。
- `Realreal/apps/api/src/lib/settings.ts` — AES-256-GCM 加密設定。
- `Realreal/apps/api/src/lib/email.ts` + `migrations/0012` — Resend + DB 範本。
- `Realreal/apps/web/src/app/admin/*` + `components/ui/*` — 後台 CRUD 範式 + shadcn。
- `ifoodmap/api/src/lib/gemini.ts` — Gemini 結構化 JSON。
- `CoVyzer/.../provider-config.ts` — AI 多供應商容錯。
- `PikTag-mobile/mobile/*` — （延後）expo-location/notifications/離線佇列/EAS。

## 必須新建

`packages/rules`（規則/工時/薪資引擎，最重）｜全表 `tenant_id` + RLS by tenant｜LINE Messaging API（LINE Notify 已停服）｜差勤/薪資/考核 schema 與路由。

## 架構與租戶隔離

單一 DB + 行級 RLS by tenant。每張業務表帶 `tenant_id`；JWT 內嵌 `app_metadata.tenant_id`；`requireTenant` 中介層強制注入 + RLS `current_tenant_id()` 兜底（雙防線）；薪資/考核再加 `requireRole(['hr_admin'])`。白標放 `tenants.branding`/`tenants.features`；密鑰走 `tenant_secrets` 加密。

## 規則引擎（核心）

特殊制度做成 `rule_configs.config` 的宣告式 JSON DSL，純函式引擎解釋，`version`+`effective_from` 版本化。涵蓋：①全勤階梯 ②加班倍率（例假/固定假 ×1.67、夜間 00:00–08:30 ×2）③計薪方式（by_attendance_days、當日超 8h 固定 200/時）。

## 分期

P0 基礎/多租戶 → P1 差勤核心 → P2 工時+規則+薪資 → P3 考核+報表 → P4 AI → P5（延後）原生 App。約 22–28 人週（不含 P5）。P2 後可賣差勤核心，P4 後主打 AI。

## 主要風險

薪資正確性（黃金測試）｜多租戶外洩（雙防線 + 隔離測試）｜規則引擎過度設計（閉集合 DSL）｜打卡防作弊（地理圍籬+人臉+device+伺服器時戳）｜法規變動（規則進 jsonb）。
