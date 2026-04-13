// ─────────────────────────────────────────────────────────
// MAHALLEM — WebRTC Sinyal Sunucusu (Socket.io)
// Hiçbir dışarıdan servis gerektirmez. Tamamen ücretsiz.
// ─────────────────────────────────────────────────────────
const { Server } = require('socket.io');

// Odadaki kullanıcıları bellekte tut
// rooms = { roomDbId: { socketId: { username, userId } } }
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

function getRoomUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.entries()).map(([socketId, info]) => ({
    socketId,
    username: info.username,
    userId: info.userId
  }));
}

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL,
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {

    // ── Odaya katıl ──────────────────────────────────
    socket.on('join-room', ({ roomId, username, userId }) => {
      socket.join(roomId);
      socket.roomId  = roomId;
      socket.username = username;
      socket.userId  = userId;

      const room = getOrCreateRoom(roomId);
      room.set(socket.id, { username, userId });

      // Yeni kullanıcıya odadaki diğer herkesi bildir
      const others = getRoomUsers(roomId).filter(u => u.socketId !== socket.id);
      socket.emit('room-users', others);

      // Odadaki herkese yeni kullanıcı geldiğini bildir
      socket.to(roomId).emit('user-joined', {
        socketId: socket.id,
        username,
        userId
      });

      console.log(`[${roomId}] ${username} katıldı. Toplam: ${room.size}`);
    });

    // ── WebRTC Offer (arayan → aranan) ───────────────
    socket.on('offer', ({ to, offer }) => {
      io.to(to).emit('offer', {
        from: socket.id,
        fromUsername: socket.username,
        offer
      });
    });

    // ── WebRTC Answer (aranan → arayan) ──────────────
    socket.on('answer', ({ to, answer }) => {
      io.to(to).emit('answer', {
        from: socket.id,
        answer
      });
    });

    // ── ICE Candidate (bağlantı adayı) ───────────────
    socket.on('ice-candidate', ({ to, candidate }) => {
      io.to(to).emit('ice-candidate', {
        from: socket.id,
        candidate
      });
    });

    // ── Mikrofon durumu değişti ───────────────────────
    socket.on('mic-state', ({ muted }) => {
      if (socket.roomId) {
        socket.to(socket.roomId).emit('peer-mic-state', {
          socketId: socket.id,
          username: socket.username,
          muted
        });
      }
    });

    // ── Konuşuyor bildirimi (ses seviyesi) ────────────
    socket.on('speaking', ({ speaking }) => {
      if (socket.roomId) {
        socket.to(socket.roomId).emit('peer-speaking', {
          socketId: socket.id,
          username: socket.username,
          speaking
        });
      }
    });

    // ── Bağlantı kesildi ──────────────────────────────
    socket.on('disconnect', () => {
      const roomId = socket.roomId;
      if (!roomId) return;

      const room = rooms.get(roomId);
      if (room) {
        room.delete(socket.id);
        if (room.size === 0) rooms.delete(roomId);
      }

      socket.to(roomId).emit('user-left', {
        socketId: socket.id,
        username: socket.username
      });

      console.log(`[${roomId}] ${socket.username} ayrıldı.`);
    });

    // ── Aktif oda listesi için kullanıcı sayısı ────────
    socket.on('get-room-count', ({ roomId }, cb) => {
      const room = rooms.get(roomId);
      cb({ count: room ? room.size : 0 });
    });
  });

  return io;
}

// Oda kullanıcı sayısını dışarıya aç (rooms route için)
function getRoomCount(roomId) {
  const room = rooms.get(roomId);
  return room ? room.size : 0;
}

module.exports = { initSocket, getRoomCount };
