const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const prisma = new PrismaClient();

// ── Şikayet gönder ───────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { reportedUserId, roomId, reason, description } = req.body;
    if (!reportedUserId || !reason) {
      return res.status(400).json({ error: 'Şikayet edilen kullanıcı ve sebep gerekli.' });
    }
    if (reportedUserId === req.user.userId) {
      return res.status(400).json({ error: 'Kendinizi şikayet edemezsiniz.' });
    }

    const report = await prisma.report.create({
      data: {
        reporterId: req.user.userId,
        reportedUserId,
        roomId: roomId || null,
        reason,
        description: description || null
      }
    });
    res.status(201).json({ ok: true, reportId: report.id });
  } catch (err) {
    res.status(500).json({ error: 'Şikayet gönderilemedi.' });
  }
});

// ── Kullanıcıyı engelle ──────────────────────────
router.post('/block', auth, async (req, res) => {
  try {
    const { blockedId } = req.body;
    if (!blockedId || blockedId === req.user.userId) {
      return res.status(400).json({ error: 'Geçersiz istek.' });
    }
    await prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: req.user.userId, blockedId } },
      update: {},
      create: { blockerId: req.user.userId, blockedId }
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Engelleme başarısız.' });
  }
});

// ── Engeli kaldır ────────────────────────────────
router.delete('/block/:blockedId', auth, async (req, res) => {
  try {
    await prisma.userBlock.deleteMany({
      where: { blockerId: req.user.userId, blockedId: req.params.blockedId }
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Engel kaldırılamadı.' });
  }
});

// ── Engellediklerimi listele ─────────────────────
router.get('/blocked', auth, async (req, res) => {
  try {
    const blocks = await prisma.userBlock.findMany({
      where: { blockerId: req.user.userId },
      include: { blocked: { select: { id: true, username: true } } }
    });
    res.json(blocks.map(b => b.blocked));
  } catch (err) {
    res.status(500).json({ error: 'Liste yüklenemedi.' });
  }
});

module.exports = router;
