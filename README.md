# HR 差勤 SaaS（白標多租戶）

多租戶白標人資差勤管理系統。差勤打卡 + 排班 + 簽核 + 工時 + 薪資 + 考核 KPI + 報表 + AI 自動化。

- 設計文件：[`docs/plans/2026-06-23-hr-saas-design.md`](docs/plans/2026-06-23-hr-saas-design.md)
- P0 實作計畫：[`docs/plans/2026-06-23-p0-foundation.md`](docs/plans/2026-06-23-p0-foundation.md)

## 技術棧

Monorepo（npm workspace + Turbo）｜`apps/web` Next.js 16｜`apps/api` Express 5｜`apps/worker` BullMQ｜`packages/db` Drizzle + Supabase + RLS｜`packages/rules` 規則/薪資引擎。

> 狀態：核心模組已實作（差勤、人事主檔、招募 ATS、台灣薪資法規等）。
> 對標 Apollo/MayoHR 的補齊計畫見 [`docs/plans/2026-07-01-apollo-parity.md`](docs/plans/2026-07-01-apollo-parity.md)。

## 線上環境
- Web（Vercel）: https://hr-theta-peach.vercel.app
- API（Railway）: https://hr-production-994f.up.railway.app/health
