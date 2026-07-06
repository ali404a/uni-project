-- ═══════════════════════════════════════════════════════════
--  درب التبانة الجامعي — مخطط قاعدة البيانات (PostgreSQL / Supabase)
-- ═══════════════════════════════════════════════════════════

-- تفعيل الامتدادات
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";  -- للبحث النصي العربي

-- ─────────────────────────────────────────────
-- 1) الجامعات
-- ─────────────────────────────────────────────
create table if not exists universities (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,                       -- جامعة بغداد
  slug         text unique not null,                -- baghdad
  type         text not null check (type in ('حكومية','أهلية')),
  city         text,                                -- بغداد
  logo_url     text,
  website      text,
  description  text,
  established  int,                                 -- سنة التأسيس
  sort_order   int default 0,
  is_active    boolean default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ─────────────────────────────────────────────
-- 2) الكليات (تابعة لجامعة)
-- ─────────────────────────────────────────────
create table if not exists colleges (
  id             uuid primary key default uuid_generate_v4(),
  university_id  uuid references universities(id) on delete cascade,
  name           text not null,                     -- كلية الهندسة
  slug           text not null,
  icon           text,                              -- إيموجي أو اسم أيقونة
  description    text,
  sort_order     int default 0,
  is_active      boolean default true,
  created_at     timestamptz default now(),
  unique (university_id, slug)
);

-- ─────────────────────────────────────────────
-- 3) الأقسام الجامعية
-- ─────────────────────────────────────────────
create table if not exists departments (
  id               uuid primary key default uuid_generate_v4(),
  college_id       uuid references colleges(id) on delete cascade,
  name             text not null,                   -- هندسة الحاسوب
  slug             text not null,
  branch           text not null,                   -- الأحيائي / التطبيقي / الأدبي
  study_years      int default 4,                   -- سنوات الدراسة
  degree           text,                            -- بكالوريوس هندسة
  study_type       text default 'حكومي' check (study_type in ('حكومي','أهلي')),
  annual_fee       numeric,                         -- الرسوم للأهلي (null للحكومي)
  overview         text,                            -- تعريف القسم
  what_you_study   text,                            -- ماذا سيدرس الطالب
  career_paths     text,                            -- فرص العمل
  tags             text[],                          -- وسوم للبحث
  sort_order       int default 0,
  is_active        boolean default true,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  unique (college_id, slug)
);

-- ─────────────────────────────────────────────
-- 4) المعاهد
-- ─────────────────────────────────────────────
create table if not exists institutes (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,                       -- المعهد التقني - بغداد
  slug         text unique not null,
  type         text not null check (type in ('حكومي','أهلي')),
  city         text,
  specialties  text[],                              -- التخصصات المتاحة
  overview     text,
  logo_url     text,
  is_active    boolean default true,
  sort_order   int default 0,
  created_at   timestamptz default now()
);

-- ─────────────────────────────────────────────
-- 5) معدلات القبول (تاريخية) — لكل قسم/معهد لكل سنة
-- ─────────────────────────────────────────────
create table if not exists admission_rates (
  id            uuid primary key default uuid_generate_v4(),
  department_id uuid references departments(id) on delete cascade,
  institute_id  uuid references institutes(id) on delete cascade,
  year          int not null,                       -- 2025
  branch        text not null,                      -- الأحيائي
  round         int default 1,                      -- الدور
  min_rate      numeric not null,                   -- أدنى معدل قبول
  created_at    timestamptz default now(),
  check (department_id is not null or institute_id is not null)
);
create index if not exists idx_rates_dept on admission_rates(department_id, year);
create index if not exists idx_rates_inst on admission_rates(institute_id, year);

-- ─────────────────────────────────────────────
-- 6) الأخبار والنصائح
-- ─────────────────────────────────────────────
create table if not exists news (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  slug        text unique not null,
  excerpt     text,
  body        text,
  cover_url   text,
  category    text default 'خبر',                   -- خبر / نصيحة / موعد
  is_featured boolean default false,                -- يظهر في السلايدر
  published   boolean default true,
  published_at timestamptz default now(),
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────────
-- 7) مكتبة التقارير والبحوث
-- ─────────────────────────────────────────────
create table if not exists library_files (
  id            uuid primary key default uuid_generate_v4(),
  title         text not null,
  college_name  text,                               -- للتصنيف
  department_name text,
  stage         text,                               -- المرحلة الدراسية
  file_type     text,                               -- تقرير / بحث / ملزمة / نموذج
  file_url      text not null,
  size_kb       int,
  downloads     int default 0,
  created_at    timestamptz default now()
);

-- ─────────────────────────────────────────────
-- 8) رسائل التواصل
-- ─────────────────────────────────────────────
create table if not exists contact_messages (
  id         uuid primary key default uuid_generate_v4(),
  name       text,
  contact    text,
  kind       text default 'استفسار',               -- خطأ / مقترح / استفسار
  message    text not null,
  is_read    boolean default false,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- دالة مساعدة: تحديث updated_at تلقائياً
-- ─────────────────────────────────────────────
create or replace function touch_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_dept on departments;
create trigger trg_dept before update on departments
  for each row execute function touch_updated_at();

-- ─────────────────────────────────────────────
-- عرض مجمّع: قسم + كليته + جامعته + آخر معدل قبول
-- ─────────────────────────────────────────────
create or replace view v_departments_full as
select
  d.*,
  c.name  as college_name,
  c.icon  as college_icon,
  u.id    as university_id,
  u.name  as university_name,
  u.type  as university_type,
  u.city  as university_city,
  (select r.min_rate from admission_rates r
     where r.department_id = d.id order by r.year desc limit 1) as last_rate,
  (select r.year from admission_rates r
     where r.department_id = d.id order by r.year desc limit 1) as last_year
from departments d
left join colleges c    on c.id = d.college_id
left join universities u on u.id = c.university_id
where d.is_active;
