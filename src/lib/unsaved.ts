import { useEffect } from "react";
import { confirmAction } from "@/components/books/confirm";

/**
 * Warns before leaving a form with unsaved changes with the system dialog
 * (any link, sidebar entry or menu inside the app). No browser pop-up: closing
 * the tab itself cannot show our own dialog, so it is not intercepted.
 */
export function useUnsavedGuard(dirty: boolean, message = "You have unsaved changes. Leave without saving?") {
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
      const href = a.getAttribute("href") || "";
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      e.preventDefault();
      e.stopPropagation();
      void confirmAction({ title: "Leave this page?", message, confirmLabel: "Leave", danger: true }).then((ok) => {
        if (!ok) return;
        document.removeEventListener("click", onClick, true);
        a.click();
      });
    };
    document.addEventListener("click", onClick, true);
    return () => { document.removeEventListener("click", onClick, true); };
  }, [dirty, message]);
}
