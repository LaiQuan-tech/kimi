"use client";

import { useMemo, useEffect, useState } from "react";
import { Card, PageHeader, PrimaryButton, ErrorText, Empty, inputCls, labelCls } from "@/components/admin-ui";
import {
  getBranding,
  getRuleConfig,
  saveRuleConfig,
  saveTenantSettings,
  type RuleConfigResponse,
  type TenantFeatures,
} from "@/lib/admin-api";

const CALENDARS = [
  { name: "台灣行事曆", owner: "全公司", years: ["2025 已發佈", "2026 已發佈", "2027 待新增"] },
  { name: "門市排班行事曆", owner: "門市", years: ["2025 已發佈", "2026 已發佈", "2027 待新增"] },
  { name: "總部行事曆", owner: "總部", years: ["2025 已發佈", "2026 已發佈", "2027 待新增"] },
];

type YearStatus = "draft" | "published" | "locked";

const YEAR_STATUS_META: Record<YearStatus, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "bg-amber-50 text-amber-700" },
  published: { label: "已發佈", cls: "bg-green-50 text-green-700" },
  locked: { label: "已鎖定", cls: "bg-slate-100 text-slate-700" },
};

const FIELD_OPTIONS = [
  { value: "basic", label: "基本資料" },
  { value: "contact", label: "通訊資料" },
  { value: "education", label: "學歷" },
  { value: "certification", label: "證照" },
  { value: "workHistory", label: "工作經歷" },
];

