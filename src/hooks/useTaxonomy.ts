import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";

export interface CategoryRow {
  id: string;
  tenant_id: string;
  name: string;
  image_url: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export interface SubcategoryRow {
  id: string;
  tenant_id: string;
  category_id: string | null;
  parent_name: string | null;
  name: string;
  image_url: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export interface UnitRow {
  id: string;
  tenant_id: string;
  name: string;
  abbreviation: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function useCategories() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["product_categories", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("product_categories")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as CategoryRow[];
    },
  });
}

export function useSubcategories() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["product_subcategories", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("product_subcategories")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as SubcategoryRow[];
    },
  });
}

export function useUnits() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["product_units", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("product_units")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as UnitRow[];
    },
  });
}

/** Upload a taxonomy image (categories or subcategories) and return its public URL. */
export async function uploadTaxonomyImage(tenantId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${tenantId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("taxonomy-images").upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("taxonomy-images").getPublicUrl(path);
  return data.publicUrl;
}

export function useTaxonomyMutations() {
  const qc = useQueryClient();
  const tenantId = useTenantId();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["product_categories"] });
    qc.invalidateQueries({ queryKey: ["product_subcategories"] });
    qc.invalidateQueries({ queryKey: ["product_units"] });
  };

  return {
    addCategory: useMutation({
      mutationFn: async (input: { name: string; image_url?: string | null }) => {
        const { error, data } = await (supabase as any)
          .from("product_categories")
          .insert({ tenant_id: tenantId, name: input.name.trim(), image_url: input.image_url ?? null })
          .select()
          .single();
        if (error) throw error;
        return data;
      },
      onSuccess: invalidate,
    }),
    updateCategory: useMutation({
      mutationFn: async (input: { id: string; name?: string; image_url?: string | null }) => {
        const patch: any = {};
        if (input.name !== undefined) patch.name = input.name.trim();
        if (input.image_url !== undefined) patch.image_url = input.image_url;
        const { error } = await (supabase as any)
          .from("product_categories").update(patch).eq("id", input.id);
        if (error) throw error;
      },
      onSuccess: invalidate,
    }),
    deleteCategory: useMutation({
      mutationFn: async (id: string) => {
        const { error } = await (supabase as any)
          .from("product_categories").delete().eq("id", id);
        if (error) throw error;
      },
      onSuccess: invalidate,
    }),

    addSubcategory: useMutation({
      mutationFn: async (input: { name: string; category_id: string | null; parent_name: string; image_url?: string | null }) => {
        const { error, data } = await (supabase as any)
          .from("product_subcategories")
          .insert({
            tenant_id: tenantId,
            name: input.name.trim(),
            category_id: input.category_id,
            parent_name: input.parent_name,
            image_url: input.image_url ?? null,
          })
          .select()
          .single();
        if (error) throw error;
        return data;
      },
      onSuccess: invalidate,
    }),
    updateSubcategory: useMutation({
      mutationFn: async (input: { id: string; name?: string; image_url?: string | null; category_id?: string | null; parent_name?: string }) => {
        const patch: any = {};
        if (input.name !== undefined) patch.name = input.name.trim();
        if (input.image_url !== undefined) patch.image_url = input.image_url;
        if (input.category_id !== undefined) patch.category_id = input.category_id;
        if (input.parent_name !== undefined) patch.parent_name = input.parent_name;
        const { error } = await (supabase as any)
          .from("product_subcategories").update(patch).eq("id", input.id);
        if (error) throw error;
      },
      onSuccess: invalidate,
    }),
    deleteSubcategory: useMutation({
      mutationFn: async (id: string) => {
        const { error } = await (supabase as any)
          .from("product_subcategories").delete().eq("id", id);
        if (error) throw error;
      },
      onSuccess: invalidate,
    }),

    addUnit: useMutation({
      mutationFn: async (input: { name: string; abbreviation?: string | null }) => {
        const { error, data } = await (supabase as any)
          .from("product_units")
          .insert({ tenant_id: tenantId, name: input.name.trim(), abbreviation: input.abbreviation ?? null })
          .select()
          .single();
        if (error) throw error;
        return data;
      },
      onSuccess: invalidate,
    }),
    updateUnit: useMutation({
      mutationFn: async (input: { id: string; name?: string; abbreviation?: string | null }) => {
        const patch: any = {};
        if (input.name !== undefined) patch.name = input.name.trim();
        if (input.abbreviation !== undefined) patch.abbreviation = input.abbreviation;
        const { error } = await (supabase as any)
          .from("product_units").update(patch).eq("id", input.id);
        if (error) throw error;
      },
      onSuccess: invalidate,
    }),
    deleteUnit: useMutation({
      mutationFn: async (id: string) => {
        const { error } = await (supabase as any)
          .from("product_units").delete().eq("id", id);
        if (error) throw error;
      },
      onSuccess: invalidate,
    }),
  };
}
