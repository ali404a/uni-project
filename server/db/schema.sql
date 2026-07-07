-- ═══════════════════════════════════════════════════════════════
--  درب التبانة الجامعي — مخطط قاعدة البيانات (PostgreSQL / Supabase)
--  مصمّم ليتحمّل 10,000+ طالب. يشمل: الجامعات، الكليات، الأقسام،
--  المعدلات، المعاهد، الأخبار، المكتبة، الأدمن، والإحصائيات.
-- ═══════════════════════════════════════════════════════════════
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ─── الجامعات ───
create table if not exists universities (
  id uuid primary key default uuid_generate_v4(),
  slug text unique not null,
  name text not null,
  type text not null default 'حكومية' check (type in ('حكومية','أهلية')),
  city text default '', established int, website text default '',
  description text default '', logo_url text default '',
  sort_order int default 1000, is_active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists idx_uni_type on universities(type) where is_active;
create index if not exists idx_uni_sort on universities(sort_order);

-- ─── الكليات ───
create table if not exists colleges (
  id uuid primary key default uuid_generate_v4(),
  university_id uuid references universities(id) on delete cascade,
  slug text not null, name text not null, icon text default '',
  sort_order int default 1000, created_at timestamptz default now(),
  unique(university_id, slug)
);
create index if not exists idx_col_uni on colleges(university_id);

-- ─── الأقسام ───
create table if not exists departments (
  id uuid primary key default uuid_generate_v4(),
  college_id uuid references colleges(id) on delete cascade,
  slug text not null, name text not null,
  branch text not null default 'علمي' check (branch in ('علمي','أدبي','فنون')),
  study_years int default 4, degree text default '', overview text default '',
  what_you_study text default '', career_paths text default '', tags text[] default '{}',
  study_type text default 'حكومي' check (study_type in ('حكومي','أهلي')),
  annual_fee bigint, is_active boolean default true, sort_order int default 1000,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique(college_id, slug)
);
create index if not exists idx_dept_college on departments(college_id);
create index if not exists idx_dept_branch on departments(branch) where is_active;
create index if not exists idx_dept_name on departments(name);

-- ─── معدلات القبول ───
create table if not exists admission_rates (
  id uuid primary key default uuid_generate_v4(),
  department_id uuid references departments(id) on delete cascade,
  year int not null default 2025, branch text default 'علمي',
  min_rate numeric(6,2) not null, min_total numeric(7,2),
  created_at timestamptz default now(),
  unique(department_id, year, branch)
);
create index if not exists idx_rate_dept on admission_rates(department_id);

-- ─── المعاهد ───
create table if not exists institutes (
  id uuid primary key default uuid_generate_v4(),
  slug text unique not null, name text not null, type text default 'حكومي',
  city text default '', specialties text[] default '{}', overview text default '',
  min_rate numeric(6,2), is_active boolean default true, sort_order int default 1000,
  created_at timestamptz default now()
);

-- ─── الأخبار ───
create table if not exists news (
  id uuid primary key default uuid_generate_v4(),
  category text default 'خبر', icon text default 'news', title text not null,
  body text default '', color text default 'var(--blue-soft)',
  is_active boolean default true, sort_order int default 1000,
  created_at timestamptz default now()
);

-- ─── المكتبة ───
create table if not exists library (
  id uuid primary key default uuid_generate_v4(),
  title text not null, file_type text default 'تقرير', college_name text default '',
  stage text default '', size_kb int default 0, file_url text default '#',
  is_active boolean default true, created_at timestamptz default now()
);

-- ─── مستخدمو الأدمن ───
create table if not exists admin_users (
  id uuid primary key default uuid_generate_v4(),
  username text unique not null, password_hash text not null,
  display_name text default '', role text default 'admin' check (role in ('admin','editor')),
  last_login timestamptz, is_active boolean default true, created_at timestamptz default now()
);

-- ═══ الإحصائيات (خفيفة — عدّادات يومية مُجمّعة) ═══
create table if not exists stats_daily (
  day date primary key default current_date,
  visits bigint default 0, unique_visits bigint default 0,
  simulations bigint default 0, prints bigint default 0,
  updated_at timestamptz default now()
);
create table if not exists stats_visitors (
  visitor_hash text primary key,
  first_seen timestamptz default now(), last_seen timestamptz default now(),
  visit_count int default 1
);
create index if not exists idx_visitor_last on stats_visitors(last_seen desc);

create or replace function track_event(p_event text, p_hash text default null)
returns void as $$
declare is_new boolean := false;
begin
  if p_hash is not null then
    insert into stats_visitors(visitor_hash, visit_count) values (p_hash, 1)
    on conflict (visitor_hash) do update set last_seen=now(), visit_count=stats_visitors.visit_count+1;
    select first_seen::date = current_date into is_new from stats_visitors where visitor_hash=p_hash;
  end if;
  insert into stats_daily(day, visits, unique_visits, simulations, prints)
  values (current_date,
    case when p_event='visit' then 1 else 0 end,
    case when is_new then 1 else 0 end,
    case when p_event='simulation' then 1 else 0 end,
    case when p_event='print' then 1 else 0 end)
  on conflict (day) do update set
    visits=stats_daily.visits+(case when p_event='visit' then 1 else 0 end),
    unique_visits=stats_daily.unique_visits+(case when is_new then 1 else 0 end),
    simulations=stats_daily.simulations+(case when p_event='simulation' then 1 else 0 end),
    prints=stats_daily.prints+(case when p_event='print' then 1 else 0 end),
    updated_at=now();
end;
$$ language plpgsql;

-- ─── تحديث تلقائي ───
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;
drop trigger if exists trg_uni_touch on universities;
create trigger trg_uni_touch before update on universities for each row execute function touch_updated_at();
drop trigger if exists trg_dept_touch on departments;
create trigger trg_dept_touch before update on departments for each row execute function touch_updated_at();

-- ─── عرض الأقسام الكامل ───
create or replace view v_departments_full as
select d.id, d.slug, d.name, d.branch, d.study_years, d.degree,
  d.overview, d.what_you_study, d.career_paths, d.tags, d.study_type, d.annual_fee,
  d.is_active, d.sort_order,
  c.id as college_id, c.name as college_name, c.icon as college_icon,
  u.id as university_id, u.name as university_name,
  u.type as university_type, u.city as university_city, u.slug as university_slug,
  (select min_rate from admission_rates ar where ar.department_id=d.id order by year desc limit 1) as last_rate,
  (select year from admission_rates ar where ar.department_id=d.id order by year desc limit 1) as last_year
from departments d
join colleges c on c.id=d.college_id
join universities u on u.id=c.university_id
where d.is_active and u.is_active;

-- ─── RLS: قراءة عامة، كتابة عبر الخادم ───
alter table universities enable row level security;
alter table colleges enable row level security;
alter table departments enable row level security;
alter table admission_rates enable row level security;
alter table institutes enable row level security;
alter table news enable row level security;
alter table library enable row level security;
do $$ begin
  execute 'create policy p_read_uni on universities for select using (true)';
  execute 'create policy p_read_col on colleges for select using (true)';
  execute 'create policy p_read_dept on departments for select using (true)';
  execute 'create policy p_read_rate on admission_rates for select using (true)';
  execute 'create policy p_read_inst on institutes for select using (true)';
  execute 'create policy p_read_news on news for select using (true)';
  execute 'create policy p_read_lib on library for select using (true)';
exception when duplicate_object then null; end $$;

-- ═══ البنرات (السلايدر في الصفحة الرئيسية) ═══
create table if not exists banners (
  id uuid primary key default uuid_generate_v4(),
  title text not null, subtitle text default '', tag text default '',
  icon text default 'megaphone', gradient text default 's1',
  link text default '', is_active boolean default true, sort_order int default 1000,
  created_at timestamptz default now()
);

-- ═══ الخدمات السريعة (أزرار الرئيسية) ═══
create table if not exists quick_links (
  id uuid primary key default uuid_generate_v4(),
  label text not null, icon text default 'cap', target text default 'depts',
  color text default 'b', is_active boolean default true, sort_order int default 1000
);

-- ═══ إعدادات عامة (اسم الموقع، الروابط، نصوص…) ═══
create table if not exists site_settings (
  key text primary key, value text default '', updated_at timestamptz default now()
);

alter table banners enable row level security;
alter table quick_links enable row level security;
alter table site_settings enable row level security;
do $$ begin
  execute 'create policy p_read_ban on banners for select using (true)';
  execute 'create policy p_read_ql on quick_links for select using (true)';
  execute 'create policy p_read_ss on site_settings for select using (true)';
exception when duplicate_object then null; end $$;
