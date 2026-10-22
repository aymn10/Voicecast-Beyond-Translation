// Multi-device interpreter rooms.
// Additive module: it only handles WebSocket messages whose type starts with "room_".
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LANGS = ['en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-BR', 'nl-NL', 'pl-PL', 'ru-RU', 'tr-TR', 'ar-SA', 'hi-IN', 'mr-IN', 'bn-IN', 'ta-IN', 'te-IN', 'gu-IN', 'kn-IN', 'ml-IN', 'pa-Guru-IN', 'ur-IN', 'ja-JP', 'ko-KR', 'zh-CN', 'id-ID', 'vi-VN', 'th-TH'];
const LATEST_LONG = new Set(['en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'hi-IN', 'ja-JP', 'zh-CN']);
const MAX_MEMBERS = 8;
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
const HISTORY_ON_JOIN = 60;
const MAX_MESSAGES = 500;

module.exports = function attachRooms(wss, deps) {
  const { speechClient, translateClient, firestore, FieldValue, uuidv4 } = deps;
  const rooms = new Map();

  const baseLang = (code) => String(code || 'en').split('-')[0].toLowerCase();
  const cleanLang = (l) => (LANGS.indexOf(l) !== -1 ? l : 'en-US');
  const cleanName = (n) => String(n || '').replace(/[<>]/g, '').trim().slice(0, 30) || 'Guest';

  function send(ws, obj) {
    try {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    } catch (e) { /* ignore */ }
  }

  function makeCode() {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(code)) return code;
    }
    return null;
  }

  function publicMembers(room) {
    return Array.from(room.members.values()).map((m) => ({ id: m.id, name: m.name, lang: m.lang, micOn: m.micOn }));
  }
  function broadcast(room, obj) { room.members.forEach((m) => send(m.ws, obj)); }
  function broadcastMembers(room) { broadcast(room, { type: 'room_members', members: publicMembers(room) }); }

  function ctxOf(ws) {
    const c = ws._room;
    if (!c) return null;
    const room = rooms.get(c.code);
    if (!room) return null;
    const m = room.members.get(c.memberId);
    if (!m) return null;
    return { room, m };
  }

  function stopStream(m) {
    if (m.stream) {
      try { m.stream.end(); } catch (e) { /* ignore */ }
      m.stream = null;
    }
  }

  function startStream(room, m) {
    stopStream(m);
    const request = {
      config: {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 48000,
        languageCode: m.lang,
        enableAutomaticPunctuation: true,
        ...(LATEST_LONG.has(m.lang) ? { model: 'latest_long', useEnhanced: true } : {})
      },
      interimResults: true
    };
    const stream = speechClient.streamingRecognize(request);
    m.stream = stream;
    stream.on('data', (d) => onSpeech(room, m, d));
    stream.on('error', (err) => {
      if (m.stream !== stream) return;
      m.stream = null;
      const text = String((err && err.message) || err);
      const limit = /305|maximum allowed stream duration|Audio Timeout/i.test(text);
      console.error('Room speech error:', text);
      if (m.micOn) {
        m.micOn = false;
        broadcastMembers(room);
        send(m.ws, {
          type: 'room_mic_stopped',
          reason: limit ? 'limit' : 'error',
          message: limit ? 'Restarting microphone' : 'Speech recognition stopped: ' + text
        });
      }
    });
  }

  function onSpeech(room, m, d) {
    const r = d.results && d.results[0];
    if (!r || !r.alternatives || !r.alternatives[0]) return;
    const alt = r.alternatives[0];
    if (!r.isFinal) {
      send(m.ws, { type: 'room_interim', text: alt.transcript || '' });
      return;
    }
    const text = String(alt.transcript || '').trim();
    if (text) handleFinal(room, m, text, alt.confidence).catch((e) => console.error('Room final error:', e));
  }

  async function handleFinal(room, m, text, confidence) {
    const srcBase = baseLang(m.lang);
    const targets = new Set();
    room.members.forEach((x) => {
      const b = baseLang(x.lang);
      if (b !== srcBase) targets.add(b);
    });
    const translations = {};
    await Promise.all(Array.from(targets).map(async (t) => {
      try {
        const result = await translateClient.translate(text, { from: srcBase, to: t });
        translations[t] = result[0];
      } catch (err) {
        console.error('Room translate error (' + t + '):', err.message);
        translations[t] = '';
      }
    }));
    const msg = {
      messageId: uuidv4(),
      speakerId: m.id,
      speakerName: m.name,
      originalText: text,
      originalLang: srcBase,
      translations: translations,
      confidence: confidence > 0 ? confidence : null,
      ts: Date.now()
    };
    room.messages.push(msg);
    if (room.messages.length > MAX_MESSAGES) room.messages.shift();
    broadcast(room, { type: 'room_message', message: msg });
    persist(room, msg);
  }

  function persist(room, msg) {
    (async () => {
      try {
        const ref = firestore.collection('conversations').doc(room.sessionId);
        if (!room.docReady) {
          const langs = Array.from(new Set(Array.from(room.members.values()).map((x) => baseLang(x.lang))));
          room.docReady = ref.set({
            sessionId: room.sessionId,
            sourceLanguage: room.hostLang,
            targetLanguages: langs,
            createdAt: new Date(),
            type: 'conversation',
            roomCode: room.code,
            messages: []
          });
        }
        await room.docReady;
        const entry = {
          messageId: msg.messageId,
          speakerName: msg.speakerName,
          originalText: msg.originalText,
          translations: msg.translations,
          timestamp: new Date(msg.ts),
          sourceLanguage: msg.originalLang
        };
        if (typeof msg.confidence === 'number') entry.confidence = msg.confidence;
        await ref.update({ messages: FieldValue.arrayUnion(entry) });
      } catch (err) {
        room.docReady = null;
        console.error('Room persist error:', err.message);
      }
    })();
  }

  function scheduleCleanup(room) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => {
      if (room.members.size === 0) rooms.delete(room.code);
    }, EMPTY_ROOM_TTL_MS);
  }

  function join(ws, room, name, lang) {
    clearTimeout(room.cleanupTimer);
    const m = { id: uuidv4().slice(0, 8), ws: ws, name: cleanName(name), lang: lang, micOn: false, gen: 0, stream: null };
    room.members.set(m.id, m);
    ws._room = { code: room.code, memberId: m.id };
    send(ws, {
      type: 'room_joined',
      code: room.code,
      memberId: m.id,
      members: publicMembers(room),
      history: room.messages.slice(-HISTORY_ON_JOIN)
    });
    broadcastMembers(room);
  }

  function leave(ws) {
    const c = ws._room;
    if (!c) return;
    ws._room = null;
    const room = rooms.get(c.code);
    if (!room) return;
    const m = room.members.get(c.memberId);
    if (m) {
      stopStream(m);
      room.members.delete(m.id);
    }
    if (room.members.size === 0) scheduleCleanup(room);
    else broadcastMembers(room);
  }

  function handle(ws, data) {
    switch (data.type) {
      case 'room_create': {
        leave(ws);
        const code = makeCode();
        if (!code) { send(ws, { type: 'room_error', message: 'Could not create a room. Please try again.' }); return; }
        const lang = cleanLang(data.lang);
        const room = {
          code: code,
          sessionId: uuidv4(),
          hostLang: lang,
          members: new Map(),
          messages: [],
          docReady: null,
          cleanupTimer: null
        };
        rooms.set(code, room);
        join(ws, room, data.name, lang);
        break;
      }
      case 'room_join': {
        const code = String(data.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const room = rooms.get(code);
        if (!room) { send(ws, { type: 'room_error', code: 'not_found', message: 'Room ' + code + ' was not found. Check the code and try again.' }); return; }
        leave(ws);
        if (room.members.size >= MAX_MEMBERS) { send(ws, { type: 'room_error', code: 'full', message: 'This room is full (' + MAX_MEMBERS + ' people).' }); return; }
        join(ws, room, data.name, cleanLang(data.lang));
        break;
      }
      case 'room_set_lang': {
        const c = ctxOf(ws);
        if (!c) return;
        c.m.lang = cleanLang(data.lang);
        if (c.m.micOn) {
          stopStream(c.m);
          c.m.micOn = false;
          send(ws, { type: 'room_mic_stopped', reason: 'lang', message: 'Microphone stopped because you changed language. Tap the mic to continue.' });
        }
        broadcastMembers(c.room);
        break;
      }
      case 'room_mic_start': {
        const c = ctxOf(ws);
        if (!c) return;
        c.m.gen = Number(data.gen) || 0;
        c.m.micOn = true;
        try {
          startStream(c.room, c.m);
        } catch (err) {
          c.m.micOn = false;
          send(ws, { type: 'room_mic_stopped', reason: 'error', message: 'Could not start speech recognition: ' + err.message });
        }
        broadcastMembers(c.room);
        break;
      }
      case 'room_audio': {
        const c = ctxOf(ws);
        if (!c) return;
        const m = c.m;
        if (!m.micOn || !m.stream || Number(data.gen) !== m.gen || !data.audio) return;
        if (m.stream.writable) m.stream.write(Buffer.from(data.audio, 'base64'));
        break;
      }
      case 'room_mic_stop': {
        const c = ctxOf(ws);
        if (!c) return;
        stopStream(c.m);
        c.m.micOn = false;
        broadcastMembers(c.room);
        break;
      }
      case 'room_leave':
        leave(ws);
        break;
      case 'room_ping':
        send(ws, { type: 'room_pong' });
        break;
      default:
        break;
    }
  }

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let data;
      try { data = JSON.parse(raw); } catch (e) { return; }
      if (!data || typeof data.type !== 'string' || data.type.indexOf('room_') !== 0) return;
      try {
        handle(ws, data);
      } catch (err) {
        console.error('Room handler error:', err);
        send(ws, { type: 'room_error', message: 'Something went wrong. Please try again.' });
      }
    });
    ws.on('close', () => leave(ws));
  });
};
