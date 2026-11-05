-- Fix table-level grants + insert guard for donors
grant select on donors_public to anon, authenticated;

revoke all on donors from anon, authenticated;
grant insert, update, delete on donors to authenticated;

create or replace function donors_insert_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    new.user_id  := auth.uid();
    new.verified := false;
    new.demo     := false;
  end if;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists donors_insert_guard_trg on donors;
create trigger donors_insert_guard_trg
  before insert on donors
  for each row execute function donors_insert_guard();

-- same for SOS: table-level grants
revoke all on sos_requests from anon, authenticated;
grant select on sos_requests to anon, authenticated;
grant insert, update, delete on sos_requests to authenticated;
