-- Contract files already saved go into Documents → Contracts (one folder per contract).
insert into public.documents (tenant_id, entity_type, entity_id, entity_name, name, category, path, expires_on, uploaded_by_name)
select c.tenant_id, 'contract', c.id, concat(c.number, ' · ', coalesce(c.party_name, ''), ' — ', c.title), x.name, x.category, x.path, c.end_date, x.who
from public.contracts c
cross join lateral (values
  (c.file_path, concat(c.title, case when c.file_path ilike '%.pdf' then '.pdf' else '' end), case when c.party_signed_at is not null then 'Signed contract' else 'Contract (to be signed)' end, null::text),
  (c.party_upload_path, concat('Signed copy from ', coalesce(c.party_name, 'the other party')), 'Signed copy (from the other party)', c.party_signer_name)
) as x(path, name, category, who)
where x.path is not null and not exists (select 1 from public.documents d where d.path = x.path);
