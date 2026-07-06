# 🌌 درب التبانة الجامعي

منصة عراقية تساعد طلبة السادس الإعدادي على اختيار التخصص والجامعة المناسبة بعد إعلان النتائج.

## المميزات المبنية حالياً

- **صفحات الأقسام التفصيلية** — تعريف القسم، ماذا ستدرس، فرص العمل، سنوات الدراسة، الشهادة، معدلات القبول التاريخية، والنطاق المتوقع.
- **صفحات الجامعات التفصيلية** — الكليات، الأقسام المتوفرة، معلومات الجامعة وروابطها.
- **محرك التخصصات** — يرتّب الأقسام حسب احتمالية القبول اعتماداً على المعدل.
- **محاكاة التقديم** — تحليل ترتيب الرغبات (API جاهز).
- backend بـ **Node/Express** + **Supabase** مع طبقة احتياطية محلية تعمل بدون قاعدة بيانات.

## التشغيل محلياً

```bash
npm install
npm start          # http://localhost:3000
```

يعمل مباشرة بالبيانات المحلية (`data/seed.json`). لا حاجة لأي إعداد.

## الربط بـ Supabase

1. أنشئ مشروعاً على Supabase ونفّذ `server/db/schema.sql` في SQL Editor.
2. انسخ `.env.example` إلى `.env` واملأ `SUPABASE_URL` و`SUPABASE_ANON_KEY`.
3. ارفع البيانات الأولية:
   ```bash
   SUPABASE_SERVICE_KEY=... npm run seed
   ```
4. أعد التشغيل — سيكتشف النظام المفاتيح ويستخدم Supabase تلقائياً.

## بنية المشروع

```
darb/
├─ server/
│  ├─ index.js            خادم Express
│  ├─ engine.js           محرك احتمالية القبول والنطاق
│  ├─ routes/api.js       مسارات API
│  └─ db/
│     ├─ schema.sql       مخطط قاعدة البيانات
│     ├─ store.js         طبقة البيانات (Supabase + محلي)
│     └─ seed-supabase.js رفع البيانات
├─ public/                الواجهة
│  ├─ index.html          الصفحة الرئيسية
│  ├─ departments.html    قائمة الأقسام
│  ├─ department.html     تفاصيل القسم
│  ├─ universities.html   قائمة الجامعات
│  ├─ university.html     تفاصيل الجامعة
│  ├─ css/app.css
│  └─ js/common.js
└─ data/seed.json         بيانات أولية واقعية
```

## نقاط API

| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/api/departments` | كل الأقسام (فلترة `?branch=` `?q=`) |
| GET | `/api/departments/:id` | تفاصيل قسم + معدلات + نطاق |
| GET | `/api/universities` | كل الجامعات |
| GET | `/api/universities/:slug` | جامعة + كلياتها |
| GET | `/api/institutes` | المعاهد |
| POST | `/api/engine/match` | ترتيب الأقسام حسب المعدل |
| POST | `/api/simulate` | تحليل ترتيب الرغبات |
| POST | `/api/contact` | إرسال رسالة تواصل |

---

صُمّم بشغف لطلبة العراق · **mr 404 — 404 Studio**
