const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { moderateAudio } = require('../services/moderation');
const prisma = new PrismaClient();
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB limit
});

router.post('/analyze', auth, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.json({ violation: false });

    const { roomId } = req.body;
    const userId = req.user.userId;

    // Ses dosyasını Groq Whisper'a gönder
    const { toFile } = require('openai');
    const audioFile = await toFile(req.file.buffer, 'audio.webm', { type: 'audio/webm' });

    const result = await moderateAudio(audioFile, userId, roomId || null, prisma);

    if (result.violation) {
      console.log(`[MOD] ${req.user.username}: ${result.type} - ${result.transcript}`);

      // 3. uyarıda odadan at
      if (result.shouldKick) {
        // Socket.io üzerinden kullanıcıyı uyar
        req.app.get('io')?.to(userId).emit('force-disconnect', {
          reason: `${result.warnCount} uyarı aldın. Odadan çıkarıldın.`
        });
      }
    }

    res.json(result);
  } catch (err) {
    console.error('Moderasyon analiz hatası:', err.message);
    res.json({ violation: false });
  }
});

module.exports = router;