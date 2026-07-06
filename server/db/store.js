// ═══════════════════════════════════════════════════════════
//  طبقة البيانات — تعمل مع Supabase إن توفّرت المفاتيح،
//  وإلا تعود تلقائياً إلى البيانات المحلية (seed.json) في الذاكرة.
// ═══════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(__dirname, '../../data/seed.json'), 'utf8'));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
export const usingSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

let supabase = null;
if (usingSupabase) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('✅ متصل بـ Supabase');
} else {
  console.log('⚠️  لا توجد مفاتيح Supabase — يعمل النظام بالبيانات المحلية (seed.json)');
}

// ─────────── بناء نموذج محلي مترابط في الذاكرة ───────────
function buildLocalModel() {
  const universities = seed.universities.map((u, i) => ({ id: `u-${i}`, ...u, is_active: true }));
  const uBySlug = Object.fromEntries(universities.map(u => [u.slug, u]));

  const colleges = seed.colleges.map((c, i) => ({
    id: `c-${i}`, ...c,
    university_id: uBySlug[c.university]?.id,
    university_name: uBySlug[c.university]?.name,
    university_type: uBySlug[c.university]?.type,
    university_city: uBySlug[c.university]?.city,
  }));
  const cByKey = Object.fromEntries(colleges.map(c => [`${c.university}/${c.slug}`, c]));

  const departments = seed.departments.map((d, i) => {
    const col = cByKey[d.college];
    return {
      id: `d-${i}`,
      college_id: col?.id,
      college_name: col?.name,
      college_icon: col?.icon,
      university_id: col?.university_id,
      university_name: col?.university_name,
      university_type: col?.university_type,
      university_city: col?.university_city,
      is_active: true,
      ...d,
      study_type: d.study_type || 'حكومي',
      annual_fee: d.annual_fee ?? null,
    };
  });
  // مفتاح مباشر لكل قسم: college(=uni/cslug)/dept-slug — يطابق حقل dept في seed
  departments.forEach((d, i) => { d.__fullkey = `${seed.departments[i].college}/${seed.departments[i].slug}`; });

  // ربط معدلات القبول بالمفتاح المباشر (يتجنّب خطأ تكرار الأسماء)
  const rates = seed.admission_rates.map((r, i) => ({ id: `r-${i}`, ...r }));
  for (const d of departments) {
    const matched = rates.filter(r => r.dept === d.__fullkey).sort((a, b) => b.year - a.year);
    d.rates = matched;
    d.last_rate = matched[0]?.min_rate ?? null;
    d.last_year = matched[0]?.year ?? null;
  }

  // المعاهد + معدلاتها
  const instRates = Object.fromEntries((seed.institute_rates || []).map(r => [r.inst, r.min_rate]));
  const institutes = seed.institutes.map((x, i) => ({
    id: `i-${i}`, ...x, is_active: true,
    last_rate: instRates[x.slug] ?? null,
  }));
  const news = seed.news.map((n, i) => ({ id: `n-${i}`, ...n, published: true, published_at: new Date().toISOString() }));
  const library = seed.library.map((l, i) => ({ id: `l-${i}`, ...l, downloads: 0 }));

  return { universities, colleges, departments, institutes, news, library };
}

// مفتاح القسم الكامل بصيغة university/college/dept
function deptFullKey(d) {
  const uni = seed.universities.find(u => u.name === d.university_name)?.slug;
  const col = seed.colleges.find(c => c.name === d.college_name && c.university === uni)?.slug;
  return `${uni}/${col}/${d.slug}`;
}
function fullDeptKey(d, raw) { return raw.college + '/' + d.slug; }

const local = buildLocalModel();

// ═══════════════ واجهة موحّدة ═══════════════
export const store = {
  // ── الجامعات ──
  async universities({ type } = {}) {
    let list;
    if (usingSupabase) {
      let q = supabase.from('universities').select('*').eq('is_active', true).order('sort_order');
      if (type) q = q.eq('type', type);
      const { data } = await q;
      list = data || [];
    } else {
      list = local.universities;
      if (type) list = list.filter(u => u.type === type);
    }
    return list;
  },
  async universityBySlug(slug) {
    if (usingSupabase) {
      const { data } = await supabase.from('universities').select('*').eq('slug', slug).single();
      return data;
    }
    return local.universities.find(u => u.slug === slug);
  },

  // ── الكليات لجامعة ──
  async collegesOf(universityId) {
    if (usingSupabase) {
      const { data } = await supabase.from('colleges').select('*').eq('university_id', universityId);
      return data || [];
    }
    return local.colleges.filter(c => c.university_id === universityId);
  },

  // ── الأقسام ──
  async departments({ branch, q, uniType } = {}) {
    let list;
    if (usingSupabase) {
      let query = supabase.from('v_departments_full').select('*');
      if (branch) query = query.eq('branch', branch);
      if (uniType) query = query.eq('university_type', uniType);
      const { data } = await query;
      list = data || [];
    } else {
      list = local.departments;
      if (branch) list = list.filter(d => d.branch === branch);
      if (uniType) list = list.filter(d => d.university_type === uniType);
    }
    if (q) {
      const t = q.trim();
      list = list.filter(d =>
        d.name.includes(t) || (d.tags || []).some(tag => tag.includes(t)) ||
        (d.university_name || '').includes(t));
    }
    return list;
  },
  async departmentById(id) {
    if (usingSupabase) {
      const { data } = await supabase.from('v_departments_full').select('*').eq('id', id).single();
      if (data) {
        const { data: r } = await supabase.from('admission_rates')
          .select('*').eq('department_id', id).order('year', { ascending: false });
        data.rates = r || [];
      }
      return data;
    }
    return local.departments.find(d => d.id === id);
  },

  // ── المعاهد ──
  async institutes() {
    if (usingSupabase) {
      const { data } = await supabase.from('institutes').select('*').eq('is_active', true);
      return data || [];
    }
    return local.institutes;
  },

  // ── الأخبار ──
  async news({ featured } = {}) {
    if (usingSupabase) {
      let q = supabase.from('news').select('*').eq('published', true).order('published_at', { ascending: false });
      if (featured) q = q.eq('is_featured', true);
      const { data } = await q;
      return data || [];
    }
    let list = local.news;
    if (featured) list = list.filter(n => n.is_featured);
    return list;
  },

  // ── المكتبة ──
  async library() {
    if (usingSupabase) {
      const { data } = await supabase.from('library_files').select('*').order('created_at', { ascending: false });
      return data || [];
    }
    return local.library;
  },

  // ── التواصل ──
  async addContact(payload) {
    if (usingSupabase) {
      const { data } = await supabase.from('contact_messages').insert(payload).select().single();
      return data;
    }
    return { id: 'temp-' + Date.now(), ...payload, created_at: new Date().toISOString() };
  },
};
