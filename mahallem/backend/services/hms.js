const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const ACCESS_KEY = process.env.HMS_ACCESS_KEY;
const SECRET = process.env.HMS_SECRET;

/**
 * 100ms yönetim token'ı (oda oluşturma/silme için)
 */
function getManagementToken() {
  const payload = {
    access_key: ACCESS_KEY,
    type: 'management',
    version: 2,
    iat: Math.floor(Date.now() / 1000),
    nbf: Math.floor(Date.now() / 1000)
  };
  return jwt.sign(payload, SECRET, {
    algorithm: 'HS256',
    expiresIn: '24h',
    jwtid: uuidv4()
  });
}

/**
 * Kullanıcı için 100ms oda token'ı (odaya katılmak için)
 */
function createRoomToken(roomId, userId, role = 'listener') {
  const payload = {
    access_key: ACCESS_KEY,
    room_id: roomId,
    user_id: userId,
    role: role,        // 'host' veya 'listener' — 100ms dashboard'unda tanımlı olmalı
    type: 'app',
    version: 2,
    iat: Math.floor(Date.now() / 1000),
    nbf: Math.floor(Date.now() / 1000)
  };
  return jwt.sign(payload, SECRET, {
    algorithm: 'HS256',
    expiresIn: '4h',
    jwtid: uuidv4()
  });
}

/**
 * 100ms API üzerinden yeni oda oluştur
 */
async function createHMSRoom(name) {
  const token = getManagementToken();
  const res = await fetch('https://api.100ms.live/v2/rooms', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: name.replace(/\s+/g, '-').toLowerCase(),
      description: 'MAHALLEM sesli oda',
      template_id: process.env.HMS_TEMPLATE_ID  // 100ms dashboard'undan alınır
    })
  });
  if (!res.ok) throw new Error('100ms oda oluşturulamadı');
  return res.json();
}

/**
 * 100ms odasını devre dışı bırak
 */
async function disableHMSRoom(roomId) {
  const token = getManagementToken();
  await fetch(`https://api.100ms.live/v2/rooms/${roomId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ enabled: false })
  });
}

/**
 * Odadaki aktif katılımcıları listele
 */
async function listActivePeers(roomId) {
  const token = getManagementToken();
  const res = await fetch(`https://api.100ms.live/v2/active-rooms/${roomId}/peers`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.peers || [];
}

/**
 * Kullanıcıyı odadan at
 */
async function removePeer(roomId, peerId) {
  const token = getManagementToken();
  await fetch(`https://api.100ms.live/v2/active-rooms/${roomId}/remove-peers`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ peer_ids: [peerId], reason: 'Topluluk kuralları ihlali' })
  });
}

module.exports = { createRoomToken, createHMSRoom, disableHMSRoom, listActivePeers, removePeer };
