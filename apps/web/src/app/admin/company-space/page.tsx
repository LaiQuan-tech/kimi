"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Card, PageHeader, PrimaryButton, ErrorText, Empty, inputCls, labelCls } from "@/components/admin-ui";
import {
  getBranding,
  saveTenantSettings,
  type Branding,
  type InternalLink,
  type TenantFeatures,
  type TenantPermission,
} from "@/lib/admin-api";

const DEFAULT_PERMISSIONS: TenantPermission[] = [
  { module: "LinkUp", unit: "最新消息 / 部門公告 / 公司規章", desc: "公告、規章、內部連結與入口快捷管理", account: "HR 管理員", enabled: true },
  { module: "Foundation", unit: "Hire / Org / People / My Data", desc: "報到、人員主檔、組織與履歷資料", account: "HR 管理員", enabled: true },
  { module: "Attendance", unit: "班表 / 打卡 / 請假 / 加班 / 報表", desc: "差勤申請、簽核、補登、結算、假別時數", account: "HR 管理員 / 主管", enabled: true },
  { module: "Payroll", unit: "薪資 / 保險 / 稅務", desc: "薪資保險資料、薪資單、所得稅與補充保費", account: "HR 管理員 / 財務", enabled: true },
  { module: "Recruitment", unit: "ATS", desc: "職缺需求單、人才庫、面試與錄用流程", account: "HR 管理員 / 招募", enabled: true },
  { module: "Dashboard", unit: "人力分析", desc: "期初、新進、離職、期末與組織篩選", account: "HR 管理員", enabled: true },
];

const DEFAULT_WIDGETS = ["待簽核申請", "期末在職", "新進/離職", "公告", "薪資作業"];

