-- Approvals in stages (System → Approvals): each document type has ordered stages,
-- each with its approvers and whether any one or all of them must approve. The
-- request moves stage by stage; the person who sent it hears at every stage and
-- the next stage's approvers are alerted (bell / email / SMS / WhatsApp rules).

alter table public.approval_requests add column if not exists steps jsonb not null default '[]'::jsonb;
alter table public.approval_requests add column if not exists stage int not null default 0;
alter table public.approval_requests add column if not exists history jsonb not null default '[]'::jsonb;

/** The stages for a document type: {steps:[{label, approvers[], mode}]} or the older {approvers[]}. */
create or replace function public._approval_steps(t uuid, p_type text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb; steps jsonb := '[]'::jsonb; s jsonb; owners jsonb;
begin
  select erp_settings->'approvals'->p_type into cfg from public.business_settings where tenant_id = t;
  if jsonb_typeof(cfg->'steps') = 'array' then
    for s in select * from jsonb_array_elements(cfg->'steps') loop
      if jsonb_array_length(coalesce(s->'approvers', '[]'::jsonb)) > 0 then
        steps := steps || jsonb_build_array(jsonb_build_object('label', coalesce(nullif(s->>'label', ''), 'Stage ' || (jsonb_array_length(steps) + 1)),
          'approvers', s->'approvers', 'mode', case when s->>'mode' = 'all' then 'all' else 'any' end));
      end if;
    end loop;
  elsif jsonb_array_length(coalesce(cfg->'approvers', '[]'::jsonb)) > 0 then
    steps := jsonb_build_array(jsonb_build_object('label', 'Approval', 'approvers', cfg->'approvers', 'mode', 'any'));
  end if;
  if jsonb_array_length(steps) = 0 then
    select coalesce(jsonb_agg(ur.user_id), '[]'::jsonb) into owners from public.user_roles ur join public.profiles p on p.user_id = ur.user_id where p.tenant_id = t and ur.role = 'admin';
    steps := jsonb_build_array(jsonb_build_object('label', 'Owner approval', 'approvers', owners, 'mode', 'any'));
  end if;
  return steps;
end $$;

create or replace function public._stage_approvers(steps jsonb, i int) returns uuid[]
language sql immutable as $$
  select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(coalesce(steps->i->'approvers', '[]'::jsonb)) x
$$;

create or replace function public.submit_for_approval(p_type text, p_doc uuid, p_number text, p_title text, p_amount numeric)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare t uuid := public.current_user_tenant_id(); tbl text := public._approval_table(p_type); steps jsonb; rid uuid; nm text; ok int;
begin
  if tbl is null then raise exception 'Unknown document type'; end if;
  if t is null then raise exception 'Sign in first'; end if;
  -- EXECUTE does not set FOUND: read the result instead.
  execute format('select 1 from public.%I where id = $1 and tenant_id = $2', tbl) into ok using p_doc, t;
  if ok is null then raise exception 'Document not found'; end if;
  steps := public._approval_steps(t, p_type);
  update public.approval_requests set status = 'cancelled' where doc_type = p_type and doc_id = p_doc and status = 'pending';
  select display_name into nm from public.profiles where user_id = auth.uid();
  -- The alert trigger tells the first stage's approvers (on the channels the company chose).
  insert into public.approval_requests (tenant_id, doc_type, doc_id, doc_number, title, amount, requested_by_name, approvers, steps, stage)
  values (t, p_type, p_doc, p_number, p_title, p_amount, nm, public._stage_approvers(steps, 0), steps, 0) returning id into rid;
  execute format('update public.%I set approval_status = %L where id = $1', tbl, 'pending') using p_doc;
  return rid;
end $function$;

create or replace function public.decide_approval(p_request uuid, p_approve boolean, p_comment text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare r public.approval_requests; tbl text; nm text; step jsonb; nsteps int; done_here uuid[]; need uuid[]; final_status text;
begin
  select * into r from public.approval_requests where id = p_request and tenant_id = public.current_user_tenant_id() for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request was already decided'; end if;
  if not (auth.uid() = any(r.approvers) or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'You are not an approver at this stage';
  end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'Say why it is rejected'; end if;
  select display_name into nm from public.profiles where user_id = auth.uid();
  nsteps := greatest(jsonb_array_length(coalesce(r.steps, '[]'::jsonb)), 1);
  step := coalesce(r.steps->r.stage, jsonb_build_object('label', 'Approval', 'mode', 'any'));
  r.history := r.history || jsonb_build_array(jsonb_build_object('stage', r.stage, 'label', step->>'label', 'by', auth.uid(), 'by_name', nm,
    'decision', case when p_approve then 'approved' else 'rejected' end, 'comment', nullif(trim(p_comment), ''), 'at', now()));

  if not p_approve then
    final_status := 'rejected';
  else
    -- "All must approve": wait for everyone in this stage (owners can always move it on).
    select coalesce(array_agg(distinct (h->>'by')::uuid), '{}') into done_here from jsonb_array_elements(r.history) h
     where (h->>'stage')::int = r.stage and h->>'decision' = 'approved';
    need := array(select x from unnest(r.approvers) x where not (x = any(done_here)));
    if step->>'mode' = 'all' and cardinality(need) > 0 and not public.has_role(auth.uid(), 'admin') then
      update public.approval_requests set history = r.history, approvers = r.approvers where id = r.id;
      return;
    end if;
    if r.stage + 1 < nsteps then
      -- On to the next stage: its approvers and the sender are alerted by the trigger.
      update public.approval_requests set history = r.history, stage = r.stage + 1, approvers = public._stage_approvers(r.steps, r.stage + 1) where id = r.id;
      return;
    end if;
    final_status := 'approved';
  end if;

  update public.approval_requests set status = final_status, decided_by = auth.uid(), decided_by_name = nm, decided_at = now(),
    comment = nullif(trim(p_comment), ''), history = r.history where id = r.id;
  tbl := public._approval_table(r.doc_type);
  execute format('update public.%I set approval_status = %L where id = $1', tbl, final_status) using r.doc_id;
  if r.doc_type = 'requisition' then
    update public.requisitions set status = final_status, approved_by = auth.uid(), approved_by_name = nm, approved_at = now(),
      rejection_reason = case when p_approve then null else p_comment end where id = r.doc_id;
  end if;
end $function$;

-- Alerts: first stage on submit, each next stage, and the sender at every step.
create or replace function public.alert_approvals() returns trigger
language plpgsql security definer set search_path = public as $$
declare last jsonb; what text := coalesce(NEW.doc_number, 'a ' || replace(NEW.doc_type, '_', ' ')); stages int := greatest(jsonb_array_length(coalesce(NEW.steps, '[]'::jsonb)), 1);
begin
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    perform public.queue_alert(NEW.tenant_id, 'approval_requested', 'Approval needed: ' || coalesce(NEW.title, what),
      coalesce(NEW.requested_by_name, 'Someone') || ' asks you to approve ' || what ||
      case when NEW.amount is not null then ' (KES ' || to_char(NEW.amount, 'FM999,999,999,990.00') || ')' else '' end ||
      case when stages > 1 then ' · stage 1 of ' || stages else '' end || '.',
      '/approvals', NEW.approvers, '{}', 'approval', NEW.id);
  elsif TG_OP = 'UPDATE' and NEW.stage > OLD.stage and NEW.status = 'pending' then
    last := NEW.history->-1;
    perform public.queue_alert(NEW.tenant_id, 'approval_requested', 'Approval needed: ' || coalesce(NEW.title, what),
      coalesce(NEW.requested_by_name, 'Someone') || ' sent ' || what || '. Already approved by ' || coalesce(last->>'by_name', 'the previous stage') ||
      ' · stage ' || (NEW.stage + 1) || ' of ' || stages || '.', '/approvals', NEW.approvers, '{}', 'approval', NEW.id);
    perform public.queue_alert(NEW.tenant_id, 'approval_progress', 'Approved at stage ' || NEW.stage || ': ' || what,
      coalesce(last->>'by_name', 'An approver') || ' approved' || coalesce(' (' || (last->>'comment') || ')', '') ||
      '. Now with ' || coalesce(NEW.steps->NEW.stage->>'label', 'stage ' || (NEW.stage + 1)) || '.', '/approvals', array[NEW.requested_by], '{}', 'approval', NEW.id);
  elsif TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status and NEW.status in ('approved', 'rejected') then
    perform public.queue_alert(NEW.tenant_id, 'approval_decided', initcap(NEW.status) || ': ' || coalesce(NEW.title, what),
      coalesce(NEW.decided_by_name, 'An approver') || ' ' || NEW.status || ' ' || what ||
      case when stages > 1 then ' at stage ' || (NEW.stage + 1) || ' of ' || stages else '' end ||
      case when coalesce(NEW.comment, '') <> '' then ': ' || NEW.comment else '.' end,
      '/approvals', array[NEW.requested_by], '{}', 'approval', NEW.id);
  end if;
  return NEW;
end $$;
drop trigger if exists alert_approvals on public.approval_requests;
create trigger alert_approvals after insert or update of status, stage on public.approval_requests for each row execute function public.alert_approvals();
