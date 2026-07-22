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

async function seedLocalData(db, seedData) {
  for (const uni of seedData.universities) {
    const { data: eUni } = await db.from('universities').select('id').eq('name', uni.name).single();
    let uniId = eUni?.id;
    if (!uniId) {
      const { data } = await db.from('universities').insert({ name: uni.name, type: uni.type, city: uni.city, is_active: true }).select().single();
      uniId = data?.id;
    }
    if (!uniId) continue;
    
    const colleges = seedData.colleges.filter(c => c.university === uni.slug);
    for (const col of colleges) {
      const { data: eCol } = await db.from('colleges').select('id').eq('university_id', uniId).eq('name', col.name).single();
      let colId = eCol?.id;
      if (!colId) {
        const { data } = await db.from('colleges').insert({ university_id: uniId, name: col.name }).select().single();
        colId = data?.id;
      }
      if (!colId) continue;
      
      const depts = seedData.departments.filter(d => d.college === `${uni.slug}/${col.slug}`);
      for (const dept of depts) {
        const { data: eDept } = await db.from('departments').select('id').eq('college_id', colId).eq('name', dept.name).eq('branch', dept.branch).single();
        if (!eDept) {
          await db.from('departments').insert({ college_id: colId, name: dept.name, branch: dept.branch, study_years: dept.study_years || 4, tuition_fee: dept.tuition_fee || 0 });
        }
      }
    }
  }
  console.log('✅ Supabase seeding complete!');
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
  // الأخبار — تدعم الصيغة القديمة (مصفوفة) والجديدة (كائن)
  const news = (seed.news || []).map((n, i) => {
    if (Array.isArray(n)) return { id: `n-${i}`, icon: n[0], category: n[1], color: n[2], title: n[4], body: n[5], is_active: true };
    return { id: n.id || `n-${i}`, is_active: true, ...n };
  });
  const library = seed.library.map((l, i) => ({ id: `l-${i}`, ...l, downloads: 0 }));
  const banners = (seed.banners || []).map((b, i) => ({ id: b.id || `b-${i}`, is_active: true, ...b }));
  const quick_links = (seed.quick_links || []).map((q, i) => ({ id: q.id || `q-${i}`, is_active: true, ...q }));
  const settings = seed.settings || {};

  return { universities, colleges, departments, institutes, news, library, banners, quick_links, settings };
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

  // ── الكليات ──
  async colleges({ universityId } = {}) {
    if (usingSupabase) {
      let q = supabase.from('colleges').select('*').order('sort_order');
      if (universityId) q = q.eq('university_id', universityId);
      const { data } = await q;
      return data || [];
    }
    let list = local.colleges;
    if (universityId) list = list.filter(c => c.university_id === universityId);
    return list;
  },
  async collegesOf(universityId) {
    return this.colleges({ universityId });
  },

  // ── الأقسام ──
  async departments({ branch, q, uniType } = {}) {
    let list;
    if (usingSupabase) {
      let query = supabase.from('v_departments_full').select('*').order('sort_order');
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
      const { data } = await supabase.from('news').select('*').eq('is_active', true).order('sort_order');
      return data || [];
    }
    return (local.news || []).filter(n => n.is_active !== false);
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
      const { data } = await supabaseAdmin.from('admin_users').select('*').eq('username', username).single();
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

  // ── إدارة الكليات ──
  async createCollege(payload) {
    if (usingSupabase) {
      const { data, error } = await supabaseAdmin.from('colleges').insert(payload).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    const c = { id: 'c-new-' + Date.now(), sort_order: 1000, ...payload };
    local.colleges.push(c); return c;
  },
  async updateCollege(id, patch) {
    if (usingSupabase) {
      const { data, error } = await supabaseAdmin.from('colleges').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    const c = local.colleges.find(x => x.id === id);
    if (c) Object.assign(c, patch);
    return c;
  },
  async deleteCollege(id) {
    if (usingSupabase) {
      const { error } = await supabaseAdmin.from('colleges').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return true;
    }
    const i = local.colleges.findIndex(x => x.id === id);
    if (i >= 0) local.colleges.splice(i, 1);
    return true;
  },
  async reorderColleges(orderedIds) {
    if (usingSupabase) {
      for (let i = 0; i < orderedIds.length; i++)
        await supabaseAdmin.from('colleges').update({ sort_order: i }).eq('id', orderedIds[i]);
      return true;
    }
    orderedIds.forEach((id, i) => {
      const c = local.colleges.find(x => x.id === id);
      if (c) c.sort_order = i;
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
  async reorderDepartments(orderedIds) {
    if (usingSupabase) {
      for (let i = 0; i < orderedIds.length; i++)
        await supabaseAdmin.from('departments').update({ sort_order: i }).eq('id', orderedIds[i]);
      return true;
    }
    orderedIds.forEach((id, i) => {
      const d = local.departments.find(x => x.id === id);
      if (d) d.sort_order = i;
    });
    return true;
  },

  // ── الاستيراد الشامل من Excel ──
  async importTSV(tsv) {
    const rows = tsv.split('\n').map(r => r.split('\t').map(c => c.trim())).filter(r => r.length > 1 && r.join(''));
    // Expected format: University, College, Department, Branch, Rate, Fee, Years
    if (rows.length > 0 && rows[0][0] && rows[0][0].includes('الجامعة')) rows.shift(); // skip header

    let inserted = 0;
    for (const row of rows) {
      let [uniName, colName, deptName, branch, minRate, fee, years] = row;
      if (!uniName || !deptName) continue;
      
      minRate = parseFloat(minRate) || 0;
      fee = fee ? parseInt(fee.replace(/\D/g, '')) : 0;
      years = parseInt(years) || 4;
      branch = branch || 'علمي';
      colName = colName || '';

      if (usingSupabase) {
        // 1. Get or Create University
        let { data: uni } = await supabaseAdmin.from('universities').select('id').eq('name', uniName).eq('type', 'أهلية').single();
        if (!uni) {
          const res = await supabaseAdmin.from('universities').insert({ name: uniName, type: 'أهلية' }).select().single();
          uni = res.data;
        }
        // 2. Get or Create College
        let { data: col } = await supabaseAdmin.from('colleges').select('id').eq('university_id', uni.id).eq('name', colName).single();
        if (!col) {
          const res = await supabaseAdmin.from('colleges').insert({ university_id: uni.id, name: colName }).select().single();
          col = res.data;
        }
        // 3. Get or Create Department
        let { data: dept } = await supabaseAdmin.from('departments').select('id').eq('college_id', col.id).eq('name', deptName).eq('branch', branch).single();
        if (!dept) {
          const res = await supabaseAdmin.from('departments').insert({ college_id: col.id, name: deptName, branch: branch, study_years: years, tuition_fee: fee }).select().single();
          dept = res.data;
        } else {
          await supabaseAdmin.from('departments').update({ tuition_fee: fee, study_years: years }).eq('id', dept.id);
        }
        // 4. Upsert Admission Rate for 2025
        if (minRate > 0) {
           await supabaseAdmin.from('admission_rates').upsert({ department_id: dept.id, year: 2025, branch: branch, min_rate: minRate }, { onConflict: 'department_id, year, branch' });
        }
        inserted++;
      }
    }
    return { success: true, count: inserted };
  },

  // ── تعديل الحد الأدنى للقبول ──
  async setAdmissionRate(departmentId, { year = 2025, branch = 'علمي', min_rate }) {
    if (usingSupabase) {
      const { data, error } = await supabaseAdmin.from('admission_rates').upsert(
        { department_id: departmentId, year, branch, min_rate },
        { onConflict: 'department_id, year, branch' }
      ).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    const r = local.admission_rates.find(x => x.department_id === departmentId && x.year === year && x.branch === branch);
    if (r) { r.min_rate = min_rate; return r; }
    const nr = { id: 'r-new-' + Date.now(), department_id: departmentId, year, branch, min_rate };
    local.admission_rates.push(nr); return nr;
  },

  async forceSeed() {
    if (!usingSupabase) return { msg: 'Not using Supabase' };
    await seedLocalData(supabaseAdmin, seed);
    return { success: true };
  },

  async getHistoricalRates(departmentId) {
    if (usingSupabase) {
      const { data, error } = await supabase.from('admission_rates')
        .select('*').eq('department_id', departmentId).order('year', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    }
    return local.admission_rates.filter(x => x.department_id === departmentId).sort((a, b) => b.year - a.year);
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
  async updateNews(id, patch) {
    if (usingSupabase) {
      const { data, error } = await supabaseAdmin.from('news').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message); return data;
    }
    const n = (local.news || []).find(x => x.id === id); if (n) Object.assign(n, patch); return n;
  },

  // ═══════════ البنرات (السلايدر) ═══════════
  async banners() {
    if (usingSupabase) {
      const { data } = await supabase.from('banners').select('*').eq('is_active', true).order('sort_order');
      return data || [];
    }
    return (local.banners || []).filter(b => b.is_active !== false);
  },
  async createBanner(payload) {
    if (usingSupabase) {
      const { data, error } = await supabaseAdmin.from('banners').insert(payload).select().single();
      if (error) throw new Error(error.message); return data;
    }
    const b = { id: 'b-' + Date.now(), is_active: true, sort_order: (local.banners||[]).length, ...payload };
    (local.banners = local.banners || []).push(b); return b;
  },
  async updateBanner(id, patch) {
    if (usingSupabase) {
      const { data, error } = await supabaseAdmin.from('banners').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message); return data;
    }
    const b = (local.banners || []).find(x => x.id === id); if (b) Object.assign(b, patch); return b;
  },
  async deleteBanner(id) {
    if (usingSupabase) { await supabaseAdmin.from('banners').delete().eq('id', id); return true; }
    const i = (local.banners || []).findIndex(x => x.id === id); if (i >= 0) local.banners.splice(i, 1); return true;
  },

  // ═══════════ الخدمات السريعة ═══════════
  async quickLinks() {
    if (usingSupabase) {
      const { data } = await supabase.from('quick_links').select('*').eq('is_active', true).order('sort_order');
      return data || [];
    }
    return (local.quick_links || []).filter(q => q.is_active !== false);
  },
  async updateQuickLink(id, patch) {
    if (usingSupabase) {
      const { data, error } = await supabaseAdmin.from('quick_links').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message); return data;
    }
    const q = (local.quick_links || []).find(x => x.id === id); if (q) Object.assign(q, patch); return q;
  },

  // ═══════════ الإعدادات العامة ═══════════
  async settings() {
    if (usingSupabase) {
      const { data } = await supabase.from('site_settings').select('*');
      return Object.fromEntries((data || []).map(r => [r.key, r.value]));
    }
    return local.settings || {};
  },
  async updateSettings(patch) {
    if (usingSupabase) {
      const rows = Object.entries(patch).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
      await supabaseAdmin.from('site_settings').upsert(rows, { onConflict: 'key' });
      return this.settings();
    }
    local.settings = { ...(local.settings || {}), ...patch }; return local.settings;
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
