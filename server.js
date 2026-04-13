require('dotenv').config();
const express  = require('express');
const http     = require('http');
const cors     = require('cors');
const helmet   = require('helmet');
const rateLimit = require('express-rate-limit');
const { initSocket } = require('./services/socket');

const app    = express();
const server = http.createServer(app);
initSocket(server);

// ── Güvenlik ────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));

// ── Rate Limiting ────────────────────────────────
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Çok fazla hatalı giriş. 15 dakika bekle.' }
}));
app.use('/api/auth/register', rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Saatte en fazla 3 kayıt yapılabilir.' }
}));

// ── Routes ───────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/moderation', require('./routes/moderation'));
app.use('/api/users', require('./routes/users'));

// ── Health Check (Render uyku önleme) ────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── 404 ─────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Sayfa bulunamadı.' });
});

// ── Hata yakalama ────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Sunucu hatası.' });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`MAHALLEM çalışıyor → port ${PORT}`));
