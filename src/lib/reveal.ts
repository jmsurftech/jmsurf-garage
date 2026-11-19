/**
 * Scroll animation: elements with a data-reveal attribute fade and rise into
 * view the first time they are scrolled to. One observer for the whole app;
 * new elements are picked up as pages change.
 */
let started = false;

export function startReveal() {
  if (started || typeof window === "undefined" || !("IntersectionObserver" in window)) {
    if (typeof document !== "undefined" && !("IntersectionObserver" in window)) document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-in"));
    return;
  }
  started = true;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  const scan = (root: ParentNode) => root.querySelectorAll?.("[data-reveal]:not(.is-in)").forEach((el) => io.observe(el));
  scan(document);
  new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach((n) => { if (n instanceof Element) { if (n.matches("[data-reveal]")) io.observe(n); scan(n); } }); })
    .observe(document.body, { childList: true, subtree: true });
}
