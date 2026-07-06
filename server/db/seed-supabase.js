// رفع البيانات الأولية إلى Supabase — يُشغّل مرة واحدة بعد إنشاء الجداول.
// الاستخدام:  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npm run seed
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(__dirname, '../../data/seed.json'), 'utf8'));

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !key) { console.error('❌ ضع SUPABASE_URL و SUPABASE_SERVICE_KEY'); process.exit(1); }
const db = createClient(url, key);

async function run() {
  console.log('⬆️  رفع الجامعات...');
  const { data: unis } = await db.from('universities')
    .upsert(seed.universities.map((u, i) => ({ ...u, sort_order: i })), { onConflict: 'slug' })
    .select();
  const uBySlug = Object.fromEntries(unis.map(u => [u.slug, u]));

  console.log('⬆️  رفع الكليات...');
  const collegeRows = seed.colleges.map((c, i) => ({
    university_id: uBySlug[c.university].id, name: c.name, slug: c.slug, icon: c.icon, sort_order: i,
  }));
  const { data: cols } = await db.from('colleges').upsert(collegeRows, { onConflict: 'university_id,slug' }).select();
  const cByKey = {};
  cols.forEach(c => {
    const uni = unis.find(u => u.id === c.university_id);
    cByKey[`${uni.slug}/${c.slug}`] = c;
  });

  console.log('⬆️  رفع الأقسام...');
  const deptRows = seed.departments.map((d, i) => {
    const col = cByKey[d.college];
    return {
      college_id: col.id, name: d.name, slug: d.slug, branch: d.branch,
      study_years: d.study_years, degree: d.degree, overview: d.overview,
      what_you_study: d.what_you_study, career_paths: d.career_paths,
      tags: d.tags, sort_order: i,
    };
  });
  const { data: depts } = await db.from('departments').upsert(deptRows, { onConflict: 'college_id,slug' }).select();
  const dByKey = {};
  depts.forEach(d => {
    const col = cols.find(c => c.id === d.college_id);
    const uni = unis.find(u => u.id === col.university_id);
    dByKey[`${uni.slug}/${col.slug}/${d.slug}`] = d;
  });

  console.log('⬆️  رفع المعاهد...');
  await db.from('institutes').upsert(seed.institutes, { onConflict: 'slug' });

  console.log('⬆️  رفع معدلات القبول...');
  const rateRows = seed.admission_rates.map(r => ({
    department_id: dByKey[r.dept]?.id, year: r.year, branch: r.branch, min_rate: r.min_rate,
  })).filter(r => r.department_id);
  await db.from('admission_rates').insert(rateRows);

  console.log('⬆️  رفع الأخبار...');
  await db.from('news').upsert(seed.news, { onConflict: 'slug' });

  console.log('⬆️  رفع المكتبة...');
  await db.from('library_files').insert(seed.library.map(l => ({ ...l, file_url: '#' })));

  console.log('✅ اكتمل رفع جميع البيانات.');
}
run().catch(e => { console.error(e); process.exit(1); });
