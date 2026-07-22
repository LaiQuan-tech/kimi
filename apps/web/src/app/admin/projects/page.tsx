"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, PageHeader, PrimaryButton, ErrorText, Empty, inputCls, labelCls } from "@/components/admin-ui";
import { getDepartments, getEmployees, type Department, type Employee } from "@/lib/admin-api";
import { listProjects, createProject, type Project, type ShareMode } from "@/lib/projects-api";

export default function AdminProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [emps, setEmps] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create form
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [deptId, setDeptId] = useState("");
  const [leadEmpId, setLeadEmpId] = useState("");
  const [shareMode, setShareMode] = useState<ShareMode>("pool_pct");
  const [bonusPool, setBonusPool] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, d, e] = await Promise.all([listProjects(), getDepartments(), getEmployees()]);
      setProjects(p.projects);
      setDepts(d.departments);
      setEmps(e.employees.filter((x) => x.status === "active"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit() {
    if (!name.trim()) {
      setError("請輸入專案名稱");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createProject({
        name: name.trim(),
        code: code.trim() || null,
        description: description.trim() || null,
        deptId: deptId || null,
        leadEmpId: leadEmpId || null,
        shareMode,
        bonusPool: shareMode === "pool_pct" && bonusPool ? Number(bonusPool) : null,
      });
      setName("");
      setCode("");
      setDescription("");
      setDeptId("");
      setLeadEmpId("");
      setBonusPool("");
      setShareMode("pool_pct");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立失敗");
    } finally {
      setSaving(false);
    }
  }

  const deptName = (id: string | null) => depts.find((d) => d.id === id)?.name ?? "—";
  const empName = (id: string | null) => emps.find((e) => e.id === id)?.name ?? "—";

  return (
    <>
      <PageHeader title="專案獎金分潤" desc="建立專案、指派成員與分潤比例／金額，並上傳專案文件。組員彼此看不到分潤，負責人與部門主管可見全部。" />

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">建立專案</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>專案名稱 *</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：官網改版" />
          </div>
          <div>
            <label className={labelCls}>專案代號</label>
            <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="選填" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>說明</label>
            <textarea className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="選填" />
          </div>
          <div>
            <label className={labelCls}>所屬部門（驅動部門主管可見分潤）</label>
            <select className={inputCls} value={deptId} onChange={(e) => setDeptId(e.target.value)}>
              <option value="">不指定</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>專案負責人（可見／可調整全部分潤）</label>
            <select className={inputCls} value={leadEmpId} onChange={(e) => setLeadEmpId(e.target.value)}>
              <option value="">不指定</option>
              {emps.map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.emp_no ? `（${e.emp_no}）` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>分潤模式</label>
            <select className={inputCls} value={shareMode} onChange={(e) => setShareMode(e.target.value as ShareMode)}>
              <option value="pool_pct">獎金池 × 百分比</option>
              <option value="fixed_amount">直接填每人金額</option>
            </select>
          </div>
          {shareMode === "pool_pct" && (
            <div>
              <label className={labelCls}>獎金池總額</label>
              <input className={inputCls} type="number" min="0" value={bonusPool} onChange={(e) => setBonusPool(e.target.value)} placeholder="例如：100000" />
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <PrimaryButton onClick={submit} disabled={saving}>{saving ? "建立中…" : "建立專案"}</PrimaryButton>
          <ErrorText>{error}</ErrorText>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">所有專案</h2>
        {loading ? (
          <Empty>載入中…</Empty>
        ) : projects.length === 0 ? (
          <Empty>尚無專案</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-3">專案</th>
                  <th className="py-2 pr-3">部門</th>
                  <th className="py-2 pr-3">負責人</th>
                  <th className="py-2 pr-3">分潤模式</th>
                  <th className="py-2 pr-3">獎金池</th>
                  <th className="py-2 pr-3">狀態</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium text-gray-900">
                      {p.name}
                      {p.code && <span className="ml-1 text-xs text-gray-400">{p.code}</span>}
                    </td>
                    <td className="py-2 pr-3 text-gray-600">{deptName(p.deptId)}</td>
                    <td className="py-2 pr-3 text-gray-600">{empName(p.leadEmpId)}</td>
                    <td className="py-2 pr-3 text-gray-600">{p.shareMode === "pool_pct" ? "池×%" : "固定金額"}</td>
                    <td className="py-2 pr-3 text-gray-600">{p.bonusPool != null ? p.bonusPool.toLocaleString() : "—"}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${p.status === "active" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {p.status === "active" ? "進行中" : "已封存"}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <Link href={`/admin/projects/${p.id}`} className="text-sm font-medium" style={{ color: "var(--brand)" }}>
                        管理 →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
