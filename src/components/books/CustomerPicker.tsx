import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus, User } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Modal, Field } from "@/components/kit";
import { supabase } from "@/integrations/supabase/client";
import { useCustomers } from "@/hooks/useData";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface PickedCustomer { id: string; name: string; phone?: string | null; email?: string | null }

/** customer select with search and "New Customer". */
export function CustomerPicker({ value, onChange, className }: { value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const { data: customers = [] } = useCustomers();
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={cn("fi flex items-center justify-between gap-2 text-left", !value && "text-muted-foreground", className)}>
            <span className="truncate">{value ? value.name : "Select or add a customer"}</span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(420px,92vw)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search by name, phone or email…" />
            <CommandList>
              <CommandEmpty>No customer found.</CommandEmpty>
              <CommandGroup>
                {(customers as any[]).slice(0, 300).map((c) => (
                  <CommandItem key={c.id} value={`${c.name} ${c.phone || ""} ${c.email || ""} ${c.id}`} onSelect={() => { onChange({ id: c.id, name: c.name, phone: c.phone, email: c.email }); setOpen(false); }}>
                    <User className="mr-2 h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{c.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="border-t border-border p-1.5">
              <button type="button" onClick={() => { setOpen(false); setCreating(""); }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-primary hover:bg-primary/10">
                <Plus className="h-4 w-4" /> New Customer
              </button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>
      {creating !== null && <QuickCustomer onClose={() => setCreating(null)} onCreated={(c) => { onChange(c); setCreating(null); }} />}
    </>
  );
}

function QuickCustomer({ onClose, onCreated }: { onClose: () => void; onCreated: (c: PickedCustomer) => void }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState({ name: "", phone: "", email: "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim()) return toast({ title: "Enter the customer's name", variant: "destructive" });
    setBusy(true);
    const { data, error } = await (supabase as any).from("customers")
      .insert({ tenant_id: tenantId, name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() || null })
      .select("id, name, phone, email").single();
    setBusy(false);
    if (error) return toast({ title: "Customer not saved", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["customers"] });
    onCreated(data);
  };
  return (
    <Modal open onClose={onClose} title="New Customer" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Customer name" required><input className="fi" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Phone"><input className="fi" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="07XXXXXXXX" /></Field>
        <Field label="Email"><input className="fi" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
