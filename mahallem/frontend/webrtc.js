// ─────────────────────────────────────────────────────────
// MAHALLEM — Tarayıcı WebRTC Ses Motoru
// Bu dosyayı frontend klasörüne webrtc.js olarak kaydet
// Hiçbir dışarıdan kütüphane gerektirmez.
// ─────────────────────────────────────────────────────────

class MahallemVoice {
  constructor(socketUrl) {
    this.socketUrl = socketUrl;
    this.socket      = null;
    this.peers       = new Map();   // socketId → RTCPeerConnection
    this.localStream = null;
    this.roomId      = null;
    this.username    = null;
    this.micEnabled  = true;
    this.onUsersUpdate = null;   // callback: kullanıcı listesi değişince
    this.onSpeaking    = null;   // callback: konuşan değişince

    // Google'ın ücretsiz STUN sunucuları (kredi kartı yok, limit yok)
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };

    this.users = new Map(); // socketId → { username, muted, speaking }
  }

  // ── Mikrofon izni al + odaya bağlan ──────────────
  async join(roomId, username, userId) {
    this.roomId   = roomId;
    this.username = username;

    // 1. Mikrofon izni al
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
    } catch (err) {
      throw new Error('Mikrofon erişimi reddedildi. Lütfen tarayıcı izinlerini kontrol et.');
    }

    // 2. Konuşma tespiti başlat
    this._startSpeechDetection();

    // 3. Socket.io bağlantısı kur
    await this._connectSocket(userId);

    // 4. Odaya katıl
    this.socket.emit('join-room', { roomId, username, userId });
  }

  // ── Socket.io bağlantısı ─────────────────────────
  async _connectSocket(userId) {
    // socket.io CDN'den yükleniyor (index.html içinde)
    return new Promise((resolve) => {
      this.socket = io(this.socketUrl, {
        transports: ['websocket'],
        auth: { userId }
      });

      this.socket.on('connect', resolve);

      // Odadaki mevcut kullanıcıları al
      this.socket.on('room-users', (users) => {
        users.forEach(u => {
          this.users.set(u.socketId, { username: u.username, muted: false, speaking: false });
          this._createPeer(u.socketId, true); // true = teklif yapan
        });
        this._notifyUsers();
      });

      // Yeni kullanıcı katıldı
      this.socket.on('user-joined', ({ socketId, username }) => {
        this.users.set(socketId, { username, muted: false, speaking: false });
        this._createPeer(socketId, false); // false = bekleyen
        this._notifyUsers();
      });

      // Kullanıcı ayrıldı
      this.socket.on('user-left', ({ socketId, username }) => {
        this._removePeer(socketId);
        this.users.delete(socketId);
        this._notifyUsers();
      });

      // WebRTC Offer geldi
      this.socket.on('offer', async ({ from, offer }) => {
        let peer = this.peers.get(from);
        if (!peer) peer = this._createPeer(from, false);
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        this.socket.emit('answer', { to: from, answer });
      });

      // WebRTC Answer geldi
      this.socket.on('answer', async ({ from, answer }) => {
        const peer = this.peers.get(from);
        if (peer) await peer.setRemoteDescription(new RTCSessionDescription(answer));
      });

      // ICE Candidate geldi
      this.socket.on('ice-candidate', async ({ from, candidate }) => {
        const peer = this.peers.get(from);
        if (peer && candidate) {
          try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
        }
      });

      // Karşı tarafın mikrofon durumu
      this.socket.on('peer-mic-state', ({ socketId, muted }) => {
        if (this.users.has(socketId)) {
          this.users.get(socketId).muted = muted;
          this._notifyUsers();
        }
      });

      // Karşı taraf konuşuyor
      this.socket.on('peer-speaking', ({ socketId, speaking }) => {
        if (this.users.has(socketId)) {
          this.users.get(socketId).speaking = speaking;
          this._notifyUsers();
          if (this.onSpeaking) this.onSpeaking(socketId, speaking);
        }
      });
    });
  }

  // ── RTCPeerConnection oluştur ────────────────────
  _createPeer(targetSocketId, isInitiator) {
    const peer = new RTCPeerConnection(this.rtcConfig);
    this.peers.set(targetSocketId, peer);

    // Kendi ses akışını ekle
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        peer.addTrack(track, this.localStream);
      });
    }

    // Karşı tarafın sesini al ve oynat
    peer.ontrack = ({ streams }) => {
      const audio = document.createElement('audio');
      audio.srcObject = streams[0];
      audio.autoplay = true;
      audio.id = 'audio-' + targetSocketId;
      // Mevcut varsa kaldır
      const old = document.getElementById('audio-' + targetSocketId);
      if (old) old.remove();
      document.body.appendChild(audio);
    };

    // ICE adaylarını karşıya gönder
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.socket.emit('ice-candidate', { to: targetSocketId, candidate });
      }
    };

    // Bağlantı durumu logla
    peer.onconnectionstatechange = () => {
      console.log(`[WebRTC] ${targetSocketId}: ${peer.connectionState}`);
    };

    // Offer yapan taraf başlasın
    if (isInitiator) {
      peer.onnegotiationneeded = async () => {
        try {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          this.socket.emit('offer', { to: targetSocketId, offer });
        } catch (err) {
          console.error('Offer hatası:', err);
        }
      };
    }

    return peer;
  }

  // ── Peer bağlantısını kapat ──────────────────────
  _removePeer(socketId) {
    const peer = this.peers.get(socketId);
    if (peer) { peer.close(); this.peers.delete(socketId); }
    const audio = document.getElementById('audio-' + socketId);
    if (audio) audio.remove();
  }

  // ── Konuşma tespiti (AudioAnalyser) ─────────────
  _startSpeechDetection() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      const src = ctx.createMediaStreamSource(this.localStream);
      src.connect(analyser);
      analyser.fftSize = 512;
      const data = new Uint8Array(analyser.frequencyBinCount);
      let wasSpeaking = false;

      setInterval(() => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const isSpeaking = avg > 15 && this.micEnabled;
        if (isSpeaking !== wasSpeaking) {
          wasSpeaking = isSpeaking;
          if (this.socket) this.socket.emit('speaking', { speaking: isSpeaking });
          if (this.onSpeaking) this.onSpeaking('me', isSpeaking);
        }
      }, 200);
    } catch {}
  }

  // ── Mikrofon aç/kapat ────────────────────────────
  toggleMic() {
    this.micEnabled = !this.micEnabled;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(t => { t.enabled = this.micEnabled; });
    }
    if (this.socket) this.socket.emit('mic-state', { muted: !this.micEnabled });
    return this.micEnabled;
  }

  // ── Odadan ayrıl ─────────────────────────────────
  leave() {
    this.peers.forEach((peer, socketId) => this._removePeer(socketId));
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.users.clear();
    this.roomId = null;
  }

  // ── Kullanıcı listesi callback ───────────────────
  _notifyUsers() {
    if (this.onUsersUpdate) {
      this.onUsersUpdate(Array.from(this.users.entries()).map(([id, u]) => ({
        socketId: id, ...u
      })));
    }
  }

  // Kullanıcı sayısını döndür
  get peerCount() { return this.users.size; }
}
