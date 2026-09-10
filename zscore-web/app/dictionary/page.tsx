"use client";
import { useEffect, useState } from "react";
import { DICT_FIELD_META, DERIVED_ONLY_FIELDS } from "@/lib/constants";

type DictShape = {
  SYNONYMS: Record<string, string[]>;
  EQUITY_INCL_MINORITY: string[];
  FIELD_TREE?: Record<string, { label?: string; components?: Record<string, string[]> }>;
};

type Gap = {
  id: string; label: string; value: number | null; page: number | null;
  sample: string; suggested_field: string | null; suggested_kind: string | null;
  status: string; resolution: string; created_at: string;
};

// 页面录入项（非财报科目提取，不在字典别名中管理）
const INPUT_ONLY_FIELDS: { field: string; label: string; desc: string }[] = [
  {
    field: "equity_value",
    label: "股权价值",
    desc: "上市原始 Altman Z 的 X4 分子（股价×股本 或 评估值/最近融资估值）；由上传/结果页录入，非财报科目别名",
  },
];

export default function DictionaryPage() {
  const [dict, setDict] = useState<DictShape | null>(null);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  function loadData() {
    setLoading(true);
    fetch("/api/dictionary")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setDict(d.dict);
          setGaps((d.gaps as Gap[]) || []);
        } else setErr(d.message || d.error || "加载失败");
        setLoading(false);
      })
      .catch((e) => {
        setErr(String(e));
        setLoading(false);
      });
  }

  useEffect(() => { loadData(); }, []);

  function setFieldAliases(field: string, aliases: string[]) {
    if (!dict) return;
    setDict({
      ...dict,
      SYNONYMS: { ...dict.SYNONYMS, [field]: aliases },
    });
  }
  function addAlias(field: string, val: string) {
    const v = val.trim();
    if (!v) return;
    const cur = dict?.SYNONYMS[field] ?? [];
    if (cur.includes(v)) return;
    setFieldAliases(field, [...cur, v]);
  }
  function removeAlias(field: string, idx: number) {
    const cur = dict?.SYNONYMS[field] ?? [];
    setFieldAliases(field, cur.filter((_, i) => i !== idx));
  }
  async function save() {
    if (!dict) return;
    setStatus(null);
    const res = await fetch("/api/dictionary", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dict),
    });
    const data = await res.json();
    setStatus(
      data.ok ? "已保存 ✅ 下次上传分析即生效" : "保存失败：" + (data.message || data.error)
    );
  }

  if (loading) return <div className="text-sm text-gray-600">加载中…</div>;
  if (err)
    return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{err}</div>;
  if (!dict) return null;

  const fieldKeys = Object.keys(dict.SYNONYMS);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">数据字典（科目名 → 内部字段映射）</h1>
        <button
          onClick={save}
          className="bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700"
        >
          保存修改
        </button>
      </div>
      <p className="text-xs text-gray-600">
        此字典决定系统如何识别不同语言 / 准则下的财报科目。修改后下次上传分析即生效（无需重启服务）；
        网页端与 Python 引擎共用同一份 <code>dict/synonyms.json</code>。
      </p>
      {status && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-2">
          {status}
        </div>
      )}

      {gaps.length > 0 && (
        <GapsPanel gaps={gaps} onResolved={() => loadData()} />
      )}

      <div className="space-y-3">
        {fieldKeys.map((field) => (
          <FieldCard
            key={field}
            field={field}
            aliases={dict.SYNONYMS[field]}
            onAdd={addAlias}
            onRemove={removeAlias}
          />
        ))}
      </div>

      <section className="mt-6">
        <h2 className="text-md font-semibold mb-2">
          含少数股东口径的权益别名（EQUITY_INCL_MINORITY）
        </h2>
        <EquityEditor
          value={dict.EQUITY_INCL_MINORITY}
          onChange={(v) => setDict({ ...dict, EQUITY_INCL_MINORITY: v })}
        />
      </section>

      <section className="mt-6">
        <h2 className="text-md font-semibold mb-2">派生计算字段（由代码规则计算，不在字典别名中）</h2>
        <p className="text-xs text-gray-600 mb-2">
          以下字段由 Python 引擎从已提取字段推导得出（如 EBIT = 利润总额 + 利息费用），
          本身不进数据字典、不可在网页编辑别名。此处仅以只读方式展示其计算来源，便于一眼识别「哪些是算出来的」。
        </p>
        <div className="space-y-2">
          {DERIVED_ONLY_FIELDS.map((d) => (
            <div key={d.field} className="bg-amber-50/40 border border-amber-200 rounded-xl p-4">
              <div className="flex items-baseline justify-between mb-1">
                <code className="text-sm font-mono text-amber-800">{d.field}</code>
                <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium">
                  派生字段 · 代码计算
                </span>
              </div>
              <div className="text-sm text-gray-700 mb-1">{d.label}</div>
              <div className="text-xs text-amber-800">
                计算规则：{d.formula}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-md font-semibold mb-2">页面录入项（非财报科目提取）</h2>
        <p className="text-xs text-gray-600 mb-2">
          以下字段由人工在上传/结果页直接录入（如上市公司股权市值），
          不经过财报科目别名匹配，因此不在字典别名中管理。此处仅以只读方式展示其用途。
        </p>
        <div className="space-y-2">
          {INPUT_ONLY_FIELDS.map((d) => (
            <div key={d.field} className="bg-sky-50/40 border border-sky-200 rounded-xl p-4">
              <div className="flex items-baseline justify-between mb-1">
                <code className="text-sm font-mono text-sky-800">{d.field}</code>
                <span className="inline-flex items-center rounded-full bg-sky-100 text-sky-700 px-2 py-0.5 text-xs font-medium">
                  录入项 · 人工填写
                </span>
              </div>
              <div className="text-sm text-gray-700 mb-1">{d.label}</div>
              <div className="text-xs text-sky-800">
                用途：{d.desc}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function FieldCard({
  field,
  aliases,
  onAdd,
  onRemove,
}: {
  field: string;
  aliases: string[];
  onAdd: (f: string, v: string) => void;
  onRemove: (f: string, i: number) => void;
}) {
  const [val, setVal] = useState("");
  const meta = DICT_FIELD_META[field];
  const isDerived = meta?.kind === "derived";
  return (
    <div className="bg-white border rounded-xl p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <code className="text-sm font-mono text-blue-700">{field}</code>
          {meta && (
            <span className="ml-2 text-xs text-gray-600">
              {meta.label} · {meta.desc}
            </span>
          )}
          {isDerived ? (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium">
              派生字段 · 代码计算
            </span>
          ) : (
            <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-medium">
              直接提取
            </span>
          )}
        </div>
        <span className="text-xs text-gray-600">{aliases.length} 个别名</span>
      </div>
      {isDerived && meta?.formula && (
        <div className="mb-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
          计算规则：{meta.formula}
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-2">
        {aliases.map((a, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 bg-gray-100 rounded-full px-2.5 py-1 text-sm"
          >
            {a}
            <button
              onClick={() => onRemove(field, i)}
              className="text-gray-600 hover:text-red-600"
              aria-label="删除别名"
            >
              ×
            </button>
          </span>
        ))}
        {aliases.length === 0 && (
          <span className="text-xs text-gray-600">（暂无别名）</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onAdd(field, val);
              setVal("");
            }
          }}
          placeholder="输入新增别名后回车"
          className="flex-1 border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button
          onClick={() => {
            onAdd(field, val);
            setVal("");
          }}
          className="border rounded-md px-3 py-1 text-sm hover:bg-gray-50"
        >
          添加
        </button>
      </div>
    </div>
  );
}

function EquityEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [val, setVal] = useState("");
  function add() {
    const v = val.trim();
    if (!v || value.includes(v)) return;
    onChange([...value, v]);
    setVal("");
  }
  function remove(i: number) {
    onChange(value.filter((_, x) => x !== i));
  }
  return (
    <div className="bg-white border rounded-xl p-4 shadow-sm">
      <div className="flex flex-wrap gap-2 mb-2">
        {value.map((a, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 bg-gray-100 rounded-full px-2.5 py-1 text-sm"
          >
            {a}
            <button
              onClick={() => remove(i)}
              className="text-gray-600 hover:text-red-600"
              aria-label="删除别名"
            >
              ×
            </button>
          </span>
        ))}
        {value.length === 0 && (
          <span className="text-xs text-gray-600">（暂无别名）</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="输入新增权益别名后回车"
          className="flex-1 border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button
          onClick={add}
          className="border rounded-md px-3 py-1 text-sm hover:bg-gray-50"
        >
          添加
        </button>
      </div>
    </div>
  );
}

function GapsPanel({ gaps, onResolved }: { gaps: Gap[]; onResolved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function resolve(gap: Gap, action: "approve" | "ignore", field?: string, kind?: string) {
    setBusy(gap.id);
    try {
      await fetch("/api/dictionary/gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: gap.id, action,
          field: field ?? gap.suggested_field ?? undefined,
          kind: kind ?? gap.suggested_kind ?? "direct",
          alias: gap.label,
        }),
      });
      onResolved();
    } finally {
      setBusy(null);
    }
  }
  const fmtVal = (v: number | null) =>
    v == null ? "—" : Math.abs(v) >= 10000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(2);
  return (
    <section className="bg-amber-50/60 border border-amber-300 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-md font-semibold text-amber-900">
          待审科目（{gaps.length}）
        </h2>
        <span className="text-xs text-amber-800">
          未识别但有数值的科目 · 一键确认写回字典，下次分析自动生效
        </span>
      </div>
      {gaps.length === 0 ? (
        <p className="text-xs text-gray-600">暂无待审科目</p>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {gaps.slice(0, 30).map((g) => (
            <div key={g.id} className="bg-white border rounded-lg px-3 py-2 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <code className="text-sm font-mono text-gray-900 truncate">{g.label}</code>
                  <span className="text-xs text-gray-600 tabular-nums">{fmtVal(g.value)}</span>
                  {g.suggested_field && (
                    <span className="text-xs text-blue-700 bg-blue-50 rounded-full px-2 py-0.5">
                      建议: {g.suggested_field}/{g.suggested_kind || "direct"}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  来源: {g.sample || "—"} · pg {g.page ?? "—"}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                {g.suggested_field ? (
                  <button
                    disabled={busy === g.id}
                    onClick={() => resolve(g, "approve")}
                    className="bg-emerald-600 text-white rounded-md px-2.5 py-1 text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                  >
                    确认写回
                  </button>
                ) : (
                  <span className="text-xs text-gray-400 self-center">需手动归类</span>
                )}
                <button
                  disabled={busy === g.id}
                  onClick={() => resolve(g, "ignore")}
                  className="border border-gray-300 rounded-md px-2.5 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                >
                  忽略
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
