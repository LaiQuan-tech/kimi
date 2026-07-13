# Apollo 欄位對齊 v2 — Ralph loop 進度追蹤

> 目標：欄位/篩選/流程與 Apollo 一致（版面自家風格）。規格：`2026-07-01-apollo-field-spec.md`。
> 每模組：schema(+migration+RLS 套 HR-Ai) → API → web → 測試綠 → push main（自動部署 Web+API）。
> 環境重建：clone → 寫 .env（Management API 取 keys）→ `npm i` → `npm -w @hr/rules run build`。

| 模組 | Recon | 開發 | 測試 | 部署 | 備註 |
|---|---|---|---|---|---|
| ① Foundation | ✅ | ✅ | ✅ 205綠 | 🔄 push即部署 | migration 0015 已套 HR-Ai；MyData 6分頁；Hire 篩選+範本+匯入；job_history+年資 |
| ② Attendance | ✅ | ✅ | ✅ 210綠 | 🔄 push即部署 | migration 0016(payout/trip/agent/location/remark)；ESS 打卡紀錄/剩餘假別/個人班表+班表審核 3新頁；申請表單條件欄位；HR 打卡紀錄維護+補登 |
| ③ Payroll | ✅(重點頁) | ✅ | ✅ 210綠 | 🔄 push即部署 | Admin /admin/payroll(薪資保險資料+眷屬/扶養+執行薪資+查詢定案)；ESS 我的薪資單。後端沿用既有 API 無 schema 變更 |
| ④ Recruitment | ✅(入口清單) | ✅ | ✅ UI(API既有測試) | 🔄 push即部署 | Admin 招募頁擴充：面試行事曆/紀錄(安排+通過/未通過)、錄用申請/通知單(建立+狀態)；ESS /ess/jobs 內部職缺 |
| ⑤ Dashboard | ✅ | ✅ | ✅ 212綠 | 🔄 push即部署 | employees.terminated_at(0017)+deactivate 蓋離職日；GET /dashboard/headcount(期初/新進/離職/期末, 單位/身分篩選)；/admin/dashboard 圖表頁 |

## 完成定義（全部打勾才算完成）
- [x] Foundation 欄位對齊 + 測試綠 + 已部署
- [x] Attendance recon + 欄位對齊 + 測試綠 + 已部署
- [x] Payroll recon + 欄位對齊 + 測試綠 + 已部署
- [x] Recruitment recon + 欄位對齊 + 測試綠 + 已部署
- [x] Dashboard recon + 開發 + 測試綠 + 已部署
- [ ] 全套件跑綠 + 線上驗證 + 通知使用者