export default function ModuleSettingsPage() {
  const [ruleConfig, setRuleConfig] = useState<RuleConfigResponse | null>(null);
  const [features, setFeatures] = useState<TenantFeatures>({});
  const [myDataRequiresApproval, setMyDataRequiresApproval] = useState(true);
  const [editableFields, setEditableFields] = useState("basic,contact,education,certification,workHistory");
  const [attachmentLimitKb, setAttachmentLimitKb] = useState("300");
  const [activeYear, setActiveYear] = useState(String(new Date().getFullYear()));
  const [yearStatus, setYearStatus] = useState<YearStatus>("published");
  const [workCalendar, setWorkCalendar] = useState("台灣行事曆");
  const [attendanceCutoffDay, setAttendanceCutoffDay] = useState("25");
  const [allowEmployeeDispute, setAllowEmployeeDispute] = useState(true);
  const [enableAutoSettlement, setEnableAutoSettlement] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const parsedEditableFields = useMemo(
    () =>
      new Set(
        editableFields
          .split(",")
          .map((field) => field.trim())
          .filter(Boolean),
      ),
    [editableFields],
  );

  useEffect(() => {
    getRuleConfig()
      .then((res) => {
        setRuleConfig(res);
        setDraft(JSON.stringify(res.config, null, 2));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "載入模組設定失敗"));
    getBranding()
      .then((res) => {
        const nextFeatures = res.features ?? {};
        const formParameters = (nextFeatures.formParameters as {
          myDataRequiresApproval?: boolean;
          editableFields?: string[];
          attachmentLimitKb?: number;
        } | undefined) ?? {};
        const attendanceModule = (nextFeatures.attendanceModule as {
          activeYear?: string;
          yearStatus?: YearStatus;
          workCalendar?: string;
          attendanceCutoffDay?: number;
          allowEmployeeDispute?: boolean;
          enableAutoSettlement?: boolean;
        } | undefined) ?? {};
        setFeatures(nextFeatures);
        setMyDataRequiresApproval(formParameters.myDataRequiresApproval ?? true);
        setEditableFields((formParameters.editableFields ?? ["basic", "contact", "education", "certification", "workHistory"]).join(","));
        setAttachmentLimitKb(String(formParameters.attachmentLimitKb ?? 300));
        setActiveYear(attendanceModule.activeYear ?? String(new Date().getFullYear()));
        setYearStatus(attendanceModule.yearStatus ?? "published");
        setWorkCalendar(attendanceModule.workCalendar ?? "台灣行事曆");
        setAttendanceCutoffDay(String(attendanceModule.attendanceCutoffDay ?? 25));
        setAllowEmployeeDispute(attendanceModule.allowEmployeeDispute ?? true);
        setEnableAutoSettlement(attendanceModule.enableAutoSettlement ?? false);
      })
      .catch(() => null);
  }, []);

  async function onSave() {
    setError(null);
    setMessage(null);
    try {
      const parsed = JSON.parse(draft);
      const res = await saveRuleConfig(parsed);
      setMessage(`規則設定已儲存，版本 ${res.version}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    }
  }

  async function onSaveFormParameters() {
    setError(null);
    setMessage(null);
    try {
      const nextFeatures = {
        ...features,
        formParameters: {
          myDataRequiresApproval,
          editableFields: editableFields
            .split(",")
            .map((field) => field.trim())
            .filter(Boolean),
          attachmentLimitKb: Number(attachmentLimitKb) || 300,
        },
      };
      const saved = await saveTenantSettings({ features: nextFeatures });
      setFeatures(saved.features ?? nextFeatures);
      setMessage("表單參數已儲存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存表單參數失敗");
    }
  }

  async function onSaveAttendanceModule() {
    setError(null);
    setMessage(null);
    try {
      const nextFeatures = {
        ...features,
        attendanceModule: {
          activeYear,
          yearStatus,
          workCalendar,
          attendanceCutoffDay: Number(attendanceCutoffDay) || 25,
          allowEmployeeDispute,
          enableAutoSettlement,
        },
      };
      const saved = await saveTenantSettings({ features: nextFeatures });
      setFeatures(saved.features ?? nextFeatures);
      setMessage("差勤模組設定已儲存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存差勤模組設定失敗");
    }
  }

  function toggleEditableField(field: string) {
    const next = new Set(parsedEditableFields);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    setEditableFields(Array.from(next).join(","));
  }

  return (
    <>
      <PageHeader title="模組設定" desc="對齊 Apollo：行事曆、差勤薪資規則與功能參數" />

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">行事曆管理</h2>
            <p className="mt-1 text-sm text-gray-500">維護年度行事曆、適用單位與年度狀態。</p>
          </div>
          <button
            type="button"
            onClick={() => setMessage("新增行事曆目前以設定入口呈現；正式新增需接後端行事曆 API。")}
            className="rounded-md border px-3 py-1.5 text-sm text-gray-600"
          >
            新增行事曆
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500">
                <th className="py-2 pr-4">行事曆名稱</th>
                <th className="py-2 pr-4">適用單位</th>
                <th className="py-2 pr-4">2025</th>
                <th className="py-2 pr-4">2026</th>
                <th className="py-2 pr-4">2027</th>
                <th className="py-2">設定</th>
              </tr>
            </thead>
            <tbody>
              {CALENDARS.map((calendar) => (
                <tr key={calendar.name} className="border-b border-gray-50">
                  <td className="py-2 pr-4 font-medium text-gray-800">{calendar.name}</td>
                  <td className="py-2 pr-4 text-gray-600">{calendar.owner}</td>
                  {calendar.years.map((year, index) => (
                    <td key={year} className="py-2 pr-4">
                      <span className={`rounded-full px-2 py-1 text-xs ${index === 2 ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"}`}>
                        {year}
                      </span>
                    </td>
                  ))}
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => {
                        setWorkCalendar(calendar.name);
                        setMessage(`已選擇 ${calendar.name} 作為目前差勤行事曆`);
                      }}
                      className="text-sm text-gray-600 hover:underline"
                    >
                      套用
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">年度狀態與差勤參數</h2>
            <p className="mt-1 text-sm text-gray-500">對齊 Apollo 的年度狀態、行事曆、截止日與員工異議設定。</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${YEAR_STATUS_META[yearStatus].cls}`}>
            {activeYear} {YEAR_STATUS_META[yearStatus].label}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls}>年度</label>
            <input className={inputCls} value={activeYear} onChange={(event) => setActiveYear(event.target.value)} placeholder="2026" />
          </div>
          <div>
            <label className={labelCls}>年度狀態</label>
            <select className={inputCls} value={yearStatus} onChange={(event) => setYearStatus(event.target.value as YearStatus)}>
              <option value="draft">草稿</option>
              <option value="published">已發佈</option>
              <option value="locked">已鎖定</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>預設行事曆</label>
            <select className={inputCls} value={workCalendar} onChange={(event) => setWorkCalendar(event.target.value)}>
              {CALENDARS.map((calendar) => (
                <option key={calendar.name} value={calendar.name}>{calendar.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>差勤截止日</label>
            <input type="number" min={1} max={31} className={inputCls} value={attendanceCutoffDay} onChange={(event) => setAttendanceCutoffDay(event.target.value)} />
          </div>
          <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700">
            <input type="checkbox" checked={allowEmployeeDispute} onChange={(event) => setAllowEmployeeDispute(event.target.checked)} />
            允許員工班表/出勤異議
          </label>
          <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700">
            <input type="checkbox" checked={enableAutoSettlement} onChange={(event) => setEnableAutoSettlement(event.target.checked)} />
            啟用自動結算提醒
          </label>
        </div>
        <div className="mt-4">
          <PrimaryButton onClick={onSaveAttendanceModule}>儲存差勤模組設定</PrimaryButton>
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">差勤 / 薪資規則</h2>
            <p className="mt-1 text-sm text-gray-500">JSON 規則控制遲到、加班、夜間與薪資計算。</p>
          </div>
          {ruleConfig && (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
              版本 {ruleConfig.version}
            </span>
          )}
        </div>
        {ruleConfig ? (
          <>
            <p className="mb-2 text-xs text-gray-500">
              目前版本：{ruleConfig.version} {ruleConfig.isDefault ? "（預設值）" : ""}
            </p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-96 w-full rounded-md border border-gray-300 p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
            />
            <div className="mt-4">
              <PrimaryButton onClick={onSave}>儲存規則</PrimaryButton>
            </div>
          </>
        ) : (
          <Empty>載入中…</Empty>
        )}
        {message && <p className="mt-3 text-sm text-green-600">{message}</p>}
        {error && <div className="mt-3"><ErrorText>{error}</ErrorText></div>}
      </Card>

      <Card>
        <h2 className="mb-4 text-base font-semibold text-gray-900">表單參數設定</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={myDataRequiresApproval}
              onChange={(event) => setMyDataRequiresApproval(event.target.checked)}
            />
            My Data 修改需送審
          </label>
          <div className="sm:col-span-2">
            <label className={labelCls}>可編輯資料區塊</label>
            <div className="flex flex-wrap gap-2">
              {FIELD_OPTIONS.map((field) => (
                <button
                  key={field.value}
                  type="button"
                  onClick={() => toggleEditableField(field.value)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    parsedEditableFields.has(field.value)
                      ? "text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                  style={parsedEditableFields.has(field.value) ? { backgroundColor: "var(--brand)" } : undefined}
                >
                  {field.label}
                </button>
              ))}
            </div>
            <input
              className={`${inputCls} mt-2`}
              value={editableFields}
              onChange={(event) => setEditableFields(event.target.value)}
              placeholder="basic,contact,education"
            />
          </div>
          <div>
            <label className={labelCls}>附件上限 KB</label>
            <input
              type="number"
              className={inputCls}
              value={attachmentLimitKb}
              onChange={(event) => setAttachmentLimitKb(event.target.value)}
            />
          </div>
        </div>
        <div className="mt-4">
          <PrimaryButton onClick={onSaveFormParameters}>儲存表單參數</PrimaryButton>
        </div>
      </Card>
    </>
  );
}
