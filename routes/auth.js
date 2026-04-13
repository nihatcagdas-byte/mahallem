const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Kayıt ────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, age, parentEmail } = req.body;

    // Temel doğrulama
    if (!username || !email || !password || !age) {
      return res.status(400).json({ error: 'Tüm alanları doldurun.' });
    }
    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'Kullanıcı adı 3-30 karakter olmalı.' });
    }
    if (!/^[a-zA-ZğüşıöçĞÜŞİÖÇ0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Kullanıcı adında yalnızca harf, rakam ve alt çizgi kullanılabilir.' });
    }
    if (age < 10 || age > 18) {
      return res.status(400).json({ error: 'Platform 10-18 yaş arası içindir.' });
    }
    if (age < 13 && !parentEmail) {
      return res.status(400).json({ error: '13 yaş altı için ebeveyn e-postası zorunludur (KVKK).' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı.' });
    }

    // Mükerrer kayıt kontrolü
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] }
    });
    if (existing) {
      return res.status(409).json({ error: 'Bu kullanıcı adı veya e-posta zaten kayıtlı.' });
    }

    // Şifre hashleme
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        username,
        email: email.toLowerCase(),
        passwordHash,
        age: parseInt(age),
        parentEmail: parentEmail || null
      }
    });

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: { id: user.id, username: user.username, age: user.age, role: user.role }
    });

  } catch (err) {
    console.error('Kayıt hatası:', err);
    res.status(500).json({ error: 'Kayıt sırasında bir hata oluştu.' });
  }
});

// ── Giriş ────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
    }

    if (user.isBanned) {
      return res.status(403).json({ error: 'Hesabın askıya alınmış. Destek için iletişime geç.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
    }

    // Gece modu kontrolü (Türkiye saati = UTC+3)
    const nowTR = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const hourTR = nowTR.getUTCHours();
    if (hourTR >= 22 || hourTR < 7) {
      return res.status(403).json({
        error: 'Gece 22:00 – 07:00 arası platform erişime kapalıdır. Güvenli bir uyku için bu kural uygulanmaktadır.'
      });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, age: user.age, role: user.role }
    });

  } catch (err) {
    console.error('Giriş hatası:', err);
    res.status(500).json({ error: 'Giriş sırasında hata oluştu.' });
  }
});

// ── Token doğrula (frontend için) ────────────────
router.get('/me', require('../middleware/auth'), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, username: true, age: true, role: true, isBanned: true, warnCount: true }
    });
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

module.exports = router;
