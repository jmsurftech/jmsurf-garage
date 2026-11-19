import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { erpApi } from "@/lib/erpApi";

type Cls = { code: string; name: string };

/** Searchable KRA item classification picker (also accepts a typed 10-digit code). */
export function ClassPicker({ value, onChange, env, disabled, placeholder }: { value: string; onChange: (v: string) => void; env: string; disabled?: boolean; placeholder: string }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Cls[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setList([]); return; }
    const t = setTimeout(() => { erpApi("etims/classes", { q, env }).then((r: any) => setList(r.data || [])).catch(() => setList([])); }, 300);
    return () => clearTimeout(t);
  }, [q, env]);
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input className="fi pl-9" disabled={disabled} value={q} placeholder={value || placeholder} onChange={(x) => setQ(x.target.value)} />
      {(list.length > 0 || /^\d{8,10}$/.test(q.trim())) && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
          {list.length === 0 && <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { onChange(q.trim()); setQ(""); }}>Use code <span className="font-mono">{q.trim()}</span></button>}
          {list.map((c) => (
            <button key={c.code} type="button" className="flex w-full gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { onChange(c.code); setQ(""); setList([]); }}>
              <span className="font-mono text-xs text-muted-foreground">{c.code}</span><span>{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

