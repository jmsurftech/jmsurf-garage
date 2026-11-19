import * as React from "react";

/**
 * Only one dropdown, select or popover stays open at a time.
 *
 * Each panel registers a close callback while it is open; opening a new one
 * closes every other registered panel. Dialogs and sheets are untouched.
 */
const openPanels = new Set<() => void>();

function closeOthers(except: () => void) {
  openPanels.forEach((close) => {
    if (close !== except) close();
  });
}

/**
 * Drop-in open-state controller for Radix Root components. Keeps uncontrolled
 * usage working while still allowing us to close the panel from outside.
 */
/** Closes every open dropdown, select and popover (page change, a window opening, …). */
export function closeAllDropdowns() {
  openPanels.forEach((close) => close());
}

/** Lets a hand-made menu close when another dropdown opens, and be closed from outside. */
export function useRegisterDropdown(open: boolean, close: () => void) {
  const ref = React.useRef(close);
  ref.current = close;
  React.useEffect(() => {
    if (!open) return;
    const fn = () => ref.current();
    closeOthers(fn);
    openPanels.add(fn);
    return () => { openPanels.delete(fn); };
  }, [open]);
}

export function useSingleOpen(
  controlled: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
  defaultOpen?: boolean,
) {
  const [uncontrolled, setUncontrolled] = React.useState(!!defaultOpen);
  const isControlled = controlled !== undefined;
  const open = isControlled ? controlled : uncontrolled;

  const closeRef = React.useRef<() => void>(() => {});
  closeRef.current = () => {
    if (!isControlled) setUncontrolled(false);
    onOpenChange?.(false);
  };
  const closeSelf = React.useCallback(() => closeRef.current(), []);

  React.useEffect(() => {
    if (!open) return;
    openPanels.add(closeSelf);
    return () => {
      openPanels.delete(closeSelf);
    };
  }, [open, closeSelf]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (next) closeOthers(closeSelf);
      if (!isControlled) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [closeSelf, isControlled, onOpenChange],
  );

  return { open, onOpenChange: handleOpenChange };
}
