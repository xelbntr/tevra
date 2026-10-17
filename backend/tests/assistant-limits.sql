-- Run with a privileged connection after the migration. All test changes roll back.
begin;
do $test$
declare
  account_a uuid := gen_random_uuid();
  account_b uuid := gen_random_uuid();
  result jsonb;
  attempt integer;
begin
  if has_function_privilege('anon', 'public.consume_assistant_request()', 'execute')
    or has_function_privilege('anon', 'assistant_private.consume_request()', 'execute') then
    raise exception 'Anonymous callers must not consume assistant requests';
  end if;
  if has_table_privilege('authenticated', 'assistant_private.request_limits', 'select')
    or has_table_privilege('authenticated', 'assistant_private.request_limits', 'insert')
    or has_table_privilege('authenticated', 'assistant_private.request_limits', 'update')
    or has_table_privilege('authenticated', 'assistant_private.request_limits', 'delete') then
    raise exception 'Clients must not access or reset rate counters';
  end if;
  insert into auth.users (id, email) values
    (account_a, account_a::text || '@example.invalid'), (account_b, account_b::text || '@example.invalid');
  perform set_config('request.jwt.claims', json_build_object('sub', account_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for attempt in 1..6 loop
    result := public.consume_assistant_request();
    if not (result->>'allowed')::boolean then raise exception 'First six calls should be allowed'; end if;
  end loop;
  for attempt in 7..9 loop
    result := public.consume_assistant_request();
    if (result->>'allowed')::boolean or (result->>'retry_after_seconds')::integer not between 1 and 60 then
      raise exception 'Excess requests must be blocked with bounded retry guidance';
    end if;
  end loop;
  begin
    update assistant_private.request_limits set requests = 1;
    raise exception 'Client reset should fail';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', account_b, 'role', 'authenticated')::text, true);
  result := public.consume_assistant_request();
  if not (result->>'allowed')::boolean then raise exception 'Accounts must have independent limits'; end if;
  reset role;
  update assistant_private.request_limits set window_started_at = clock_timestamp() - interval '61 seconds' where user_id = account_a;
  perform set_config('request.jwt.claims', json_build_object('sub', account_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  result := public.consume_assistant_request();
  if not (result->>'allowed')::boolean then raise exception 'Expired windows must reset'; end if;
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.consume_assistant_request();
    raise exception 'Missing identity should fail';
  exception when insufficient_privilege then null;
  end;
  reset role;
  set local role anon;
  begin
    perform public.consume_assistant_request();
    raise exception 'Anonymous request should fail';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$test$;
rollback;
