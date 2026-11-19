/**
 * Tab bars scroll sideways on phones. Whenever a tab becomes the selected one
 * (clicked, or opened from a link such as Settings ?tab=website), scroll its
 * bar so the tab is visible. Only the bar scrolls, never the page.
 */
function reveal(tab: HTMLElement) {
  const bar = tab.closest<HTMLElement>('[role="tablist"]');
  if (!bar || bar.scrollWidth <= bar.clientWidth + 1) return;
  const t = tab.getBoundingClientRect();
  const b = bar.getBoundingClientRect();
  if (t.left < b.left) bar.scrollBy({ left: t.left - b.left - 16, behavior: "smooth" });
  else if (t.right > b.right) bar.scrollBy({ left: t.right - b.right + 16, behavior: "smooth" });
}

export function installActiveTabInView() {
  if (typeof window === "undefined" || typeof MutationObserver === "undefined") return;
  const check = (el: Element) => {
    if (el instanceof HTMLElement && el.getAttribute("role") === "tab" && el.dataset.state === "active") reveal(el);
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") check(r.target as Element);
      else r.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement) n.querySelectorAll('[role="tab"][data-state="active"]').forEach(check);
      });
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
}
