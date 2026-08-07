"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, PageHeader, Empty } from "@/components/admin-ui";
import { getBranding, getRequests, seedDemoData } from "@/lib/admin-api";

// module 名稱與側邊選單的分組一致(見 admin/layout.tsx 的 NAV_GROUPS),
// 兩處都對齊合約賣給客戶的模組,客戶才找得到自己買的東西。
const LINKS: { href: string; label: string; desc: string; module: string }[] = [
  { href: "/admin/dashboard", label: "人力分析", desc: "在職人數分析", module: "總覽" },
  { href: "/admin/ai", label: "AI 助理", desc: "AI 月報摘要與 HR 資料問答", module: "總覽" },
  { href: "/admin/notifications", label: "通知中心", desc: "全租戶通知、未讀與投遞狀態", module: "總覽" },
  { href: "/admin/projects", label: "專案與成員分潤", desc: "專案、成員分潤比例與異動留痕", module: "獎金自動分配" },
  { href: "/admin/employees", label: "員工帳號與密碼配發", desc: "建立帳號、配發／重設密碼、角色權限", module: "帳號與權限" },
  { href: "/admin/departments", label: "組織單位", desc: "組織架構維護", module: "人事差勤 · 組織人事" },
  { href: "/admin/org-chart", label: "公司組織圖", desc: "部門階層樹狀圖", module: "人事差勤 · 組織人事" },
  { href: "/admin/onboarding", label: "報到管理", desc: "新進人員報到與建檔", module: "人事差勤 · 組織人事" },
  { href: "/admin/shifts", label: "班別", desc: "上下班時間與夜班", module: "人事差勤 · 差勤管理" },
  { href: "/admin/schedules", label: "排班 / 班表審核", desc: "指派員工班別與班表確認", module: "人事差勤 · 差勤管理" },
  { href: "/admin/punch-records", label: "打卡紀錄維護", desc: "查詢打卡與補登", module: "人事差勤 · 差勤管理" },
  { href: "/admin/leave-types", label: "假別與簽核流程", desc: "假別與各類別簽核者", module: "人事差勤 · 差勤管理" },
  { href: "/admin/leave-balances", label: "假別時數管理", desc: "查詢與設定員工年度可用時數", module: "人事差勤 · 差勤管理" },
  { href: "/admin/attendance-settlement", label: "結算作業", desc: "差勤結算與出勤日彙整", module: "人事差勤 · 差勤管理" },
  { href: "/admin/approvals", label: "待審核表單", desc: "待處理的請假／加班／補卡", module: "人事差勤 · 表單簽核" },
  { href: "/admin/form-records", label: "表單紀錄管理", desc: "請假、加班、補卡、公出/出差全紀錄", module: "人事差勤 · 表單簽核" },
  { href: "/admin/payroll", label: "薪資 / 保險資料", desc: "薪資保險資料、執行薪資、薪資單", module: "人事差勤 · 薪資" },
  { href: "/admin/payroll-tax", label: "所得稅 / 補充保費", desc: "批次調薪、非員工所得、補充保費", module: "人事差勤 · 薪資" },
  { href: "/admin/recruitment", label: "招募 ATS", desc: "職缺需求單、人才庫、面試、錄用", module: "人事差勤 · 招募與考核" },
  { href: "/admin/announcements", label: "最新消息 / 公告", desc: "公司規章、部門公告、最新消息", module: "公司公告" },
  { href: "/admin/company-space", label: "Company Space", desc: "權限項目、人員權限、站台設定", module: "公司公告" },
  { href: "/admin/module-settings", label: "模組設定", desc: "行事曆、差勤薪資規則、功能參數", module: "系統設定" },
  { href: "/admin/reports", label: "報表中心", desc: "出勤、請假、薪資、人力報表", module: "系統設定" },
];

export default function AdminOverview() {
  const [pending, setPending] = useState<number | null>(null);
  const [widgets, setWidgets] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [demoStatus, setDemoStatus] = useState<string | null>(null);
  const [seedingDemo, setSeedingDemo] = useState(false);

  useEffect(() => {
    let active = true;
    getRequests("pending")
      .then((res) => {
        if (active) setPending(res.requests.length);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "載入待簽核數失敗");
      });
    getBranding()
      .then((res) => {
        if (active) setWidgets(res.features?.dashboardWidgets ?? []);
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, []);

  const visibleLinks =
    widgets.length === 0
      ? LINKS
      : LINKS.filter((link) => {
          if (widgets.includes("待簽核申請") && link.href === "/admin/approvals") return true;
          if (widgets.includes("期末在職") && link.href === "/admin/dashboard") return true;
          if (widgets.includes("新進/離職") && link.href === "/admin/onboarding") return true;
          if (widgets.includes("公告") && link.href === "/admin/announcements") return true;
          if (widgets.includes("薪資作業") && link.href === "/admin/payroll") return true;
          return !["/admin/approvals", "/admin/dashboard", "/admin/onboarding", "/admin/announcements", "/admin/payroll"].includes(link.href);
        });

  async function onSeedDemo() {
    setError(null);
    setDemoStatus(null);
    setSeedingDemo(true);
    try {
      const res = await seedDemoData();
      setDemoStatus(`已建立 Demo 資料：${res.employees} 位員工、${res.attendanceDays} 筆出勤、${res.payslips} 份薪資單、${res.notifications} 筆通知。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立 Demo 資料失敗");
    } finally {
      setSeedingDemo(false);
    }
  }

  return (
    <>
      <PageHeader title="總覽" desc="後台管理首頁" />

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-medium text-gray-500">待簽核申請</h2>
            <p className="mt-1 text-3xl font-bold text-gray-900">
              {pending === null ? "—" : pending}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <button
              onClick={() => void onSeedDemo()}
              disabled={seedingDemo}
              className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 disabled:opacity-60 md:rounded-md md:py-2"
            >
              {seedingDemo ? "建立中…" : "建立 Demo 資料"}
            </button>
            <Link
              href="/admin/approvals"
              className="rounded-xl px-4 py-2.5 text-center text-sm font-medium text-white md:rounded-md md:py-2"
              style={{ backgroundColor: "var(--brand)" }}
            >
              前往簽核
            </Link>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {demoStatus && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{demoStatus}</p>}
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-gray-500">快捷連結</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visibleLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-lg border border-gray-100 p-4 transition hover:border-gray-300 hover:shadow-sm"
            >
              <p className="text-xs font-medium text-gray-400">{l.module}</p>
              <p className="mt-1 font-medium text-gray-800">{l.label}</p>
              <p className="mt-0.5 text-sm text-gray-500">{l.desc}</p>
            </Link>
          ))}
        </div>
        {visibleLinks.length === 0 && <Empty>無快捷連結</Empty>}
      </Card>
    </>
  );
}
