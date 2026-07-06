import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';
import api from './routes/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(compression());
app.use(express.json());

// ملفات الواجهة الثابتة
app.use(express.static(join(__dirname, '../public')));

// API
app.use('/api', api);

// صفحات الواجهة (توجيه إلى ملفات HTML)
const pages = {
  '/': 'index.html',
  '/departments': 'departments.html',
  '/department': 'department.html',
  '/universities': 'universities.html',
  '/university': 'university.html',
};
for (const [route, file] of Object.entries(pages)) {
  app.get(route, (_req, res) => res.sendFile(join(__dirname, '../public', file)));
}

app.listen(PORT, () => {
  console.log(`\n🚀 درب التبانة الجامعي يعمل على  http://localhost:${PORT}\n`);
});
