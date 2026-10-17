-- Shared, atomic counters survive Vercel cold starts and concurrent instances.
create schema assistant_private;
revoke all on schema assistant_private from public, anon;
grant usage on schema assistant_private to authenticated;

create table assistant_private.request_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  requests integer not null check (requests between 1 and 7)
);
alter table assistant_private.request_limits enable row level security;
revoke all on assistant_private.request_limits from public, anon, authenticated;

-- The privileged implementation lives outside the exposed API schema. No caller
-- can choose another account, reset its counter, or directly update the table.
create function assistant_private.consume_request()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  current_time_value timestamptz := clock_timestamp();
  current_window timestamptz;
  used integer;
begin
  if caller is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  insert into assistant_private.request_limits as counters (user_id, window_started_at, requests)
  values (caller, current_time_value, 1)
  on conflict (user_id) do update set
    window_started_at = case when counters.window_started_at + interval '60 seconds' <= current_time_value
      then current_time_value else counters.window_started_at end,
    requests = case when counters.window_started_at + interval '60 seconds' <= current_time_value
      then 1 else least(counters.requests + 1, 7) end
  returning window_started_at, requests into current_window, used;
  return jsonb_build_object('allowed', used <= 6, 'limit', 6,
    'retry_after_seconds', case when used <= 6 then 0
      else greatest(1, ceil(extract(epoch from current_window + interval '60 seconds' - current_time_value))::integer) end);
end;
$$;
revoke all on function assistant_private.consume_request() from public, anon;
grant execute on function assistant_private.consume_request() to authenticated;

create function public.consume_assistant_request()
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$ select assistant_private.consume_request(); $$;
revoke all on function public.consume_assistant_request() from public, anon;
grant execute on function public.consume_assistant_request() to authenticated;
