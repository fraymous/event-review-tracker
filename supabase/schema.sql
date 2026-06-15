create extension if not exists "pgcrypto";

do $$ begin
  create type app_role as enum ('manager', 'leadership');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type review_status as enum ('Draft', 'Needs follow-up', 'Reviewed', 'Closed');
exception when duplicate_object then null;
end $$;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  full_name text not null,
  email text,
  role app_role not null default 'manager',
  created_at timestamptz not null default now()
);

alter table profiles add column if not exists email text;

create table if not exists event_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_name text not null,
  event_date date not null,
  venue text not null,
  event_type text not null,
  manager_name text not null,
  staff_involved text[] not null default '{}',
  overall_rating integer check (overall_rating is null or overall_rating between 1 and 5),
  event_summary text,
  culinary_notes text,
  operational_notes text,
  client_feedback text,
  wins text,
  issues text,
  tags text[] not null default '{}',
  follow_up_status review_status not null default 'Draft',
  follow_up_owner text,
  follow_up_due_date date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table event_reviews add column if not exists follow_up_owner text;
alter table event_reviews add column if not exists follow_up_due_date date;

create table if not exists review_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  review_id uuid not null references event_reviews(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_type text not null,
  file_size bigint not null,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create table if not exists share_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  review_id uuid references event_reviews(id) on delete cascade,
  token text not null unique,
  scope text not null default 'single-review',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table share_links add column if not exists filters jsonb not null default '{}'::jsonb;

alter table share_links drop constraint if exists share_links_scope_shape;

alter table share_links
add constraint share_links_scope_shape
check (
  (scope = 'single-review' and review_id is not null)
  or (scope in ('filtered-report', 'executive-brief') and review_id is null)
) not valid;

create or replace function current_profile()
returns profiles
language sql
stable
security definer
set search_path = public
as $$
  select *
  from profiles
  where id = auth.uid()
  limit 1
$$;

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table event_reviews enable row level security;
alter table review_attachments enable row level security;
alter table share_links enable row level security;

drop policy if exists "profiles can read own organization profiles" on profiles;
create policy "profiles can read own organization profiles"
on profiles for select
using (organization_id = (select organization_id from current_profile()));

drop policy if exists "users can read their organization" on organizations;
create policy "users can read their organization"
on organizations for select
using (id = (select organization_id from current_profile()));

drop policy if exists "authenticated users can read organization reviews" on event_reviews;
create policy "authenticated users can read organization reviews"
on event_reviews for select
using (organization_id = (select organization_id from current_profile()));

drop policy if exists "managers can insert reviews" on event_reviews;
create policy "managers can insert reviews"
on event_reviews for insert
with check (
  organization_id = (select organization_id from current_profile())
  and (select role from current_profile()) = 'manager'
);

drop policy if exists "managers can update reviews" on event_reviews;
create policy "managers can update reviews"
on event_reviews for update
using (
  organization_id = (select organization_id from current_profile())
  and (select role from current_profile()) = 'manager'
)
with check (
  organization_id = (select organization_id from current_profile())
  and (select role from current_profile()) = 'manager'
);

drop policy if exists "authenticated users can read organization attachments" on review_attachments;
create policy "authenticated users can read organization attachments"
on review_attachments for select
using (organization_id = (select organization_id from current_profile()));

drop policy if exists "managers can insert attachments" on review_attachments;
create policy "managers can insert attachments"
on review_attachments for insert
with check (
  organization_id = (select organization_id from current_profile())
  and (select role from current_profile()) = 'manager'
  and exists (
    select 1
    from event_reviews r
    where r.id = review_id
      and r.organization_id = (select organization_id from current_profile())
  )
);

drop policy if exists "managers can delete attachments" on review_attachments;
create policy "managers can delete attachments"
on review_attachments for delete
using (
  organization_id = (select organization_id from current_profile())
  and (select role from current_profile()) = 'manager'
);

drop policy if exists "authenticated users can read organization share links" on share_links;
create policy "authenticated users can read organization share links"
on share_links for select
using (organization_id = (select organization_id from current_profile()));

drop policy if exists "managers can manage share links" on share_links;
create policy "managers can manage share links"
on share_links for all
using (
  organization_id = (select organization_id from current_profile())
  and (select role from current_profile()) = 'manager'
)
with check (
  organization_id = (select organization_id from current_profile())
  and (select role from current_profile()) = 'manager'
  and (
    (
      scope in ('filtered-report', 'executive-brief')
      and review_id is null
    )
    or exists (
      select 1
      from event_reviews r
      where r.id = review_id
        and r.organization_id = (select organization_id from current_profile())
    )
  )
);

insert into storage.buckets (id, name, public)
values ('review-attachments', 'review-attachments', false)
on conflict (id) do nothing;

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists event_reviews_touch_updated_at on event_reviews;
create trigger event_reviews_touch_updated_at
before update on event_reviews
for each row
execute function touch_updated_at();

create or replace function bootstrap_manager_profile(full_name text, organization_name text)
returns profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  existing_profile profiles;
  new_organization_id uuid;
  new_profile profiles;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select * into existing_profile
  from profiles
  where id = current_user_id
  limit 1;

  if found then
    return existing_profile;
  end if;

  insert into organizations (name)
  values (coalesce(nullif(organization_name, ''), 'Live Oak'))
  returning id into new_organization_id;

  insert into profiles (id, organization_id, full_name, email, role)
  values (
    current_user_id,
    new_organization_id,
    coalesce(nullif(full_name, ''), 'Manager'),
    (select email from auth.users where id = current_user_id),
    'manager'
  )
  returning * into new_profile;

  return new_profile;
end;
$$;

grant execute on function bootstrap_manager_profile(text, text) to authenticated;

drop policy if exists "authenticated users can read organization attachment objects" on storage.objects;
create policy "authenticated users can read organization attachment objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'review-attachments'
  and exists (
    select 1
    from profiles p
    where p.id = auth.uid()
      and name like p.organization_id::text || '/%'
  )
);

drop policy if exists "managers can upload organization attachment objects" on storage.objects;
create policy "managers can upload organization attachment objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'review-attachments'
  and exists (
    select 1
    from profiles p
    where p.id = auth.uid()
      and p.role = 'manager'
      and name like p.organization_id::text || '/%'
  )
);

drop policy if exists "managers can delete organization attachment objects" on storage.objects;
create policy "managers can delete organization attachment objects"
on storage.objects for delete to authenticated
using (
  bucket_id = 'review-attachments'
  and exists (
    select 1
    from profiles p
    where p.id = auth.uid()
      and p.role = 'manager'
      and name like p.organization_id::text || '/%'
  )
);
