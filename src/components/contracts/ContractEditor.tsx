import { useRef, useState } from "react";
import { Heading, ListOrdered, Pilcrow, Columns2, PenLine, Eye } from "lucide-react";
import { ContractPaper } from "@/components/contracts/ContractPaper";
import { cn } from "@/lib/utils";

type View = "write" | "split" | "preview";

/**
 * Edits the whole contract text in a large, readable editor. Toolbar buttons add a
 * new section (next number), a clause in the section the cursor is in, or a paragraph.
 */
export function ContractEditor({ value, onChange, paper }: {
  value: string; onChange: (v: string) => void;
  paper: Omit<React.ComponentProps<typeof ContractPaper>, "body">;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<View>("write");

  /** Inserts text at the cursor (or at the end) and puts the cursor where typing continues. */
  // Where the person last placed the cursor in the text; until then, additions go at the end.
  const cursor = useRef<number | null>(null);
  const insert = (text: string, select?: string) => {
    const el = ref.current;
    const at = cursor.current ?? value.length;
    // Insert after the paragraph the cursor is in, so a heading never splits a sentence.
    const nextBreak = value.indexOf("\n\n", at);
    const pos = nextBreak === -1 ? value.length : nextBreak;
    const next = `${value.slice(0, pos).replace(/\s+$/, "")}\n\n${text}${value.slice(pos)}`;
    onChange(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const start = next.indexOf(text, pos) + (select ? text.indexOf(select) : text.length);
      el.setSelectionRange(start, start + (select ? select.length : 0));
      cursor.current = start + (select ? select.length : 0);
    });
  };
  const sections = () => [...value.matchAll(/^(\d+)\.\s+[^\n]+$/gm)].map((m) => ({ n: Number(m[1]), at: m.index || 0 }));
  const addSection = () => {
    const n = Math.max(0, ...sections().map((s) => s.n)) + 1;
    insert(`${n}. NEW SECTION\n\n${n}.1 Write the first clause here.`, "NEW SECTION");
  };
  const addClause = () => {
    const at = cursor.current ?? value.length;
    const sec = sections().filter((s) => s.at <= at).pop() || sections().pop();
    if (!sec) return addSection();
    const nums = [...value.matchAll(new RegExp(`^${sec.n}\\.(\\d+)\\s`, "gm"))].map((m) => Number(m[1]));
    const k = Math.max(0, ...nums) + 1;
    insert(`${sec.n}.${k} Write the clause here.`, "Write the clause here.");
  };
  const addParagraph = () => insert("New paragraph.", "New paragraph.");

  const btn = "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium hover:border-primary/40 hover:text-primary";
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={addSection}><Heading className="h-4 w-4" /> Add section</button>
        <button type="button" className={btn} onClick={addClause}><ListOrdered className="h-4 w-4" /> Add clause</button>
        <button type="button" className={btn} onClick={addParagraph}><Pilcrow className="h-4 w-4" /> Add paragraph</button>
        <span className="ml-auto text-xs text-muted-foreground">{words.toLocaleString()} words</span>
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {([["write", PenLine, "Write"], ["split", Columns2, "Side by side"], ["preview", Eye, "Preview"]] as const).map(([k, Icon, l]) => (
            <button key={k} type="button" onClick={() => setView(k)} className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium", view === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}><Icon className="h-3.5 w-3.5" /> {l}</button>
          ))}
        </div>
      </div>
      <div className={cn("grid gap-4", view === "split" && "xl:grid-cols-2")}>
        {view !== "preview" && (
          <textarea ref={ref} value={value} onChange={(e) => { onChange(e.target.value); cursor.current = e.target.selectionEnd; }} spellCheck
            onSelect={(e) => { cursor.current = (e.target as HTMLTextAreaElement).selectionEnd; }}
            className="fi w-full resize-y px-5 py-4 font-sans text-[15px] leading-7"
            // Set here: the general text box style (textarea.fi) would otherwise shrink it to a few lines.
            style={{ height: "calc(100vh - 300px)", minHeight: 560 }} />
        )}
        {view !== "write" && (
          <div className="h-[calc(100vh-300px)] min-h-[560px] overflow-auto rounded-xl bg-muted/40 p-3"><ContractPaper {...paper} body={value} /></div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Sections: a number and a dot in capitals (5. PAYMENT). Clauses: 5.1, 5.2 … A blank line between paragraphs. The first line is the title.</p>
    </div>
  );
}
