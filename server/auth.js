// ═══ مصادقة الأدمن — JWT + bcrypt ═══
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { store } from './db/store.js';

const JWT_SECRET = process.env.JWT_SECRET || 'darb-altabana-dev-secret-change-in-production';
const TOKEN_TTL = '12h';

export async function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}

export async function login(username, password) {
  const user = await store.adminByUsername(username);
  if (!user || !user.is_active) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  await store.touchAdminLogin(user.id);
  const token = jwt.sign(
    { uid: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
  return { token, user: { username: user.username, display_name: user.display_name, role: user.role } };
}

// middleware: يتحقق من التوكن
export function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'غير مصرّح — سجّل الدخول' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'الجلسة منتهية — سجّل الدخول مجدداً' });
  }
}
