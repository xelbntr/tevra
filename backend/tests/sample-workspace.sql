-- Run through a privileged SQL connection. All test records are rolled back.
begin;
do $test$
declare
  account_a uuid := gen_random_uuid();
  account_b uuid := gen_random_uuid();
  account_existing uuid := gen_random_uuid();
  original_class uuid := gen_random_uuid();
  row_id uuid;
  row_total integer;
begin
  if has_function_privilege('anon', 'public.ensure_sample_workspace()', 'execute')
    or has_function_privilege('anon', 'private.ensure_sample_workspace()', 'execute') then
    raise exception 'Anonymous users must not execute setup';
  end if;
  if has_table_privilege('authenticated', 'private.workspace_setups', 'select')
    or has_table_privilege('authenticated', 'private.workspace_setups', 'insert')
    or has_table_privilege('authenticated', 'private.workspace_setups', 'update')
    or has_table_privilege('authenticated', 'private.workspace_setups', 'delete') then
    raise exception 'Clients must not access setup markers';
  end if;

  -- Exercise the existing auth.users -> profiles trigger too.
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data)
  values (account_a, account_a::text || '@example.invalid', '{}'::jsonb, '{}'::jsonb),
    (account_b, account_b::text || '@example.invalid', '{}'::jsonb, '{}'::jsonb),
    (account_existing, account_existing::text || '@example.invalid', '{}'::jsonb, '{}'::jsonb);
  insert into public.classes(id, name, course_code, academic_year, semester, lecturer_id)
  values (original_class, 'Existing classroom', 'EXIST', '2026/2027', '1', account_existing);

  perform set_config('request.jwt.claims', json_build_object('sub', account_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- A transaction failure cannot leave any partial setup or completion marker.
  begin
    perform public.ensure_sample_workspace();
    raise exception 'Simulated transaction failure' using errcode = 'ZX001';
  exception when sqlstate 'ZX001' then null;
  end;
  if exists (select 1 from public.classes) then raise exception 'Failed setup left partial classes'; end if;
  if not public.ensure_sample_workspace() then raise exception 'New account was not seeded'; end if;
  if not public.ensure_sample_workspace() then raise exception 'Repeat setup forgot sample status'; end if;
  if (select count(*) from public.classes) <> 2 then raise exception 'Expected exactly 2 classes'; end if;
  if (select count(*) from public.students) <> 15 then raise exception 'Expected 15 isolated students'; end if;
  if (select count(*) from public.enrollments) <> 30 then raise exception 'Expected 30 enrollments'; end if;
  if (select count(*) from public.assessments) <> 10 then raise exception 'Expected 10 assessments'; end if;
  if (select count(*) from public.grades) <> 150 then raise exception 'Expected 150 grades'; end if;
  if (select count(*) from public.attendance) <> 420 then raise exception 'Expected 420 attendance rows'; end if;
  if (select max(attendance_date) from public.attendance) <> (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Latest sample attendance does not match today in Jakarta';
  end if;
  if exists (select 1 from public.classes where lecturer_id <> account_a) then raise exception 'Cross-account classes visible'; end if;
  if exists (select 1 from public.grades g join public.assessments a on a.id=g.assessment_id where g.score>a.max_score) then
    raise exception 'Sample scores exceed assessment maximum';
  end if;

  select id into row_id from public.grades order by id limit 1;
  update public.grades set score = 0 where id = row_id;
  if not public.ensure_sample_workspace() or (select score from public.grades where id = row_id) <> 0 then
    raise exception 'Reinitialization overwrote a saved edit';
  end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', account_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.ensure_sample_workspace() then raise exception 'Second account was not seeded'; end if;
  if (select count(*) from public.students) <> 15 or (select count(*) from public.classes) <> 2 then
    raise exception 'Second account can see another account records';
  end if;
  if exists (select 1 from public.grades where id=row_id) then raise exception 'Cross-account grade is visible'; end if;
  update public.grades set score=99 where id=row_id;
  get diagnostics row_total = row_count;
  if row_total <> 0 then raise exception 'Cross-account grade update succeeded'; end if;
  delete from public.students where student_number like 'DEMO-' || account_a::text || '-%';
  get diagnostics row_total = row_count;
  if row_total <> 0 then raise exception 'Cross-account student deletion succeeded'; end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', account_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select score from public.grades where id=row_id) <> 0 then raise exception 'Another account changed the grade'; end if;
  delete from public.classes;
  if not public.ensure_sample_workspace() or exists (select 1 from public.classes) then
    raise exception 'Deleting sample classes must not rerun setup';
  end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', account_existing, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.ensure_sample_workspace() then raise exception 'Existing account marked as sample'; end if;
  if (select count(*) from public.classes) <> 1 or not exists(select 1 from public.classes where id=original_class) then
    raise exception 'Existing classroom changed';
  end if;
  if exists(select 1 from public.students) then raise exception 'Existing workspace received sample students'; end if;
  if public.ensure_sample_workspace() then raise exception 'Existing workspace status did not persist'; end if;

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  set local role authenticated;
  begin
    perform public.ensure_sample_workspace();
    raise exception 'Setup without an identity must fail';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$test$;
rollback;
select 'Sample setup, retry, idempotency, isolation, edits, deletion, existing accounts, and anonymous access: passed (rolled back)' as result;
