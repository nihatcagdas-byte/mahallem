const OpenAI = require('openai');

// Groq, OpenAI ile birebir uyumlu — sadece baseURL farklı
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
});

// ── Yasaklı kelimeler ────────────────────────────
const PROFANITY = [
  'küfür','sövme','boktan','orospu','siktir','amk','bok','mal',
  'gerizekalı','aptal','salak','göt','piç','oç','dangalak','embesil',
  'fuck','shit','bitch','ass','bastard','idiot','stupid','porn','sex'
];

// ── Kişisel bilgi kalıpları ──────────────────────
const PERSONAL_PATTERNS = [
  /\b05\d{2}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}\b/,  // Türk telefon
  /\+90[\s\-]?\d{3}[\s\-]?\d{3}[\s\-]?\d{4}/,           // +90 ile telefon
  /\b\d{10,11}\b/,                                        // Uzun rakam dizisi
  /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i,           // E-posta
  /sokak|cadde|mahalle|apt\.|daire|kat\s\d|no:\s*\d/i,   // Adres
  /\b\d{5}\b/                                             // Posta kodu
];

// ── Spam kalıbı ──────────────────────────────────
const SPAM_PATTERN = /(.)\1{4,}/;

// ── İzin verilen karakterler ─────────────────────
const ALLOWED_CHARS = /^[a-zA-ZğüşıöçĞÜŞİÖÇ0-9\s\-_!?.'&()]+$/;

/**
 * Oda adı veya açıklama içerik denetimi
 */
function validateText(text, fieldName = 'Alan') {
  if (!text || text.trim().length < 3) {
    return { valid: false, reason: `${fieldName} en az 3 karakter olmalı.` };
  }
  if (text.length > 60) {
    return { valid: false, reason: `${fieldName} en fazla 60 karakter olabilir.` };
  }

  const lower = text.toLowerCase();

  for (const word of PROFANITY) {
    if (lower.includes(word)) {
      return { valid: false, reason: `"${word}" ifadesi ${fieldName.toLowerCase()} alanında kullanılamaz.` };
    }
  }

  for (const pattern of PERSONAL_PATTERNS) {
    if (pattern.test(text)) {
      return { valid: false, reason: 'Telefon numarası, e-posta veya adres bilgisi kullanılamaz.' };
    }
  }

  if (SPAM_PATTERN.test(text)) {
    return { valid: false, reason: 'Tekrarlı karakterler kullanılamaz.' };
  }

  return { valid: true };
}

/**
 * Ses kaydını metne çevirip içerik denetimi yap (Groq Whisper)
 * audioBlob: Buffer veya File nesnesi
 */
async function moderateAudio(audioBlob, userId, roomId, prisma) {
  try {
    // Groq Whisper ile sesi metne çevir
    const transcription = await groq.audio.transcriptions.create({
      file: audioBlob,
      model: 'whisper-large-v3',
      language: 'tr',
      response_format: 'text'
    });

    const text = typeof transcription === 'string' ? transcription : transcription.text;
    if (!text || text.trim().length === 0) return { violation: false };

    const lower = text.toLowerCase();
    let violationType = null;

    // Küfür/kötü dil kontrolü
    for (const word of PROFANITY) {
      if (lower.includes(word)) {
        violationType = 'profanity';
        break;
      }
    }

    // Kişisel bilgi paylaşımı kontrolü
    if (!violationType) {
      for (const pattern of PERSONAL_PATTERNS) {
        if (pattern.test(text)) {
          violationType = 'personal_info';
          break;
        }
      }
    }

    if (violationType) {
      // Moderasyon kaydı oluştur
      await prisma.modLog.create({
        data: {
          userId,
          roomId,
          violationType,
          transcript: text,
          actionTaken: 'warn'
        }
      });

      // Uyarı sayısını artır
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { warnCount: { increment: 1 } }
      });

      return {
        violation: true,
        type: violationType,
        transcript: text,
        warnCount: updatedUser.warnCount,
        shouldKick: updatedUser.warnCount >= 3,   // 3. uyarıda odadan at
        shouldBan: updatedUser.warnCount >= 10    // 10. uyarıda hesabı askıya al
      };
    }

    return { violation: false };

  } catch (err) {
    // Groq rate limit veya hata durumunda sessizce geç
    console.error('AI moderasyon hatası:', err.message);
    return { violation: false };
  }
}

module.exports = { validateText, moderateAudio };
