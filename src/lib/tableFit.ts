/**
 * No table scrolls sideways. Each table is measured against the room it has:
 *  1. it fits: left alone;
 *  2. it does not: data-fit="wrap" lets text wrap, then "tight" also shrinks it a little;
 *  3. it still does not: on a computer "fixed" shares the width between the columns; when the columns
 *     would be too thin to read, "cards" shows one card per row (index.css).
 * Printed documents (.zd-sheet), calendars and data-fit-off areas keep their own layout. A dt-keep table
 * (month grids, pivots) stays in rows and scrolls only if it truly cannot fit. Tables with .dt / .dt-phone
 * already become cards on phones (responsiveTables.ts).
 * Lists that fill the page (the h-[calc(100svh-…)] frames and the till) are sized down to the page's bottom edge.
 */
const PHONE = 640;
const MIN_COLUMN = 72;
const FILL = '[class*="h-[calc(100svh-8.5rem)]"], .pos-shell';
type Fit = "wrap" | "tight" | "fixed" | "cards" | null;

function labelCells(table: HTMLTableElement) {
  const labels: string[] = [];
  for (const th of Array.from(table.querySelectorAll("thead tr:last-child th"))) {
    const span = Number(th.getAttribute("colspan") || 1);
    for (let k = 0; k < span; k++) labels.push((th.textContent || "").trim());
  }
  for (const tr of Array.from(table.querySelectorAll(":scope > tbody > tr"))) {
    let col = 0;
    for (const td of Array.from(tr.children) as HTMLElement[]) {
      const label = labels[col] ?? "";
      if (td.dataset.label !== label) td.dataset.label = label;
      col += Number(td.getAttribute("colspan") || 1);
    }
  }
}

// Dates, amounts, percentages and document numbers are never split across lines, whatever the fit.
const WHOLE = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[ /-](?:\w{3}|\d{1,2})[ /-]\d{2,4}|(?:[A-Z]{3} )?-?[\d,]+(?:\.\d+)?%?|[A-Z]{1,8}-[A-Z0-9-]*\d)$/;
function markWhole(table: HTMLTableElement) {
  for (const td of Array.from(table.querySelectorAll<HTMLElement>(":scope > tbody > tr > td"))) {
    const whole = WHOLE.test((td.textContent || "").trim());
    if (whole && !td.dataset.whole) td.dataset.whole = "1";
    else if (!whole && td.dataset.whole) delete td.dataset.whole;
  }
}

const set = (t: HTMLTableElement, v: Fit) => {
  if (v) { if (t.dataset.fit !== v) t.dataset.fit = v; } else if (t.dataset.fit) delete t.dataset.fit;
};
/** The space a table really has: its wrapper can grow with it, so look up to the page for the narrowest box. */
function roomFor(t: HTMLTableElement): number {
  let room = Infinity;
  let box: HTMLElement | null = t.parentElement;
  for (let i = 0; box && i < 8; i++, box = box.parentElement) {
    if (box.clientWidth > 0) room = Math.min(room, box.clientWidth);
    if (box.tagName === "MAIN" || box.getAttribute("role") === "dialog") break;
  }
  return room;
}
const overflows = (t: HTMLTableElement) => t.getBoundingClientRect().width > roomFor(t) + 1;

const clearColumns = (t: HTMLTableElement) => {
  if (!t.dataset.sized) return;
  delete t.dataset.sized;
  for (const th of Array.from(t.tHead?.rows[0]?.cells || [])) th.style.width = "";
  for (const c of Array.from(t.querySelectorAll("[data-fit-hide]"))) c.removeAttribute("data-fit-hide");
};
const longestWord = (v: string | null) => Math.max(0, ...(v || "").trim().split(/\s+/).map((w) => w.length));
/**
 * Fixed layout shares the width evenly, which is too thin for amounts and dates that may not wrap. Those
 * columns (and ticks and buttons) get the width their content needs; text columns share the rest.
 * False when the columns that cannot wrap leave text columns too little room.
 */
function sizeColumns(t: HTMLTableElement, room: number): boolean {
  const heads = t.tHead?.rows;
  if (!heads || heads.length !== 1) return true;
  const ths = Array.from(heads[0].cells);
  if (ths.some((th) => th.colSpan > 1)) return true;
  const need = ths.map(() => 0);
  const text = ths.map(() => false);
  const words = ths.map(() => 0);
  const range = document.createRange();
  const rows = Array.from(t.tBodies[0]?.rows || []).filter((r) => r.cells.length === ths.length);
  for (const r of rows.slice(0, 40)) {
    Array.from(r.cells).forEach((c, i) => {
      const fixedWidth = !!c.dataset.whole || c.matches(".tabular-nums,.text-right,.num");
      if (!fixedWidth && (c.textContent || "").trim()) { text[i] = true; words[i] = Math.max(words[i], longestWord(c.textContent)); return; }
      if (!c.firstChild) return;
      range.selectNodeContents(c);
      const g = getComputedStyle(c);
      need[i] = Math.max(need[i], Math.ceil(range.getBoundingClientRect().width + parseFloat(g.paddingLeft) + parseFloat(g.paddingRight)) + 1);
    });
  }
  const heading = ths.map((th) => !!(th.textContent || "").trim());
  // With the room this tight, a column with a heading but nothing in any row is not worth showing.
  const hidden = ths.map((_, i) => heading[i] && !text[i] && !need[i] && rows.length > 0);
  // No column is narrower than its longest word (heading or text, up to 13 letters), so words stay whole.
  const floor = ths.map((th, i) => {
    const g = getComputedStyle(th);
    const word = Math.min(13, Math.max(longestWord(th.textContent), words[i]));
    return Math.ceil(word * parseFloat(g.fontSize) * 0.66 + parseFloat(g.paddingLeft) + parseFloat(g.paddingRight));
  });
  const sharing = ths.map((_, i) => text[i]);
  const count = sharing.filter(Boolean).length;
  const firm = ths.reduce((x, _, i) => x + (sharing[i] || hidden[i] ? 0 : Math.max(need[i] || 40, floor[i])), 0);
  const left = room - firm;
  if (count && left / count < MIN_COLUMN * 0.65) return false;
  if (!count && left < 0) return false;
  const wanted = ths.reduce((x, _, i) => x + (sharing[i] ? Math.max(floor[i], MIN_COLUMN * 0.65) : 0), 0);
  // Room to spare goes to the text columns evenly; if headings ask for more than there is, each gives way a little.
  const scale = wanted > left ? left / wanted : 1;
  const extra = wanted > left ? 0 : (left - wanted) / Math.max(1, count);
  t.dataset.sized = "1";
  rows.forEach((r) => hidden.forEach((h, i) => { if (h) r.cells[i].setAttribute("data-fit-hide", ""); }));
  ths.forEach((th, i) => {
    if (hidden[i]) { th.setAttribute("data-fit-hide", ""); return; }
    const w = sharing[i] ? Math.max(floor[i], MIN_COLUMN * 0.65) * scale + extra : Math.max(need[i] || 40, floor[i]);
    th.style.width = `${Math.floor(w)}px`;
  });
  return true;
}

