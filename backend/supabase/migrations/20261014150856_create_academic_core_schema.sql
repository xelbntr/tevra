create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'lecturer' check (role in ('lecturer', 'admin')),
  created_at timestamptz not null default now()
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  course_code text not null,
  academic_year text not null,
  semester text not null,
  lecturer_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  student_number text not null unique,
  full_name text not null,
  email text,
  created_at timestamptz not null default now()
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'dropped')),
  created_at timestamptz not null default now(),
  unique (student_id, class_id),
  unique (id, class_id)
);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  title text not null,
  assessment_type text not null default 'other' check (assessment_type in ('exam', 'quiz', 'assignment', 'project', 'other')),
  max_score numeric(10,2) not null check (max_score > 0),
  weight numeric(5,2) check (weight >= 0 and weight <= 100),
  due_date date,
  created_at timestamptz not null default now(),
  unique (id, class_id)
);

create table public.grades (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  score numeric(10,2) not null check (score >= 0),
  feedback text,
  graded_at timestamptz not null default now(),
  unique (enrollment_id, assessment_id)
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  attendance_date date not null,
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  notes text,
  created_at timestamptz not null default now(),
  unique (enrollment_id, attendance_date)
);

create index classes_lecturer_id_idx on public.classes(lecturer_id);
create index enrollments_class_id_idx on public.enrollments(class_id);
create index enrollments_student_id_idx on public.enrollments(student_id);
create index assessments_class_id_idx on public.assessments(class_id);
create index grades_enrollment_id_idx on public.grades(enrollment_id);
create index grades_assessment_id_idx on public.grades(assessment_id);
create index attendance_enrollment_date_idx on public.attendance(enrollment_id, attendance_date);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'lecturer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.enrollments enable row level security;
alter table public.assessments enable row level security;
alter table public.grades enable row level security;
alter table public.attendance enable row level security;

grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.classes to authenticated;
grant select, insert, update, delete on public.students to authenticated;
grant select, insert, update, delete on public.enrollments to authenticated;
grant select, insert, update, delete on public.assessments to authenticated;
grant select, insert, update, delete on public.grades to authenticated;
grant select, insert, update, delete on public.attendance to authenticated;

create policy "Users can view their own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "Users can update their own profile name"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Lecturers manage their own classes"
on public.classes for all to authenticated
using (lecturer_id = (select auth.uid()))
with check (lecturer_id = (select auth.uid()));

create policy "Lecturers can view students in their classes"
on public.students for select to authenticated
using (
  exists (
    select 1
    from public.enrollments e
    join public.classes c on c.id = e.class_id
    where e.student_id = students.id
      and c.lecturer_id = (select auth.uid())
  )
);

create policy "Authenticated lecturers can add student records"
on public.students for insert to authenticated
with check ((select auth.uid()) is not null);

create policy "Lecturers can update students in their classes"
on public.students for update to authenticated
using (
  exists (
    select 1 from public.enrollments e
    join public.classes c on c.id = e.class_id
    where e.student_id = students.id and c.lecturer_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.enrollments e
    join public.classes c on c.id = e.class_id
    where e.student_id = students.id and c.lecturer_id = (select auth.uid())
  )
);

create policy "Lecturers can delete students in their classes"
on public.students for delete to authenticated
using (
  exists (
    select 1 from public.enrollments e
    join public.classes c on c.id = e.class_id
    where e.student_id = students.id and c.lecturer_id = (select auth.uid())
  )
);

create policy "Lecturers manage enrollments for their classes"
on public.enrollments for all to authenticated
using (
  exists (
    select 1 from public.classes c
    where c.id = enrollments.class_id and c.lecturer_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.classes c
    where c.id = enrollments.class_id and c.lecturer_id = (select auth.uid())
  )
);

create policy "Lecturers manage assessments for their classes"
on public.assessments for all to authenticated
using (
  exists (
    select 1 from public.classes c
    where c.id = assessments.class_id and c.lecturer_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.classes c
    where c.id = assessments.class_id and c.lecturer_id = (select auth.uid())
  )
);

create policy "Lecturers manage grades for their classes"
on public.grades for all to authenticated
using (
  exists (
    select 1
    from public.enrollments e
    join public.classes c on c.id = e.class_id
    join public.assessments a on a.id = grades.assessment_id and a.class_id = e.class_id
    where e.id = grades.enrollment_id
      and c.lecturer_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.enrollments e
    join public.classes c on c.id = e.class_id
    join public.assessments a on a.id = grades.assessment_id and a.class_id = e.class_id
    where e.id = grades.enrollment_id
      and c.lecturer_id = (select auth.uid())
  )
);

create policy "Lecturers manage attendance for their classes"
on public.attendance for all to authenticated
using (
  exists (
    select 1
    from public.enrollments e
    join public.classes c on c.id = e.class_id
    where e.id = attendance.enrollment_id
      and c.lecturer_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.enrollments e
    join public.classes c on c.id = e.class_id
    where e.id = attendance.enrollment_id
      and c.lecturer_id = (select auth.uid())
  )
);