export default function CompanySpacePage() {
  const [branding, setBranding] = useState<Branding>({ appName: "HR 後台", primaryColor: "#4f46e5" });
  const [features, setFeatures] = useState<TenantFeatures>({});
  const [permissions, setPermissions] = useState<TenantPermission[]>(DEFAULT_PERMISSIONS);
  const [links, setLinks] = useState<InternalLink[]>([]);
  const [widgets, setWidgets] = useState<string[]>(DEFAULT_WIDGETS);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBranding()
      .then((res) => {
        setBranding({ appName: "HR 後台", primaryColor: "#4f46e5", ...(res.branding ?? {}) });
        const nextFeatures = res.features ?? {};
        setFeatures(nextFeatures);
        setPermissions(nextFeatures.permissions?.length ? nextFeatures.permissions : DEFAULT_PERMISSIONS);
        setLinks([...(nextFeatures.internalLinks ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)));
        setWidgets(nextFeatures.dashboardWidgets?.length ? nextFeatures.dashboardWidgets : DEFAULT_WIDGETS);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "載入站台設定失敗"));
  }, []);

  const enabledPermissions = useMemo(
    () => permissions.filter((permission) => permission.enabled !== false).length,
    [permissions],
  );

  async function persist(next?: {
    branding?: Branding;
    features?: TenantFeatures;
    permissions?: TenantPermission[];
    links?: InternalLink[];
    widgets?: string[];
  }) {
    setError(null);
    setMessage(null);
    const nextBranding = next?.branding ?? branding;
    const nextPermissions = next?.permissions ?? permissions;
    const nextLinks = next?.links ?? links;
    const nextWidgets = next?.widgets ?? widgets;
    const nextFeatures = {
      ...features,
      ...(next?.features ?? {}),
      permissions: nextPermissions,
      internalLinks: nextLinks,
      dashboardWidgets: nextWidgets,
      site: {
        employeePortalPath: "/ess",
        adminPortalPath: "/admin",
        ...(features.site ?? {}),
        ...(next?.features?.site ?? {}),
      },
    };

    try {
      const saved = await saveTenantSettings({ branding: nextBranding, features: nextFeatures });
      setBranding({ appName: "HR 後台", primaryColor: "#4f46e5", ...(saved.branding ?? {}) });
      setFeatures(saved.features ?? {});
      setPermissions(saved.features?.permissions ?? nextPermissions);
      setLinks(saved.features?.internalLinks ?? nextLinks);
      setWidgets(saved.features?.dashboardWidgets ?? nextWidgets);
      setMessage("設定已儲存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    }
  }

  function togglePermission(index: number) {
    const next = permissions.map((permission, i) =>
      i === index ? { ...permission, enabled: permission.enabled === false } : permission,
    );
    setPermissions(next);
    void persist({ permissions: next });
  }

  function addLink(event: FormEvent) {
    event.preventDefault();
    if (!linkName.trim() || !linkUrl.trim()) {
      setError("請輸入連結名稱與 URL");
      return;
    }
    const next = [
      ...links,
      { name: linkName.trim(), url: linkUrl.trim(), enabled: true, sort: links.length + 1 },
    ];
    setLinks(next);
    setLinkName("");
    setLinkUrl("");
    void persist({ links: next });
  }

  function toggleLink(index: number) {
    const next = links.map((link, i) => (i === index ? { ...link, enabled: link.enabled === false } : link));
    setLinks(next);
    void persist({ links: next });
  }

  function removeLink(index: number) {
    const next = links.filter((_, i) => i !== index).map((link, sort) => ({ ...link, sort: sort + 1 }));
    setLinks(next);
    void persist({ links: next });
  }

  function toggleWidget(widget: string) {
    const next = widgets.includes(widget)
      ? widgets.filter((item) => item !== widget)
      : [...widgets, widget];
    setWidgets(next);
    void persist({ widgets: next });
  }

  return (
    <>
      <PageHeader title="Company Space" desc="權限項目設定、人員權限查詢、內部連結與站台設定" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-gray-500">啟用權限項目</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{enabledPermissions}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">內部連結</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{links.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">Dashboard Widgets</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{widgets.length}</p>
        </Card>
      </div>

      {message && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>}
      {error && <ErrorText>{error}</ErrorText>}

      <Card>
        <h2 className="mb-4 text-sm font-medium text-gray-500">站台設定</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label className={labelCls}>站台名稱</label>
            <input
              className={inputCls}
              value={branding.appName ?? ""}
              onChange={(event) => setBranding({ ...branding, appName: event.target.value })}
            />
          </div>
          <div>
            <label className={labelCls}>品牌色</label>
            <input
              type="color"
              className="h-10 w-full rounded-md border border-gray-300"
              value={branding.primaryColor ?? "#4f46e5"}
              onChange={(event) => setBranding({ ...branding, primaryColor: event.target.value })}
            />
          </div>
          <div>
            <label className={labelCls}>員工入口</label>
            <input className={inputCls} value={features.site?.employeePortalPath ?? "/ess"} readOnly />
          </div>
          <div>
            <label className={labelCls}>管理後台</label>
            <input className={inputCls} value={features.site?.adminPortalPath ?? "/admin"} readOnly />
          </div>
        </div>
        <div className="mt-4">
          <PrimaryButton onClick={() => void persist({ branding })}>儲存站台設定</PrimaryButton>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-gray-500">權限項目設定</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500">
                <th className="py-2 pr-4">啟用</th>
                <th className="py-2 pr-4">模組</th>
                <th className="py-2 pr-4">單元</th>
                <th className="py-2 pr-4">說明</th>
                <th className="py-2">管理帳號</th>
              </tr>
            </thead>
            <tbody>
              {permissions.map((row, index) => (
                <tr key={`${row.module}-${row.unit}`} className="border-b border-gray-50">
                  <td className="py-2 pr-4">
                    <input type="checkbox" checked={row.enabled !== false} onChange={() => togglePermission(index)} />
                  </td>
                  <td className="py-2 pr-4 font-medium text-gray-800">{row.module}</td>
                  <td className="py-2 pr-4">{row.unit}</td>
                  <td className="py-2 pr-4 text-gray-600">{row.desc}</td>
                  <td className="py-2">{row.account}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-sm font-medium text-gray-500">內部連結</h2>
          <form onSubmit={addLink} className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input className={inputCls} placeholder="連結名稱" value={linkName} onChange={(event) => setLinkName(event.target.value)} />
            <input className={inputCls} placeholder="https://example.com" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} />
            <PrimaryButton type="submit">新增</PrimaryButton>
          </form>
          {links.length === 0 ? (
            <Empty>尚無內部連結</Empty>
          ) : (
            <ul className="divide-y divide-gray-100">
              {links.map((link, index) => (
                <li key={`${link.name}-${index}`} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium text-gray-800">{link.name}</p>
                    <a className="text-gray-500 hover:underline" href={link.url} target="_blank" rel="noreferrer">
                      {link.url}
                    </a>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button onClick={() => toggleLink(index)} className="text-sm font-medium" style={{ color: "var(--brand)" }}>
                      {link.enabled === false ? "啟用" : "停用"}
                    </button>
                    <button onClick={() => removeLink(index)} className="text-sm text-red-600 hover:underline">
                      刪除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-medium text-gray-500">人員權限查詢 / Dashboard Widget</h2>
          <p className="text-sm text-gray-600">人員角色由 People 人員資料維護，可在此決定後台 Dashboard 顯示哪些快捷指標。</p>
          <Link href="/admin/employees" className="mt-3 inline-block text-sm font-medium" style={{ color: "var(--brand)" }}>
            前往 People 人員
          </Link>
          <div className="mt-5 flex flex-wrap gap-2">
            {DEFAULT_WIDGETS.map((widget) => (
              <button
                key={widget}
                onClick={() => toggleWidget(widget)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                  widgets.includes(widget) ? "text-white" : "bg-gray-100 text-gray-600"
                }`}
                style={widgets.includes(widget) ? { backgroundColor: "var(--brand)" } : undefined}
              >
                {widget}
              </button>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
