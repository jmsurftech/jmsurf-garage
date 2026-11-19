import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, User } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { allLeaves } from "@/lib/navConfig";
import { OrbSpinner } from "@/components/orbs";

type Hit = { id: string; label: string; hint?: string };

/** Ctrl/Cmd+K: jump to any page, customer or product. */
export default function QuickFind({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [customers, setCustomers] = useState<Hit[]>([]);
  const [products, setProducts] = useState<Hit[]>([]);

  useEffect(() => { if (!open) setQ(""); }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (!open || !tenantId || term.length < 2) { setCustomers([]); setProducts([]); return; }
    const like = `%${term.replace(/[%_,()]/g, " ")}%`;
    let stale = false;
    setBusy(true);
    const t = setTimeout(async () => {
      const [c, p] = await Promise.all([
        supabase.from("customers").select("id, name, phone").eq("tenant_id", tenantId).or(`name.ilike.${like},phone.ilike.${like}`).limit(6),
        supabase.from("products").select("id, name, sku, price").eq("tenant_id", tenantId).or(`name.ilike.${like},sku.ilike.${like},barcode.ilike.${like}`).limit(6),
      ]);
      if (stale) return;
      setCustomers((c.data || []).map((r: any) => ({ id: r.id, label: r.name, hint: r.phone || "" })));
      setProducts((p.data || []).map((r: any) => ({ id: r.id, label: r.name, hint: r.sku || `KES ${Number(r.price || 0).toLocaleString()}` })));
      setBusy(false);
    }, 200);
    return () => { stale = true; clearTimeout(t); };
  }, [q, open, tenantId]);

  const go = (path: string) => { onClose(); navigate(path); };
  const pages = allLeaves();

  return (
    <CommandDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <CommandInput placeholder="Find a page, customer or product…" value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>{busy ? <span className="inline-flex items-center gap-2"><OrbSpinner state="searching" /> Searching…</span> : "Nothing found."}</CommandEmpty>
        <CommandGroup heading="Pages">
          {pages.map(({ leaf, parent }) => (
            <CommandItem key={leaf.path} value={`page ${leaf.label} ${parent?.label || ""}`} onSelect={() => go(leaf.path)}>
              <leaf.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{leaf.label}</span>
              {parent && <span className="ml-auto text-xs text-muted-foreground">{parent.label}</span>}
            </CommandItem>
          ))}
        </CommandGroup>
        {customers.length > 0 && (
          <CommandGroup heading="Customers">
            {customers.map((c) => (
              <CommandItem key={c.id} value={`customer ${c.label} ${c.hint} ${c.id}`} onSelect={() => go(`/customers/${c.id}`)}>
                <User className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>{c.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">{c.hint}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {products.length > 0 && (
          <CommandGroup heading="Products">
            {products.map((p) => (
              <CommandItem key={p.id} value={`product ${p.label} ${p.hint} ${p.id}`} onSelect={() => go(`/inventory/products/${p.id}/edit`)}>
                <Box className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>{p.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">{p.hint}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
