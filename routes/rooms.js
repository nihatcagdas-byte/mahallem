const { getRoomCount } = require('../services/socket');
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { validateText } = require('../services/moderation');
const prisma = new PrismaClient();

// ── Tüm aktif odaları listele ────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const rooms = await prisma.room.findMany({
      where: { isActive: true },
      include: { owner: { select: { username: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: 'Odalar yüklenemedi.' });
  }
});

// ── Yeni oda oluştur ─────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { name, category, ageMin, ageMax, maxUsers, inviteOnly } = req.body;

    // İçerik filtresi
    const check = validateText(name, 'Oda adı');
    if (!check.valid) {
      return res.status(400).json({ error: check.reason });
    }

    // 100ms üzerinde oda oluştur


    const room = await prisma.room.create({
      data: {
        name: name.trim(),
        category: category || 'genel',
        ageMin: parseInt(ageMin) || 10,
        ageMax: parseInt(ageMax) || 18,
        maxUsers: parseInt(maxUsers) || 10,
        ownerId: req.user.userId,
        inviteOnly: inviteOnly || false
      }
    });

    res.status(201).json(room);

  } catch (err) {
    console.error('Oda oluşturma hatası:', err);
    res.status(500).json({ error: 'Oda oluşturulamadı.' });
  }
});

// ── Odaya katılmak için token al ─────────────────
router.post('/:id/join', auth, async (req, res) => {
  try {
    const room = await prisma.room.findUnique({ where: { id: req.params.id } });
    if (!room || !room.isActive) {
      return res.status(404).json({ error: 'Oda bulunamadı veya kapalı.' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    if (user.isBanned) return res.status(403).json({ error: 'Hesabın askıya alınmış.' });

    // Yaş uyumluluk kontrolü
    if (user.age < room.ageMin || user.age > room.ageMax) {
      return res.status(403).json({
        error: `Bu oda ${room.ageMin}-${room.ageMax} yaş arası için oluşturulmuş.`
      });
    }

    // Kapasite kontrolü
const { getRoomCount } = require('../services/socket');
const activeCount = getRoomCount(req.params.id);
if (activeCount >= room.maxUsers) {
  return res.status(409).json({ error: 'Oda dolu.' });
}

    // Günlük kullanım limiti kontrolü
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayUsage = await prisma.usageSession.aggregate({
      where: { userId: user.id, startedAt: { gte: todayStart } },
      _sum: { durationMinutes: true }
    });
    const usedMinutes = todayUsage._sum.durationMinutes || 0;
    if (usedMinutes >= user.dailyLimit) {
      return res.status(403).json({
        error: `Günlük ${user.dailyLimit} dakika limitine ulaştın. Yarın tekrar deneyebilirsin.`
      });
    }

    // 100ms token üret
    const isHost = ['admin', 'moderator'].includes(user.role) || room.ownerId === user.id;
    const token = createRoomToken(room.hmsRoomId, user.username, isHost ? 'host' : 'listener');

    // Kullanım oturumu başlat
    const session = await prisma.usageSession.create({
      data: { userId: user.id, roomId: room.id }
    });

    res.json({
      token,
      roomId: room.hmsRoomId,
      sessionId: session.id,
      room: { id: room.id, name: room.name, hmsRoomId: room.hmsRoomId }
    });

  } catch (err) {
    console.error('Katılım hatası:', err);
    res.status(500).json({ error: 'Odaya katılırken hata oluştu.' });
  }
});

// ── Odadan ayrıl ─────────────────────────────────
router.post('/:id/leave', auth, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (sessionId) {
      const session = await prisma.usageSession.findFirst({
        where: { id: sessionId, userId: req.user.userId, endedAt: null }
      });
      if (session) {
        const dur = Math.round((Date.now() - session.startedAt.getTime()) / 60000);
        await prisma.usageSession.update({
          where: { id: session.id },
          data: { endedAt: new Date(), durationMinutes: Math.max(dur, 1) }
        });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Ayrılış kaydedilemedi.' });
  }
});

// ── Oda sil (sadece sahip veya admin) ────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    const room = await prisma.room.findUnique({ where: { id: req.params.id } });
    if (!room) return res.status(404).json({ error: 'Oda bulunamadı.' });
    if (room.ownerId !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Bu işlem için yetkin yok.' });
    }
    await prisma.room.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Oda kapatılamadı.' });
  }
});

module.exports = router;
