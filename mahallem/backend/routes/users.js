const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const prisma = new PrismaClient();

// ── Ebeveyn raporu ───────────────────────────────
router.get('/me/parent-report', auth, async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    weekAgo.setHours(0,0,0,0);

    const [todayUsage, weekSessions, warnCount, reportCount] = await Promise.all([
      prisma.usageSession.aggregate({
        where: { userId: req.user.userId, startedAt: { gte: today } },
        _sum: { durationMinutes: true }
      }),
      prisma.usageSession.findMany({
        where: { userId: req.user.userId, startedAt: { gte: weekAgo } },
        select: { startedAt: true, durationMinutes: true }
      }),
      prisma.modLog.count({ where: { userId: req.user.userId } }),
      prisma.report.count({ where: { reportedUserId: req.user.userId } })
    ]);

    // Günlük kırılım (son 7 gün)
    const daily = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      daily[d.toISOString().split('T')[0]] = 0;
    }
    weekSessions.forEach(s => {
      const day = s.startedAt.toISOString().split('T')[0];
      if (daily[day] !== undefined) daily[day] += s.durationMinutes || 0;
    });

    res.json({
      todayMinutes: todayUsage._sum.durationMinutes || 0,
      weeklyBreakdown: daily,
      totalWarnings: warnCount,
      totalReports: reportCount
    });
  } catch (err) {
    res.status(500).json({ error: 'Rapor yüklenemedi.' });
  }
});

// ── Profil güncelle ──────────────────────────────
router.put('/me', auth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || username.length < 3) {
      return res.status(400).json({ error: 'Geçersiz kullanıcı adı.' });
    }
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: { username },
      select: { id: true, username: true, age: true }
    });
    res.json(user);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Bu kullanıcı adı alınmış.' });
    res.status(500).json({ error: 'Güncelleme başarısız.' });
  }
});

module.exports = router;