const memo = new WeakMap<HTMLTableElement, string>();
function fit(t: HTMLTableElement) {
  if (t.closest('.zd-sheet, .print-only, [data-fit-off], [role="grid"]') || !t.parentElement || t.parentElement.clientWidth === 0) return;
  // Measuring is only repeated when something that affects it changed: keeps busy pages fast.
  const key = `${window.innerWidth}|${t.parentElement.clientWidth}|${t.offsetWidth}|${t.rows.length}|${(t.textContent || "").length}`;
  if (memo.get(t) === key) return;
  memo.set(t, key);
  clearColumns(t);
  const cols = t.querySelectorAll("thead tr:last-child th").length;
  const keep = t.classList.contains("dt-keep");
  const phone = window.innerWidth < PHONE;
  const phoneCards = !keep && (t.classList.contains("dt") || t.classList.contains("dt-phone"));
  if (phone && phoneCards) return set(t, null);
  if (cols >= 2 && !phoneCards) labelCells(t);
  const editors = !!t.querySelector("tbody input:not([type=checkbox]), tbody textarea, tbody select, tbody [role=combobox]");
  if (phone && cols >= 3 && !keep && !editors && !t.closest('form, [role="dialog"]')) return set(t, "cards");
  set(t, null);
  if (!overflows(t)) return;
  markWhole(t);
  set(t, "wrap");
  if (!overflows(t)) return;
  set(t, "tight");
  if (!overflows(t)) return;
  const roomy = roomFor(t) / Math.max(cols, 1) >= MIN_COLUMN;
  if (keep) {
    set(t, roomy ? "fixed" : "tight");
    if (roomy) sizeColumns(t, roomFor(t));
    return;
  }
  if (!phone && roomy && !editors) {
    set(t, "fixed");
    if (sizeColumns(t, roomFor(t))) return;
  }
  set(t, cols >= 2 ? "cards" : "fixed");
}

function fillPage() {
  const main = document.querySelector<HTMLElement>("main.erp-main");
  if (!main) return;
  const frames = Array.from(main.querySelectorAll<HTMLElement>(FILL)).filter((el) => !el.parentElement?.closest(FILL));
  const phone = window.innerWidth < 768;
  const box = main.getBoundingClientRect();
  const bottomPad = parseFloat(getComputedStyle(main).paddingBottom) || 0;
  for (const el of frames) {
    const top = el.getBoundingClientRect().top - box.top + main.scrollTop;
    // On a phone the frame also stops above the bottom menu, which main's padding reserves. The till keeps its own height.
    if (phone && el.classList.contains("pos-shell")) { if (el.style.height) el.style.height = ""; continue; }
    const h = `${Math.max(phone ? 320 : 448, Math.round(main.clientHeight - bottomPad - top))}px`;
    if (el.style.height !== h) el.style.height = h;
  }
}

/** Text cut off with dots (a .truncate name, a cell kept to one line) shows its full text on hover. */
function fullTextOnHover(e: Event) {
  const t = e.target as HTMLElement | null;
  const el = t?.closest?.<HTMLElement>(".truncate, td, th");
  if (!el || el.hasAttribute("title") || el.dataset.autoTitle === "0") return;
  const cut = el.scrollWidth > el.clientWidth + 1;
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (!cut || !text || text.length > 300) return;
  el.title = text;
}

export function installTableFit() {
  if (typeof window === "undefined" || typeof MutationObserver === "undefined") return;
  document.addEventListener("mouseover", fullTextOnHover, { passive: true });
  let frame = 0;
  const seen = new WeakSet<Element>();
  const schedule = () => { if (!frame) frame = window.setTimeout(run, 50); };
  const boxes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  function run() {
    frame = 0;
    for (const t of Array.from(document.querySelectorAll<HTMLTableElement>("table"))) {
      if (boxes && t.parentElement && !seen.has(t.parentElement)) { seen.add(t.parentElement); boxes.observe(t.parentElement); }
      fit(t);
    }
    fillPage();
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("resize", schedule);
  // The page-in animation moves a frame for a moment: measure again once it settles.
  document.addEventListener("animationend", schedule, true);
  schedule();
}
