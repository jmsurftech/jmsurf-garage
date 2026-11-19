/**
 * Stand-in for react-helmet-async (aliased in vite.config.ts). Version 3 of that
 * library left <head> untouched under React 18, so no page's title, description,
 * canonical or share tags were ever set. This writes them straight into <head>
 * and puts back what was there when the page goes away.
 *
 * Supports what the pages use: <title>, <meta name|property>, <link rel> and
 * <script> (JSON-LD).
 */
import { Children, Fragment, isValidElement, useEffect, type ReactNode } from "react";

type Tag = { type: string; props: Record<string, any> };

function collect(children: ReactNode, out: Tag[] = []): Tag[] {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const props = c.props as Record<string, any>;
    if (c.type === Fragment) collect(props.children, out);
    else if (typeof c.type === "string") out.push({ type: c.type, props });
  });
  return out;
}

const text = (children: unknown): string => (Array.isArray(children) ? children.join("") : children == null ? "" : String(children));

function apply(tags: Tag[]): () => void {
  const undo: (() => void)[] = [];
  for (const { type, props } of tags) {
    if (type === "title") {
      const before = document.title;
      document.title = text(props.children);
      undo.push(() => { document.title = before; });
      continue;
    }
    if (type === "meta" || type === "link") {
      const key = type === "meta" ? (props.name ? "name" : props.property ? "property" : null) : "rel";
      const attrs = Object.entries(props).filter(([k, v]) => k !== "children" && v != null && v !== false);
      const selector = key && props[key] ? `${type}[${key}="${String(props[key]).replace(/"/g, '\\"')}"]` : null;
      // A rel like "alternate" or "preload" can appear many times; only replace one-per-page links.
      const reuse = selector && (type === "meta" || props.rel === "canonical" || props.rel === "manifest");
      const existing = reuse ? (document.head.querySelector(selector!) as HTMLElement | null) : null;
      if (existing) {
        const saved = attrs.map(([k]) => [k, existing.getAttribute(k)] as const);
        attrs.forEach(([k, v]) => existing.setAttribute(k, String(v)));
        undo.push(() => saved.forEach(([k, v]) => (v == null ? existing.removeAttribute(k) : existing.setAttribute(k, v))));
      } else {
        const el = document.createElement(type);
        attrs.forEach(([k, v]) => el.setAttribute(k === "className" ? "class" : k === "charSet" ? "charset" : k === "httpEquiv" ? "http-equiv" : k, String(v)));
        el.setAttribute("data-head", "");
        document.head.appendChild(el);
        undo.push(() => el.remove());
      }
      continue;
    }
    if (type === "script") {
      const el = document.createElement("script");
      Object.entries(props).forEach(([k, v]) => { if (k !== "children" && k !== "dangerouslySetInnerHTML" && v != null) el.setAttribute(k, String(v)); });
      el.textContent = props.dangerouslySetInnerHTML?.__html ?? text(props.children);
      el.setAttribute("data-head", "");
      document.head.appendChild(el);
      undo.push(() => el.remove());
    }
  }
  return () => undo.reverse().forEach((f) => f());
}

export function Helmet({ children }: { children?: ReactNode; [k: string]: any }) {
  const tags = collect(children);
  const key = JSON.stringify(tags.map((t) => [t.type, Object.entries(t.props).filter(([k]) => k !== "children").map(([k, v]) => [k, k === "dangerouslySetInnerHTML" ? v?.__html : v]), text(t.props.children)]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => apply(tags), [key]);
  return null;
}

export function HelmetProvider({ children }: { children?: ReactNode; [k: string]: any }) {
  return <>{children}</>;
}

export default Helmet;
