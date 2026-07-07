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
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;
export const usingSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

let supabase = null;      // قراءة عامة
let supabaseAdmin = null; // كتابة إدارية (يتجاوز RLS)
if (usingSupabase) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  supabaseAdmin = SUPABASE_SERVICE ? createClient(SUPABASE_URL, SUPABASE_SERVICE) : supabase;
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

  // ═══════════ الأدمن ═══════════
  async adminByUsername(username) {
    if (usingSupabase) {
      const { data } = await supabase.from('admin_users').select('*').eq('username', username).single();
      return data;
    }
    // محلياً: أدمن افتراضي للتجربة (admin / darb2026)
    if (username === 'admin') {
      return {
        id: 'local-admin', username: 'admin', role: 'admin', is_active: true,
        display_name: 'مدير النظام',
        // bcrypt hash لـ "darb2026"
        password_hash: '$2b$10$diMVyoMvxmZvKbJQDSWLbuxKEasro7wV3pjhDcFGZ.HKL31QLJVNS',
      };
    }
    return null;
  },
  async touchAdminLogin(id) {
    if (usingSupabase) await supabaseAdmin.from('admin_users').update({ last_login: new Date().toISOString() }).eq('id', id);
  },

  // ── إدارة الجامعات ──
  async createUniversity(payload) {
    if (usingSupabase) {
      const { data, error } = await supabaseAdmin.from('universities').insert(payload).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    const u = { id: 'u-new-' + Date.now(), is_active: true, ...payload };
    local.universities.push(u); return u;
  },
  async updateUniversity(id, patch) {
    if (usingSupabase) {
      const { data, error } = await supabaseAdmin.from('universities').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    const u = local.universities.find(x => x.id === id);
    if (u) Object.assign(u, patch);
    return u;
  },
  async deleteUniversity(id) {
    if (usingSupabase) {
      const { error } = await supabaseAdmin.from('universities').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return true;
    }
    const i = local.universities.findIndex(x => x.id === id);
    if (i >= 0) local.universities.splice(i, 1);
    return true;
  },
  // ترتيب الجامعات الأهلية
  async reorderUniversities(orderedIds) {
    if (usingSupabase) {
      for (let i = 0; i < orderedIds.length; i++)
        await supabaseAdmin.from('universities').update({ sort_order: i }).eq('id', orderedIds[i]);
      return true;
    }
    orderedIds.forEach((id, i) => {
      const u = local.universities.find(x => x.id === id);
      if (u) u.sort_order = i;
    });
    return true;
  },

  // ── إدارة الأقسام ──
  async createDepartment(payload) {
    if (usingSupabase) {
      const { data, error } = await supabaseAdmin.from('departments').insert(payload).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    const d = { id: 'd-new-' + Date.now(), is_active: true, ...payload };
    local.departments.push(d); return d;
  },
  async updateDepartment(id, patch) {
    if (usingSupabase) {
      const { data, error } = await supabaseAdmin.from('departments').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    const d = local.departments.find(x => x.id === id);
    if (d) Object.assign(d, patch);
    return d;
  },
  async deleteDepartment(id) {
    if (usingSupabase) {
      const { error } = await supabaseAdmin.from('departments').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return true;
    }
    const i = local.departments.findIndex(x => x.id === id);
    if (i >= 0) local.departments.splice(i, 1);
    return true;
  },

  // ── تعديل الحد الأدنى للقبول ──
  async setAdmissionRate(departmentId, { year = 2025, branch = 'علمي', min_rate }) {
    if (usingSupabase) {
      const { data, error } = await supabase.from('admission_rates')
        .upsert({ department_id: departmentId, year, branch, min_rate }, { onConflict: 'department_id,year,branch' })
        .select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    const d = local.departments.find(x => x.id === departmentId);
    if (d) { d.last_rate = min_rate; d.rates = [{ year, branch, min_rate }]; }
    return d;
  },

  // ── تعديل رسوم القسم الأهلي ──
  async setDepartmentFee(id, annual_fee) {
    return this.updateDepartment(id, { annual_fee });
  },

  // ── إدارة الأخبار والمكتبة ──
  async createNews(payload) {
    if (usingSupabase) {
      const { data, error } = await supabaseAdmin.from('news').insert(payload).select().single();
      if (error) throw new Error(error.message); return data;
    }
    const n = { id: 'n-' + Date.now(), is_active: true, ...payload };
    (local.news = local.news || []).unshift(n); return n;
  },
  async deleteNews(id) {
    if (usingSupabase) { await supabaseAdmin.from('news').delete().eq('id', id); return true; }
    const i = (local.news || []).findIndex(x => x.id === id); if (i >= 0) local.news.splice(i, 1); return true;
  },

  // ═══════════ الإحصائيات ═══════════
  async trackEvent(event, hash = null) {
    if (usingSupabase) {
      try { await supabase.rpc('track_event', { p_event: event, p_hash: hash }); } catch {}
      return;
    }
    // محلياً: عدّاد في الذاكرة
    _localStats.total[event] = (_localStats.total[event] || 0) + 1;
    if (hash && !_localStats.visitors.has(hash)) {
      _localStats.visitors.add(hash);
      _localStats.total.unique_visits = (_localStats.total.unique_visits || 0) + 1;
    }
  },
  async statsSummary() {
    if (usingSupabase) {
      const { data: totals } = await supabase.from('stats_daily').select('*');
      const { count: uniqueCount } = await supabase.from('stats_visitors').select('*', { count: 'exact', head: true });
      const sum = (totals || []).reduce((a, r) => ({
        visits: a.visits + (r.visits || 0),
        simulations: a.simulations + (r.simulations || 0),
        prints: a.prints + (r.prints || 0),
      }), { visits: 0, simulations: 0, prints: 0 });
      // آخر 14 يوماً للرسم البياني
      const recent = (totals || [])
        .sort((a, b) => new Date(b.day) - new Date(a.day)).slice(0, 14).reverse()
        .map(r => ({ day: r.day, visits: r.visits || 0, simulations: r.simulations || 0 }));
      return { ...sum, unique_visitors: uniqueCount || 0, daily: recent };
    }
    return {
      visits: _localStats.total.visit || 0,
      simulations: _localStats.total.simulation || 0,
      prints: _localStats.total.print || 0,
      unique_visitors: _localStats.total.unique_visits || 0,
      daily: _localStats.daily,
    };
  },
};

// عدّاد إحصائيات محلي (للتجربة بلا Supabase)
const _localStats = {
  total: { visit: 0, simulation: 0, print: 0, unique_visits: 0 },
  visitors: new Set(),
  daily: (() => {
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days.push({ day: d.toISOString().slice(0, 10), visits: Math.floor(Math.random() * 40 + 10), simulations: Math.floor(Math.random() * 15 + 2) });
    }
    return days;
  })(),
};
