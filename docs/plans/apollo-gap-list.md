# Apollo 差距補完清單（v3 — ✅ 全部完成 2026-07-03）

> 前置：v2 已完成五模組欄位對齊（apollo-v2-progress.md）。本輪補完剩餘互動差距。
> 每項：實作 → 測試綠 → push main（自動部署）→ 打勾。全部完成後一次通知使用者。
> 環境重建：clone → 寫 .env（Management API 取 keys）→ `npm i` → `npm -w @hr/rules run build`。

- [x] A 代申請 — HR 可替員工送出申請（表單 本人/代申請 切換，HR 才可見）
- [x] B 表單內即時餘額驗證 — 請假選假別即顯示「剩餘 X 時 X 分」＋超額警示
- [x] C 多段日期請假 — 一張申請單多個日期段（segments jsonb），總時數加總
- [x] D 附件上傳 — 請假/公出 ×3 檔案 ≤3MB（Supabase Storage + request_attachments 表）
- [x] E 個人班表月曆化 — 月曆格狀檢視
- [x] F 打卡紀錄 休息/外出/異常 — punch type 擴充 break/outing ＋ 異常(缺卡)頁籤
- [x] G 薪資投保級距 — salary_structures 加 勞保/健保投保級距欄位＋UI
- [x] H 薪資單列印 — 列印友善薪資單明細（含 breakdown）
- [x] I 申報作業產出 — 扣繳/補充保費 CSV 匯出
- [x] J 招募簽核流 — 職缺需求單/錄用單 待審核→核准 佇列
- [x] K 公司面試行事曆 — 全公司面試按日分組檢視
- [x] L LinkUp 入口 — ESS 首頁升級：我的快捷/待辦事項/便利貼/最新公告
