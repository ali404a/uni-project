// ═══ أدوات مشتركة لكل الصفحات ═══
const API = '/api';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
async function api(path, opts) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' }, ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'خطأ');
  return res.json();
}
const qs = k => new URLSearchParams(location.search).get(k);

// شعار SVG
const LOGO = `<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="22" stroke="url(#lg)" stroke-width="1.5" opacity=".4"/><path d="M8 30 Q20 8 40 18" stroke="url(#lg)" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="8" cy="30" r="2.6" fill="#33d98a"/><circle cx="31" cy="16" r="2.2" fill="#38e0e8"/><circle cx="40" cy="18" r="3" fill="#4d6bff"/><defs><linearGradient id="lg" x1="0" y1="0" x2="48" y2="48"><stop stop-color="#38e0e8"/><stop offset="1" stop-color="#4d6bff"/></linearGradient></defs></svg>`;

// حقن الرأس
function mountHeader(active = '') {
  const links = [
    ['/', 'الرئيسية'], ['/departments', 'الأقسام'], ['/universities', 'الجامعات'],
    ['/#library', 'المكتبة'], ['/#faq', 'الأسئلة'],
  ];
  document.body.insertAdjacentHTML('afterbegin', `
  <canvas id="starfield"></canvas><div class="aurora"></div>
  <div class="content"><header><nav>
    <a class="brand" href="/"><div class="logo-mark">${LOGO}</div>
      <div><b>درب التبانة</b><span>طريقك الذكي نحو الجامعة</span></div></a>
    <div class="nav-links" id="nl">
      ${links.map(l => `<a href="${l[0]}" class="${active === l[0] ? 'active' : ''}">${l[1]}</a>`).join('')}
      <a href="/#engine" class="btn btn-primary" style="padding:9px 18px">ابدأ الآن</a>
    </div>
    <button class="menu-btn" onclick="document.getElementById('nl').classList.toggle('open')">☰</button>
  </nav></header>`);
}
function mountFooter() {
  document.querySelector('.content').insertAdjacentHTML('beforeend',
    `<footer><div class="foot-bottom">© 2026 درب التبانة الجامعي — صُمّم بشغف لطلبة العراق · mr 404</div></footer>`);
}

// النجوم
function startStars() {
  const cv = document.getElementById('starfield'); if (!cv) return;
  const cx = cv.getContext('2d'); let stars = [], W, H;
  const resize = () => { W = cv.width = innerWidth; H = cv.height = innerHeight;
    stars = Array.from({ length: Math.min(150, innerWidth / 9) }, () => ({
      x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.3 + .2,
      a: Math.random(), s: Math.random() * .014 + .003 })); };
  resize(); addEventListener('resize', resize);
  (function loop() { cx.clearRect(0, 0, W, H);
    for (const s of stars) { s.a += s.s; if (s.a > 1 || s.a < 0) s.s *= -1;
      cx.globalAlpha = Math.abs(s.a); cx.fillStyle = '#cdd6ff';
      cx.beginPath(); cx.arc(s.x, s.y, s.r, 0, 7); cx.fill(); }
    cx.globalAlpha = 1; requestAnimationFrame(loop); })();
}
function revealOnScroll() {
  const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add('in')), { threshold: .1 });
  $$('.reveal').forEach(el => io.observe(el));
}
const chanceClass = k => ({ high: 'c-high', mid: 'c-mid', low: 'c-low' }[k] || 'c-unknown');

function bootShell(active) { mountHeader(active); startStars(); }
