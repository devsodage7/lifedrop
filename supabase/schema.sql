-- ============================================================
-- LifeDrop+ — public blood donor network
-- Supabase -> SQL Editor -> New query -> paste everything -> Run
--
-- Safe to re-run: drops and recreates the app tables.
-- ⚠ Re-running deletes existing donors / requests / inventory.
-- ============================================================

create extension if not exists pgcrypto;

drop table if exists contact_events cascade;
drop table if exists inventory cascade;
drop table if exists hospitals cascade;
drop table if exists sos_requests cascade;
drop view  if exists donors_public cascade;
drop table if exists donors cascade;
drop table if exists profiles cascade;

-- ------------------------------------------------------------
-- profiles: one row per auth user (role decides admin access)
-- ------------------------------------------------------------
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '',
  email      text,
  role       text not null default 'donor' check (role in ('donor', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- helper: is the caller an admin?
create or replace function is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- ------------------------------------------------------------
-- donors — phone stays private, public sees only the last 4 digits
-- ------------------------------------------------------------
create table donors (
  id            text primary key,
  user_id       uuid references auth.users(id) on delete set null default auth.uid(),
  name          text not null,
  phone_digits  text not null,
  blood_group   text not null,
  age           int,
  weight        int,
  gender        text default 'Other',
  city          text not null default '',
  last_donation date,
  verified      boolean not null default false,
  available     boolean not null default true,
  demo          boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index donors_phone_uniq on donors(phone_digits);
create index donors_group_city on donors(blood_group, city);

-- public, phone-free projection (view runs as owner -> controlled columns only)
create or replace view donors_public as
select
  id, name, blood_group, age, weight, gender, city, last_donation,
  verified, available, demo, created_at,
  right(phone_digits, 4) as phone_hint
from donors;

grant select on donors_public to anon, authenticated;

-- nobody reads the donors table directly (no select grant, no select policy)
revoke all on donors from anon, authenticated;
grant insert (id, user_id, name, phone_digits, blood_group, age, weight, gender, city, last_donation, available, demo, created_at)
  on donors to authenticated;
grant update (name, phone_digits, blood_group, age, weight, gender, city, last_donation, available, updated_at)
  on donors to authenticated;
grant update (verified) on donors to authenticated;
grant delete on donors to authenticated;

alter table donors enable row level security;

create policy donors_insert on donors for insert to authenticated
  with check (user_id = auth.uid());

create policy donors_update on donors for update to authenticated
  using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

create policy donors_delete on donors for delete to authenticated
  using (user_id = auth.uid() or is_admin());

-- users can never self-verify or steal another donor's row
create or replace function donors_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    new.verified := old.verified;
    new.user_id  := old.user_id;
    new.demo     := old.demo;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists donors_guard_trg on donors;
create trigger donors_guard_trg
  before update on donors
  for each row execute function donors_guard();

-- ------------------------------------------------------------
-- contact_events — audit trail + hourly rate limit for number reveals
-- ------------------------------------------------------------
create table contact_events (
  id         bigserial primary key,
  donor_id   text references donors(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table contact_events enable row level security;

create policy contact_select on contact_events for select to authenticated
  using (user_id = auth.uid() or is_admin());

grant select on contact_events to authenticated;

-- ------------------------------------------------------------
-- emergency SOS requests
-- ------------------------------------------------------------
create table sos_requests (
  id           text primary key,
  user_id      uuid references auth.users(id) on delete set null default auth.uid(),
  patient      text not null,
  phone_digits text not null,
  blood_group  text not null,
  units        int not null default 1 check (units between 1 and 15),
  hospital     text not null default '',
  city         text not null default '',
  urgency      text not null default 'urgent' check (urgency in ('critical', 'urgent', 'routine')),
  notes        text not null default '',
  status       text not null default 'ACTIVE' check (status in ('ACTIVE', 'RESOLVED')),
  demo         boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index sos_status_created on sos_requests(status, created_at desc);

alter table sos_requests enable row level security;

create policy sos_select on sos_requests for select to anon, authenticated using (true);
create policy sos_insert on sos_requests for insert to authenticated
  with check (user_id = auth.uid());
create policy sos_update on sos_requests for update to authenticated
  using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());
create policy sos_delete on sos_requests for delete to authenticated
  using (user_id = auth.uid() or is_admin());

grant select on sos_requests to anon, authenticated;
grant insert, update, delete on sos_requests to authenticated;

create or replace function sos_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    new.user_id := old.user_id;
    new.demo    := old.demo;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sos_guard_trg on sos_requests;
create trigger sos_guard_trg
  before update on sos_requests
  for each row execute function sos_guard();

-- ------------------------------------------------------------
-- blood banks + inventory
-- ------------------------------------------------------------
create table hospitals (
  id         text primary key,
  name       text not null,
  city       text not null default '',
  phone      text not null default '',
  created_at timestamptz not null default now()
);

create table inventory (
  hospital_id text not null references hospitals(id) on delete cascade,
  blood_group text not null,
  units       int not null default 0 check (units >= 0),
  updated_at  timestamptz not null default now(),
  primary key (hospital_id, blood_group)
);

alter table hospitals enable row level security;
alter table inventory enable row level security;

create policy hospitals_select on hospitals for select to anon, authenticated using (true);
create policy hospitals_write on hospitals for all to authenticated
  using (is_admin()) with check (is_admin());

create policy inventory_select on inventory for select to anon, authenticated using (true);
create policy inventory_write on inventory for all to authenticated
  using (is_admin()) with check (is_admin());

grant select on hospitals, inventory to anon, authenticated;
grant insert, update, delete on hospitals, inventory to authenticated;

-- ------------------------------------------------------------
-- RPCs used by the app
-- ------------------------------------------------------------

-- full record of the signed-in user's own donor profile
create or replace function my_donor()
returns setof donors
language sql stable security definer set search_path = public
as $$
  select * from donors where user_id = auth.uid() order by created_at limit 1;
$$;

-- all records, admins only
create or replace function admin_donors()
returns setof donors
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admin access required';
  end if;
  return query select * from donors order by created_at desc;
end;
$$;

-- reveal a donor's number to a signed-in user (logged, rate limited)
create or replace function donor_contact(p_id text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_phone  text;
  v_recent int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view donor phone numbers';
  end if;

  select phone_digits into v_phone from donors where id = p_id;
  if v_phone is null then
    raise exception 'Donor not found';
  end if;

  select count(*) into v_recent
  from contact_events
  where user_id = auth.uid() and created_at > now() - interval '1 hour';

  if v_recent >= 25 then
    raise exception 'Too many contact views in one hour. Please try later.';
  end if;

  insert into contact_events (donor_id, user_id) values (p_id, auth.uid());
  return v_phone;
end;
$$;

-- delete every sample row in one call (admins only)
create or replace function admin_clear_demo()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admin access required';
  end if;
  delete from donors where demo = true;
  delete from sos_requests where demo = true;
end;
$$;

grant execute on function my_donor, donor_contact, admin_donors, admin_clear_demo to authenticated;
grant execute on function is_admin to anon, authenticated;

-- ------------------------------------------------------------
-- starter blood banks (inventory is an example — update in Admin)
-- ------------------------------------------------------------
insert into hospitals (id, name, city, phone) values
  ('H-01', 'KEM Hospital Blood Bank',        'Mumbai',    '02224107000'),
  ('H-02', 'Ruby Hall Clinic Blood Bank',    'Pune',      '02066455100'),
  ('H-03', 'AIIMS Blood Bank',               'Delhi',     '01126588500'),
  ('H-04', 'Manipal Hospital Blood Bank',    'Bengaluru', '08025024444')
on conflict (id) do nothing;

insert into inventory (hospital_id, blood_group, units)
select h.id, g.grp, 0
from hospitals h
cross join (values ('O-'), ('O+'), ('A-'), ('A+'), ('B-'), ('B+'), ('AB-'), ('AB+')) as g(grp)
on conflict (hospital_id, blood_group) do nothing;
