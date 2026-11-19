/**
 * On phones every data table (`table.dt`) is shown as a list of cards, one per
 * row, with each value labelled by its column (see `.dt` in index.css). The
 * labels come from the table's own header, copied onto each cell as
 * `data-label`, so no page has to describe its columns twice.
 *
 * A table opts out with the `dt-keep` class (it then scrolls sideways).
 */
function labelTable(table: HTMLTableElement) {
  const heads = Array.from(table.tHead?.rows[0]?.cells || []);
  if (heads.length === 0) return;
  // Expand header colspans so each body column index maps to its label.
  const labels: string[] = [];
  for (const th of heads) {
    const text = (th.textContent || "").trim();
    for (let i = 0; i < (th.colSpan || 1); i++) labels.push(text);
  }
  const key = labels.join("|");
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      if (row.dataset.dtl === key && row.cells.length === Number(row.dataset.dtn)) continue;
      let col = 0;
      for (const cell of Array.from(row.cells)) {
        const span = cell.colSpan || 1;
        if (span > 1 || !labels[col]) cell.removeAttribute("data-label");
        else cell.setAttribute("data-label", labels[col]);
        col += span;
      }
      row.dataset.dtl = key;
      row.dataset.dtn = String(row.cells.length);
    }
  }
}

let queued = false;
/** Wide list tables (a fixed min-width, e.g. min-w-[800px], or the basic ui Table) without input boxes get the same phone cards. */
function markWide() {
  document.querySelectorAll<HTMLTableElement>('table[class*="min-w-["]:not(.dt):not(.dt-phone):not(.dt-keep), table.ui-table:not(.dt-phone):not(.dt-keep)').forEach((t) => {
    if (t.querySelector('input:not([type="checkbox"]), select, textarea')) return;
    t.classList.add("dt-phone");
  });
}

function labelAll() {
  queued = false;
  markWide();
  document.querySelectorAll<HTMLTableElement>("table.dt:not(.dt-keep), table.dt-phone:not(.dt-keep)").forEach(labelTable);
}

export function installResponsiveTables() {
  if (typeof window === "undefined" || typeof MutationObserver === "undefined") return;
  const schedule = () => {
    if (queued) return;
    queued = true;
    window.setTimeout(labelAll, 50);
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
}
