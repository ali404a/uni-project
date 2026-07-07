// ═══════════════════════════════════════════════════════════════
//  رفع البيانات الأولية إلى Supabase — يُشغّل مرة واحدة بعد إنشاء الجداول.
//  الاستخدام:
//    node server/db/seed-supabase.js
//  (تأكد من ضبط SUPABASE_URL و SUPABASE_SERVICE_KEY في .env)
// ═══════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(__dirname, '../../data/seed.json'), 'utf8'));

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
if (!URL || !KEY) { console.error('❌ ضع SUPABASE_URL و SUPABASE_SERVICE_KEY في .env'); process.exit(1); }
const db = createClient(URL, KEY);

async function run() {
  console.log('🚀 بدء رفع البيانات...');

  // 1) الجامعات
  const uniRows = seed.universities.map((u, i) => ({
    slug: u.slug, name: u.name, type: u.type, city: u.city || '',
    established: u.established || null, website: u.website || '',
    description: u.description || '', sort_order: u.type === 'أهلية' ? i : 1000,
  }));
  const { data: unis, error: e1 } = await db.from('universities').upsert(uniRows, { onConflict: 'slug' }).select();
  if (e1) throw e1;
  const uniBySlug = Object.fromEntries(unis.map(u => [u.slug, u.id]));
  console.log(`✅ جامعات: ${unis.length}`);

  // 2) الكليات
  const colRows = seed.colleges.map(c => ({
    university_id: uniBySlug[c.university], slug: c.slug, name: c.name, icon: c.icon || '',
  })).filter(c => c.university_id);
  const { data: cols, error: e2 } = await db.from('colleges').upsert(colRows, { onConflict: 'university_id,slug' }).select();
  if (e2) throw e2;
  // مفتاح: university_slug/college_slug → college_id
  const colKey = {};
  for (const c of cols) {
    const uSlug = unis.find(u => u.id === c.university_id)?.slug;
    colKey[`${uSlug}/${c.slug}`] = c.id;
  }
  console.log(`✅ كليات: ${cols.length}`);

  // 3) الأقسام
  const deptRows = seed.departments.map(d => {
    const cid = colKey[d.college];
    if (!cid) return null;
    return {
      college_id: cid, slug: d.slug, name: d.name, branch: d.branch,
      study_years: d.study_years || 4, degree: d.degree || '', overview: d.overview || '',
      what_you_study: d.what_you_study || '', career_paths: d.career_paths || '',
      tags: d.tags || [], study_type: d.study_type || 'حكومي', annual_fee: d.annual_fee || null,
    };
  }).filter(Boolean);
  // رفع على دفعات (500 صف)
  const deptIds = {};
  for (let i = 0; i < deptRows.length; i += 500) {
    const batch = deptRows.slice(i, i + 500);
    const { data, error } = await db.from('departments').upsert(batch, { onConflict: 'college_id,slug' }).select();
    if (error) throw error;
    data.forEach(d => { deptIds[`${d.college_id}/${d.slug}`] = d.id; });
  }
  console.log(`✅ أقسام: ${deptRows.length}`);

  // 4) المعدلات
  const rateRows = [];
  for (const r of seed.admission_rates) {
    // r.dept = uni_slug/col_slug/dept_slug
    const parts = r.dept.split('/');
    const cid = colKey[`${parts[0]}/${parts[1]}`];
    if (!cid) continue;
    const did = deptIds[`${cid}/${parts[2]}`];
    if (!did) continue;
    rateRows.push({ department_id: did, year: r.year, branch: r.branch, min_rate: r.min_rate });
  }
  for (let i = 0; i < rateRows.length; i += 500) {
    const { error } = await db.from('admission_rates').upsert(rateRows.slice(i, i + 500), { onConflict: 'department_id,year,branch' });
    if (error) throw error;
  }
  console.log(`✅ معدلات: ${rateRows.length}`);

  // 5) المعاهد
  const instRates = Object.fromEntries((seed.institute_rates || []).map(r => [r.inst, r.min_rate]));
  const instRows = seed.institutes.map(x => ({
    slug: x.slug, name: x.name, type: x.type || 'حكومي', city: x.city || '',
    specialties: x.specialties || [], overview: x.overview || '', min_rate: instRates[x.slug] || null,
  }));
  const { error: e5 } = await db.from('institutes').upsert(instRows, { onConflict: 'slug' });
  if (e5) throw e5;
  console.log(`✅ معاهد: ${instRows.length}`);

  // 6) الأخبار والمكتبة
  if (seed.news?.length) {
    const newsRows = seed.news.map((n, i) => Array.isArray(n)
      ? { category: n[1] || 'خبر', icon: n[0] || 'news', title: n[4] || '', body: n[5] || '', color: n[2] || '', sort_order: i }
      : { category: n.category || 'خبر', icon: n.icon || 'news', title: n.title || '', body: n.body || '', color: n.color || '', sort_order: i })
      .filter(n => n.title);
    await db.from('news').insert(newsRows).then(({ error }) => error && console.warn('أخبار:', error.message));
    console.log(`✅ أخبار: ${newsRows.length}`);
  }

  // 7) البنرات (السلايدر)
  if (seed.banners?.length) {
    const banRows = seed.banners.map((b, i) => ({
      title: b.title, subtitle: b.subtitle || '', tag: b.tag || '',
      icon: b.icon || 'megaphone', gradient: b.gradient || 's1', link: b.link || '', sort_order: i,
    }));
    await db.from('banners').insert(banRows).then(({ error }) => error && console.warn('بنرات:', error.message));
    console.log(`✅ بنرات: ${banRows.length}`);
  }

  // 8) الخدمات السريعة
  if (seed.quick_links?.length) {
    const qlRows = seed.quick_links.map((q, i) => ({
      label: q.label, icon: q.icon || 'cap', target: q.target || 'depts', color: q.color || 'b', sort_order: i,
    }));
    await db.from('quick_links').insert(qlRows).then(({ error }) => error && console.warn('خدمات:', error.message));
    console.log(`✅ خدمات سريعة: ${qlRows.length}`);
  }

  // 9) الإعدادات العامة
  if (seed.settings) {
    const setRows = Object.entries(seed.settings).map(([key, value]) => ({ key, value: String(value) }));
    await db.from('site_settings').upsert(setRows, { onConflict: 'key' }).then(({ error }) => error && console.warn('إعدادات:', error.message));
    console.log(`✅ إعدادات: ${setRows.length}`);
  }

  // 10) مستخدم الأدمن الافتراضي
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'darb2026', 10);
  await db.from('admin_users').upsert({
    username: 'admin', password_hash: hash, display_name: 'مدير النظام', role: 'admin',
  }, { onConflict: 'username' });
  console.log(`✅ أدمن: admin / ${process.env.ADMIN_PASSWORD || 'darb2026'}`);

  console.log('\n🎉 اكتمل رفع كل البيانات بنجاح!');
}

run().catch(e => { console.error('❌ خطأ:', e.message); process.exit(1); });
