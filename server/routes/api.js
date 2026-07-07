import { Router } from 'express';
import { store, usingSupabase } from '../db/store.js';
import { rankDepartments, analyzeWishlist, chanceLevel, expectedRange, compareByAverage, compareInstitutes } from '../engine.js';

const r = Router();

// حالة النظام
r.get('/health', (_req, res) => res.json({ ok: true, source: usingSupabase ? 'supabase' : 'local' }));

// ── الجامعات ──
r.get('/universities', async (req, res) => res.json(await store.universities({ type: req.query.type })));
r.get('/universities/:slug', async (req, res) => {
  const uni = await store.universityBySlug(req.params.slug);
  if (!uni) return res.status(404).json({ error: 'الجامعة غير موجودة' });
  uni.colleges = await store.collegesOf(uni.id);
  res.json(uni);
});

// ── الكليات ──
r.get('/colleges', async (req, res) => res.json(await store.colleges({ universityId: req.query.universityId })));

// ── الأقسام ──
// ── الأقسام مجمّعة حسب التخصص (اسم القسم) ──
r.get('/departments/grouped', async (req, res) => {
  const { branch, uniType } = req.query;
  const list = await store.departments({ branch, uniType });
  const groups = new Map();
  for (const d of list) {
    const key = d.name;
    if (!groups.has(key)) {
      groups.set(key, {
        name: d.name, branch: d.branch, study_years: d.study_years,
        college_name: d.college_name, count: 0,
        min_rate: null, max_rate: null, offerings: [],
      });
    }
    const g = groups.get(key);
    g.count++;
    g.offerings.push({
      id: d.id, university_name: d.university_name, university_id: d.university_id,
      college_name: d.college_name, last_rate: d.last_rate, last_year: d.last_year,
      annual_fee: d.annual_fee ?? null, study_type: d.study_type,
    });
    if (d.last_rate != null) {
      g.min_rate = g.min_rate == null ? d.last_rate : Math.min(g.min_rate, d.last_rate);
      g.max_rate = g.max_rate == null ? d.last_rate : Math.max(g.max_rate, d.last_rate);
    }
  }
  // ترتيب العروض داخل كل تخصص حسب المعدل تنازلياً
  const out = [...groups.values()].map(g => {
    g.offerings.sort((a, b) => (b.last_rate ?? 0) - (a.last_rate ?? 0));
    return g;
  });
  // ترتيب التخصصات حسب أعلى معدل
  out.sort((a, b) => (b.max_rate ?? 0) - (a.max_rate ?? 0));
  res.json(out);
});

r.get('/departments', async (req, res) => {
  const { branch, q, uniType } = req.query;
  res.json(await store.departments({ branch, q, uniType }));
});
r.get('/departments/:id', async (req, res) => {
  const d = await store.departmentById(req.params.id);
  if (!d) return res.status(404).json({ error: 'القسم غير موجود' });
  d.range = expectedRange(d.last_rate);
  res.json(d);
});

// ── المعاهد ──
r.get('/institutes', async (_req, res) => res.json(await store.institutes()));

// ── الأخبار ──
r.get('/news', async (req, res) => res.json(await store.news({ featured: req.query.featured === '1' })));

// ── المكتبة ──
r.get('/library', async (_req, res) => res.json(await store.library()));
r.get('/banners', async (_req, res) => res.json(await store.banners()));
r.get('/quick-links', async (_req, res) => res.json(await store.quickLinks()));
r.get('/settings', async (_req, res) => res.json(await store.settings()));

// ── محرك التخصصات ──
r.post('/engine/match', async (req, res) => {
  const { avg, branch } = req.body || {};
  const n = Number(avg);
  if (!n || n < 40 || n > 100) return res.status(400).json({ error: 'أدخل معدلاً صحيحاً بين 40 و100' });
  const all = await store.departments({});
  const ranked = rankDepartments(all, { avg: n, branch });
  res.json({ avg: n, branch, count: ranked.length, departments: ranked.slice(0, 50) });
});

// ── المقارنة: أقسام قريبة + معاهد قريبة من المعدل ──
r.post('/compare', async (req, res) => {
  const { name, avg, total, round, branch } = req.body || {};
  const n = Number(avg);
  if (!n || n < 40 || n > 100) return res.status(400).json({ error: 'أدخل معدلاً صحيحاً بين 40 و100' });
  const allDepts = await store.departments({});
  const allInst = await store.institutes();
  const departments = compareByAverage(allDepts, { avg: n, branch }, 40);
  const institutes = compareInstitutes(allInst, n, 10);
  res.json({
    student: { name: name || 'الطالب', avg: n, total: total || null, round: round || 'الأول', branch: branch || '' },
    generated_at: new Date().toISOString(),
    departments, institutes,
    counts: { departments: departments.length, institutes: institutes.length },
  });
});

