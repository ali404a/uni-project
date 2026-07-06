// ═══════════════════════════════════════════════════════════
//  محرك التخصصات — يحسب احتمالية القبول والنطاق المتوقع
// ═══════════════════════════════════════════════════════════

// حساب فئة الاحتمالية بناءً على الفرق بين معدل الطالب وآخر معدل قبول
export function chanceLevel(studentAvg, lastRate) {
  if (lastRate == null) return { key: 'unknown', label: 'غير متوفر', score: 0 };
  const diff = studentAvg - lastRate;
  if (diff >= 1)  return { key: 'high', label: 'مرتفعة', score: 90 };
  if (diff >= -1) return { key: 'high', label: 'مرتفعة', score: 75 };
  if (diff >= -3) return { key: 'mid',  label: 'متوسطة', score: 50 };
  if (diff >= -6) return { key: 'mid',  label: 'متوسطة', score: 35 };
  return { key: 'low', label: 'مخاطرة عالية', score: 15 };
}

// النطاق المتوقع لهذا العام (± هامش حول آخر معدل)
export function expectedRange(lastRate) {
  if (lastRate == null) return null;
  const margin = 1.5;
  const min = Math.max(50, +(lastRate - margin).toFixed(2));
  const max = Math.min(100, +(lastRate + margin).toFixed(2));
  return { min, max };
}

// ترتيب الأقسام حسب ملاءمتها لمعدل الطالب
export function rankDepartments(departments, { avg, branch }) {
  return departments
    .filter(d => !branch || d.branch === branch || branch.includes(d.branch) || d.branch.includes(branch.split(' ').pop()))
    .map(d => {
      const chance = chanceLevel(avg, d.last_rate);
      return {
        id: d.id,
        name: d.name,
        university_name: d.university_name,
        college_name: d.college_name,
        branch: d.branch,
        last_rate: d.last_rate,
        last_year: d.last_year,
        range: expectedRange(d.last_rate),
        chance,
      };
    })
    .sort((a, b) => {
      // الأقرب لمعدل الطالب أولاً ثم الأعلى احتمالية
      const da = Math.abs(avg - (a.last_rate ?? 0));
      const db = Math.abs(avg - (b.last_rate ?? 0));
      if (b.chance.score !== a.chance.score) return b.chance.score - a.chance.score;
      return da - db;
    });
}

// ═══ محرك المقارنة ═══
// يعرض الأقسام الأقرب لمعدل الطالب (ضمن نافذة: أعلى بدرجة وأقل بدرجات)،
// مرتّبة بالأقرب فالأقرب، ثم يقصّها إلى العدد المطلوب (40 قسماً).
export function compareByAverage(departments, { avg, branch }, limit = 40) {
  const filtered = departments.filter(d => {
    if (d.last_rate == null) return false;
    if (branch && d.branch !== branch) return false;
    return true;
  });

  const scored = filtered.map(d => {
    const diff = +(avg - d.last_rate).toFixed(2); // موجب = معدلك أعلى
    return {
      id: d.id, name: d.name, university_name: d.university_name,
      college_name: d.college_name, college_icon: d.college_icon,
      branch: d.branch, study_years: d.study_years,
      last_rate: d.last_rate, last_year: d.last_year,
      diff,
      range: expectedRange(d.last_rate),
      chance: chanceLevel(avg, d.last_rate),
    };
  });

  // الترتيب: الأقرب لمعدل الطالب أولاً (بالقيمة المطلقة للفرق)
  scored.sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
  return scored.slice(0, limit);
}

// أقرب المعاهد لمعدل الطالب
export function compareInstitutes(institutes, avg, limit = 10) {
  return institutes
    .filter(i => i.last_rate != null)
    .map(i => ({
      id: i.id, name: i.name, city: i.city, type: i.type,
      specialties: i.specialties, last_rate: i.last_rate,
      diff: +(avg - i.last_rate).toFixed(2),
      chance: chanceLevel(avg, i.last_rate),
    }))
    .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))
    .slice(0, limit);
}

// تحليل ترتيب الرغبات في المحاكاة
export function analyzeWishlist(wishes, avg) {
  const analyzed = wishes.map((w, i) => ({
    order: i + 1,
    ...w,
    chance: chanceLevel(avg, w.last_rate),
  }));
  const hasSafe = analyzed.slice(0, 5).some(w => w.chance.key === 'high');
  const allRisky = analyzed.every(w => w.chance.key === 'low');
  const tips = [];
  if (!hasSafe) tips.push('ضع رغبة ذات فرصة مرتفعة ضمن أول خمس رغبات لتأمين مقعدك.');
  if (allRisky) tips.push('جميع رغباتك عالية المخاطرة — أضف خيارات أقرب لمعدلك.');
  if (analyzed[0]?.chance.key === 'low') tips.push('رغبتك الأولى طموحة جداً، وهذا جيد، لكن لا تجعل كل خياراتك بهذا المستوى.');
  if (tips.length === 0) tips.push('ترتيب متوازن — يجمع بين الطموح والأمان. 👍');
  return { wishes: analyzed, tips };
}
