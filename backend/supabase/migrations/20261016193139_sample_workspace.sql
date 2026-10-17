-- Fixed fictional data: never copy another account's live records.
create schema if not exists private;

create table private.workspace_setups (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  sample_data boolean not null,
  dataset_version integer not null default 1,
  completed_at timestamptz not null default now()
);
alter table private.workspace_setups enable row level security;
revoke all on private.workspace_setups from public, anon, authenticated;

-- Privileged writes stay in a non-exposed schema. No target user ID argument.
create function private.ensure_sample_workspace()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  is_sample boolean;
  class_ids uuid[] := array[gen_random_uuid(), gen_random_uuid()];
  student_id uuid;
  enrollment_id uuid;
  assessment_ids uuid[];
  student_index integer;
  class_index integer;
  assessment_index integer;
  day_index integer;
  start_year integer := extract(year from current_date)::integer
    - case when extract(month from current_date) < 7 then 1 else 0 end;
  names text[] := array[
    'Ada Morgan', 'Grace Chen', 'Amir Patel', 'Sofia Reyes', 'Noah Brooks',
    'Maya Tan', 'Leo Santos', 'Hana Park', 'Oliver Reed', 'Zara Ahmed',
    'Ethan Cole', 'Isla Nguyen', 'Lucas Silva', 'Nadia Hassan', 'Finn Walker'
  ];
  titles text[] := array['Quiz 1', 'Quiz 2', 'Assignment 1', 'Midterm Exam', 'Class Project'];
  types text[] := array['quiz', 'quiz', 'assignment', 'exam', 'project'];
begin
  if owner_id is null then
    raise exception 'Please sign in' using errcode = '42501';
  end if;

  -- Serialize requests even across browsers/server instances.
  perform 1 from public.profiles where id = owner_id for update;
  if not found then
    raise exception 'Your account profile is not ready. Please try again.';
  end if;

  select sample_data into is_sample from private.workspace_setups where user_id = owner_id;
  if found then return is_sample; end if;

  if exists (select 1 from public.classes where lecturer_id = owner_id) then
    insert into private.workspace_setups(user_id, sample_data) values (owner_id, false);
    return false;
  end if;

  for class_index in 1..2 loop
    insert into public.classes(id, name, course_code, academic_year, semester, lecturer_id)
    values (class_ids[class_index],
      case class_index when 1 then 'Mathematics (Sample)' else 'Science (Sample)' end,
      case class_index when 1 then 'MATH-DEMO' else 'SCI-DEMO' end,
      start_year::text || '/' || (start_year + 1)::text,
      case when extract(month from current_date) >= 7 then '1' else '2' end, owner_id);
  end loop;

  -- The existing schema requires globally unique student numbers.
  for student_index in 1..15 loop
    student_id := gen_random_uuid();
    insert into public.students(id, student_number, full_name)
    values (student_id, 'DEMO-' || owner_id::text || '-' || lpad(student_index::text, 2, '0'), names[student_index]);
    for class_index in 1..2 loop
      insert into public.enrollments(student_id, class_id)
      values (student_id, class_ids[class_index]);
    end loop;
  end loop;

  for class_index in 1..2 loop
    assessment_ids := array[]::uuid[];
    for assessment_index in 1..5 loop
      assessment_ids := array_append(assessment_ids, gen_random_uuid());
      insert into public.assessments(id, class_id, title, assessment_type, max_score, weight, due_date)
      values (assessment_ids[assessment_index], class_ids[class_index], titles[assessment_index],
        types[assessment_index], 100, 20, current_date - (5 - assessment_index) * 3);
    end loop;

    for student_index in 1..15 loop
      select e.id into enrollment_id
      from public.enrollments e join public.students s on s.id = e.student_id
      where e.class_id = class_ids[class_index]
        and s.student_number = 'DEMO-' || owner_id::text || '-' || lpad(student_index::text, 2, '0');

      for assessment_index in 1..5 loop
        insert into public.grades(enrollment_id, assessment_id, score)
        values (enrollment_id, assessment_ids[assessment_index],
          least(98, 48 + (student_index * 7 + class_index * 3) % 40 + assessment_index * 2));
      end loop;
      for day_index in 0..13 loop
        insert into public.attendance(enrollment_id, attendance_date, status)
        values (enrollment_id, current_date - day_index,
          case
            when (student_index + day_index + class_index) % 11 = 0 then 'absent'
            when (student_index + day_index + class_index) % 9 = 0 then 'excused'
            when (student_index + day_index + class_index) % 7 = 0 then 'late'
            else 'present'
          end);
      end loop;
    end loop;
  end loop;

  insert into private.workspace_setups(user_id, sample_data) values (owner_id, true);
  return true;
end;
$$;
revoke all on function private.ensure_sample_workspace() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.ensure_sample_workspace() to authenticated;

-- Only the invoker wrapper is exposed through PostgREST.
create function public.ensure_sample_workspace()
returns boolean
language sql
security invoker
set search_path = ''
as $$ select private.ensure_sample_workspace(); $$;
revoke all on function public.ensure_sample_workspace() from public, anon;
grant execute on function public.ensure_sample_workspace() to authenticated;