// ── محاكاة التقديم ──
r.post('/simulate', async (req, res) => {
  const { avg, wishes } = req.body || {};
  const n = Number(avg);
  if (!n || !Array.isArray(wishes) || !wishes.length)
    return res.status(400).json({ error: 'أرسل المعدل وقائمة الرغبات' });
  res.json(analyzeWishlist(wishes, n));
});

// ── التواصل ──
r.post('/contact', async (req, res) => {
  const { name, contact, kind, message } = req.body || {};
  if (!message || message.trim().length < 3)
    return res.status(400).json({ error: 'الرجاء كتابة رسالة واضحة' });
  const saved = await store.addContact({ name, contact, kind: kind || 'استفسار', message });
  res.status(201).json({ ok: true, id: saved.id });
});

// ═══════════ الإحصائيات (تتبّع خفيف) ═══════════
import crypto from 'crypto';
// تتبّع حدث — لا يؤخّر الاستجابة (fire-and-forget)
r.post('/track', (req, res) => {
  res.json({ ok: true }); // نردّ فوراً
  try {
    const { event } = req.body || {};
    if (!['visit', 'simulation', 'print'].includes(event)) return;
    // بصمة مجهّلة من IP + user-agent (لا تُخزّن البيانات الخام)
    const raw = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '') + (req.headers['user-agent'] || '');
    const hash = crypto.createHash('sha256').update(raw + 'darb-salt').digest('hex').slice(0, 32);
    store.trackEvent(event, hash).catch(() => {}); // بلا انتظار
  } catch {}
});

// ═══════════ الأدمن ═══════════
import { login, requireAdmin } from '../auth.js';

r.post('/admin/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور' });
  const result = await login(username, password);
  if (!result) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  res.json(result);
});

r.get('/admin/me', requireAdmin, (req, res) => res.json({ admin: req.admin }));

// لوحة الإحصائيات
r.get('/admin/stats', requireAdmin, async (_req, res) => {
  res.json(await store.statsSummary());
});

// إدارة الجامعات
r.post('/admin/universities', requireAdmin, async (req, res) => {
  try { res.status(201).json(await store.createUniversity(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.patch('/admin/universities/:id', requireAdmin, async (req, res) => {
  try { res.json(await store.updateUniversity(req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.delete('/admin/universities/:id', requireAdmin, async (req, res) => {
  try { await store.deleteUniversity(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// ترتيب الجامعات الأهلية
r.post('/admin/universities/reorder', requireAdmin, async (req, res) => {
  try { await store.reorderUniversities(req.body.order || []); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// إدارة الكليات
r.post('/admin/colleges', requireAdmin, async (req, res) => {
  try { res.status(201).json(await store.createCollege(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.patch('/admin/colleges/:id', requireAdmin, async (req, res) => {
  try { res.json(await store.updateCollege(req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.delete('/admin/colleges/:id', requireAdmin, async (req, res) => {
  try { await store.deleteCollege(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.post('/admin/colleges/reorder', requireAdmin, async (req, res) => {
  try { await store.reorderColleges(req.body.order || []); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// إدارة الأقسام
r.post('/admin/departments', requireAdmin, async (req, res) => {
  try { res.status(201).json(await store.createDepartment(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.patch('/admin/departments/:id', requireAdmin, async (req, res) => {
  try { res.json(await store.updateDepartment(req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.delete('/admin/departments/:id', requireAdmin, async (req, res) => {
  try { await store.deleteDepartment(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// ترتيب الأقسام
r.post('/admin/departments/reorder', requireAdmin, async (req, res) => {
  try { await store.reorderDepartments(req.body.order || []); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// تعديل الحد الأدنى للقبول
r.put('/admin/departments/:id/rate', requireAdmin, async (req, res) => {
  try { res.json(await store.setAdmissionRate(req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// تعديل رسوم القسم الأهلي
r.put('/admin/departments/:id/fee', requireAdmin, async (req, res) => {
  try { res.json(await store.setDepartmentFee(req.params.id, req.body.annual_fee)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// إدارة الأخبار
r.post('/admin/news', requireAdmin, async (req, res) => {
  try { res.status(201).json(await store.createNews(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.patch('/admin/news/:id', requireAdmin, async (req, res) => {
  try { res.json(await store.updateNews(req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.delete('/admin/news/:id', requireAdmin, async (req, res) => {
  try { await store.deleteNews(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── البنرات (السلايدر) ──
r.post('/admin/banners', requireAdmin, async (req, res) => {
  try { res.status(201).json(await store.createBanner(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.patch('/admin/banners/:id', requireAdmin, async (req, res) => {
  try { res.json(await store.updateBanner(req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.delete('/admin/banners/:id', requireAdmin, async (req, res) => {
  try { await store.deleteBanner(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── الخدمات السريعة ──
r.patch('/admin/quick-links/:id', requireAdmin, async (req, res) => {
  try { res.json(await store.updateQuickLink(req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── الإعدادات العامة ──
r.put('/admin/settings', requireAdmin, async (req, res) => {
  try { res.json(await store.updateSettings(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

export default r;
