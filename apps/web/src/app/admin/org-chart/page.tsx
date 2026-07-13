"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, PageHeader, Empty, ErrorText } from "@/components/admin-ui";
import { getOrgChart, type OrgNode } from "@/lib/admin-api";

function TreeNode({ node, depth }: { node: OrgNode; depth: number }) {
  return (
    <li>
      <div
        className="flex flex-wrap items-center gap-2 py-1.5"
        style={{ paddingLeft: `${depth * 20}px` }}
      >
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: "var(--brand)" }}
        />
        <span className="font-mono text-xs text-gray-400">{node.code}</span>
        <span className="font-medium text-gray-800">{node.name}</span>
        {node.managerLabel && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
            {node.managerLabel}
          </span>
        )}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrgChartPage() {
  const [tree, setTree] = useState<OrgNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getOrgChart();
      setTree(res.tree);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader title="公司組織圖" desc="部門階層樹狀圖" />
      <Card>
        {error && (
          <div className="mb-3">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
        {loading ? (
          <Empty>載入中…</Empty>
        ) : tree.length === 0 ? (
          <Empty>尚無部門</Empty>
        ) : (
          <ul>
            {tree.map((n) => (
              <TreeNode key={n.id} node={n} depth={0} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
