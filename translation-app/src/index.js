const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const speech = require('@google-cloud/speech');
const {Translate} = require('@google-cloud/translate').v2;
const {Firestore, FieldValue} = require('@google-cloud/firestore');
const {PubSub} = require('@google-cloud/pubsub');
const {v4: uuidv4} = require('uuid');
const cors = require('cors');
const LATEST_LONG = new Set(['en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'hi-IN', 'ja-JP', 'zh-CN']);

const speechClient = new speech.SpeechClient();
const translateClient = new Translate();
const firestore = new Firestore();
const pubsub = new PubSub();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString(), version: '1.0.0' });
});

app.get('/api/analytics', async (req, res) => {
  try {
    const limitParam = parseInt(req.query.limit, 10);
    let query = firestore.collection('conversations').orderBy('createdAt', 'desc');
    if (!isNaN(limitParam) && limitParam > 0) {
      query = query.limit(limitParam);
    }
    const snapshot = await query.get();
    const languageCounts = {};
    const confidenceOverTime = [];
    const sessionWordCounts = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      const messages = data.messages || [];
      let totalChars = 0;

      messages.forEach((msg) => {
        Object.keys(msg.translations || {}).forEach((lang) => {
          languageCounts[lang] = (languageCounts[lang] || 0) + 1;
        });
        if (msg.confidence !== undefined && msg.timestamp) {
          const ts = msg.timestamp.toDate ? msg.timestamp.toDate().toISOString() : msg.timestamp;
          confidenceOverTime.push({ timestamp: ts, confidence: msg.confidence });
        }
        totalChars += (msg.originalText || '').length;
      });

      sessionWordCounts.push({ sessionId: data.sessionId, characterCount: totalChars, messageCount: messages.length });
    });

    confidenceOverTime.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const totalMessages = sessionWordCounts.reduce((sum, s) => sum + s.messageCount, 0);
    const avgConfidence = confidenceOverTime.length
      ? confidenceOverTime.reduce((sum, d) => sum + d.confidence, 0) / confidenceOverTime.length
      : 0;
    const topLanguage = Object.entries(languageCounts).sort((a, b) => b[1] - a[1])[0];

    const summary = {
      totalSessions: snapshot.size,
      totalMessages,
      avgConfidence,
      topLanguage: topLanguage ? topLanguage[0] : null
    };

    res.status(200).json({ languageCounts, confidenceOverTime, sessionWordCounts, summary });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics', details: error.message });
  }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const snapshot = await firestore.collection('conversations').orderBy('createdAt', 'desc').limit(50).get();
    const sessions = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        sessionId: data.sessionId,
        sourceLanguage: data.sourceLanguage,
        targetLanguages: data.targetLanguages,
        createdAt: data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
        messageCount: (data.messages || []).length,
        type: data.type || 'conversation',
        fileName: data.fileName || null
      };
    });
    res.status(200).json({ sessions });
  } catch (error) {
    console.error('Sessions list error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions', details: error.message });
  }
});

app.get('/api/session/:id', async (req, res) => {
  try {
    const doc = await firestore.collection('conversations').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Session not found' });
    const data = doc.data();
    const messages = (data.messages || []).map((m) => ({
      ...m,
      timestamp: m.timestamp && m.timestamp.toDate ? m.timestamp.toDate().toISOString() : m.timestamp
    }));
    res.status(200).json({ ...data, messages });
  } catch (error) {
    console.error('Session fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch session', details: error.message });
  }
});

app.delete('/api/session/:id', async (req, res) => {
  try {
    const docRef = firestore.collection('conversations').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Session not found' });
    await docRef.delete();
    res.status(200).json({ success: true, deletedId: req.params.id });
  } catch (error) {
    console.error('Session delete error:', error);
    res.status(500).json({ error: 'Failed to delete session', details: error.message });
  }
});
app.post('/api/translate-text', async (req, res) => {
  try {
    const { text, sourceLanguage, targetLanguages } = req.body;
    if (!text || !targetLanguages || !targetLanguages.length) {
      return res.status(400).json({ error: 'text and targetLanguages are required' });
    }
    const srcLang = (sourceLanguage || 'en-US').split('-')[0];
    const translations = {};
    for (const targetLang of targetLanguages) {
      try {
        const [translation] = await translateClient.translate(text, { from: srcLang, to: targetLang });
        translations[targetLang] = translation;
      } catch (err) {
        translations[targetLang] = '[Translation failed: ' + err.message + ']';
      }
    }
    const newSessionId = uuidv4();
    try {
      await firestore.collection('conversations').doc(newSessionId).set({
        sessionId: newSessionId,
        sourceLanguage: sourceLanguage || 'en-US',
        targetLanguages,
        createdAt: new Date(),
        type: 'text',
        messages: [{
          messageId: uuidv4(),
          originalText: text,
          translations,
          timestamp: new Date(),
          sourceLanguage: sourceLanguage || 'en-US'
        }]
      });
    } catch (saveErr) {
      console.error('Failed to save text translation:', saveErr);
    }
    res.status(200).json({ originalText: text, translations, sessionId: newSessionId });
  } catch (error) {
    console.error('Text translation error:', error);
    res.status(500).json({ error: 'Failed to translate', details: error.message });
  }
});
const MAX_DOC_CHARS = 30000;

function splitIntoSegments(text) {
  const segments = [];
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) { segments.push(''); return; }
    let remaining = trimmed;
    while (remaining.length > 4000) {
      let cut = remaining.lastIndexOf('. ', 4000);
      if (cut < 1000) cut = remaining.lastIndexOf(' ', 4000);
      if (cut < 1000) cut = 4000;
      segments.push(remaining.slice(0, cut + 1).trim());
      remaining = remaining.slice(cut + 1).trim();
    }
    if (remaining) segments.push(remaining);
  });
  return segments;
}

async function translateSegments(segments, targetLanguage) {
  const out = new Array(segments.length).fill('');
  let detected = null;
  let batch = [];
  let batchChars = 0;

  const flush = async () => {
    if (!batch.length) return;
    const [translated, apiResponse] = await translateClient.translate(
      batch.map((b) => b.text),
      { to: targetLanguage, format: 'text' }
    );
    const arr = Array.isArray(translated) ? translated : [translated];
    arr.forEach((t, k) => { out[batch[k].i] = t; });
    if (!detected && apiResponse && apiResponse.data && apiResponse.data.translations && apiResponse.data.translations[0]) {
      detected = apiResponse.data.translations[0].detectedSourceLanguage || null;
    }
    batch = [];
    batchChars = 0;
  };

  for (let i = 0; i < segments.length; i++) {
    if (!segments[i]) continue;
    const len = segments[i].length;
    if (batch.length >= 100 || batchChars + len > 8000) await flush();
    batch.push({ i, text: segments[i] });
    batchChars += len;
  }
  await flush();
  return { translatedSegments: out, detected };
}

app.post('/api/translate-document', async (req, res) => {
  try {
    const { fileName, text, targetLanguage } = req.body;
    if (!text || !String(text).trim() || !targetLanguage) {
      return res.status(400).json({ error: 'text and targetLanguage are required' });
    }
    if (text.length > MAX_DOC_CHARS) {
      return res.status(413).json({ error: 'Document too long (' + text.length + ' characters). The limit is ' + MAX_DOC_CHARS + '.' });
    }

    const segments = splitIntoSegments(text);
    const { translatedSegments, detected } = await translateSegments(segments, targetLanguage);
    const translatedText = translatedSegments.join('\n');

    const newSessionId = uuidv4();
    const sourceLanguage = detected || 'auto';
    try {
      await firestore.collection('conversations').doc(newSessionId).set({
        sessionId: newSessionId,
        sourceLanguage,
        targetLanguages: [targetLanguage],
        createdAt: new Date(),
        type: 'document',
        fileName: String(fileName || 'Untitled document').slice(0, 120),
        messages: [{
          messageId: uuidv4(),
          originalText: text,
          translations: { [targetLanguage]: translatedText },
          timestamp: new Date(),
          sourceLanguage
        }]
      });
    } catch (saveErr) {
      console.error('Failed to save document translation:', saveErr);
    }

    res.status(200).json({ translatedText, sessionId: newSessionId, detectedLanguage: sourceLanguage });
  } catch (error) {
    console.error('Document translation error:', error);
    res.status(500).json({ error: 'Failed to translate document', details: error.message });
  }
});

const DOC_TARGETS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'ar', 'hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa', 'ur', 'ja', 'ko', 'zh', 'id', 'vi', 'th'];
const ipUsage = new Map();

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xf.length ? xf[xf.length - 1] : ((req.socket && req.socket.remoteAddress) || 'unknown');
}

// Basic per-network guard on the new document endpoints (not a substitute for real accounts).
function allowUsage(req, chars) {
  const ip = clientIp(req);
  const now = Date.now();
  let u = ipUsage.get(ip);
  if (!u || now - u.start > 3600000) {
    u = { start: now, requests: 0, chars: 0 };
    ipUsage.set(ip, u);
  }
  u.requests += 1;
  u.chars += chars;
  return u.requests <= 400 && u.chars <= 300000;
}
setInterval(() => {
  const now = Date.now();
  ipUsage.forEach((u, ip) => { if (now - u.start > 3600000) ipUsage.delete(ip); });
}, 600000).unref();

app.post('/api/translate-batch', async (req, res) => {
  try {
    const { texts, targetLanguage, sourceLanguage } = req.body || {};
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > 120) {
      return res.status(400).json({ error: 'texts must be an array of 1 to 120 strings' });
    }
    const target = String(targetLanguage || '').split('-')[0].toLowerCase();
    if (DOC_TARGETS.indexOf(target) === -1) return res.status(400).json({ error: 'Unsupported target language' });
    const clean = texts.map((t) => (typeof t === 'string' ? t : ''));
    let total = 0;
    for (const t of clean) {
      if (t.length > 5000) return res.status(400).json({ error: 'A text segment is too long (max 5000 characters)' });
      total += t.length;
    }
    if (total > 12000) return res.status(413).json({ error: 'Batch too large (max 12000 characters)' });
    if (!allowUsage(req, total)) {
      return res.status(429).json({ error: 'Too many requests from your network. Please wait a few minutes and try again.' });
    }
    const idx = [];
    const payload = [];
    clean.forEach((t, i) => { if (t.trim()) { idx.push(i); payload.push(t); } });
    const out = new Array(clean.length).fill('');
    let detected = null;
    if (payload.length) {
      const opts = { to: target, format: 'text' };
      const src = sourceLanguage && sourceLanguage !== 'auto' ? String(sourceLanguage).split('-')[0].toLowerCase() : null;
      if (src) opts.from = src;
      const result = await translateClient.translate(payload, opts);
      const arr = Array.isArray(result[0]) ? result[0] : [result[0]];
      arr.forEach((t, k) => { out[idx[k]] = t; });
      const first = result[1] && result[1].data && result[1].data.translations && result[1].data.translations[0];
      detected = first && first.detectedSourceLanguage ? first.detectedSourceLanguage : null;
    }
    res.status(200).json({ translations: out, detectedLanguage: detected });
  } catch (error) {
    console.error('Batch translation error:', error);
    res.status(500).json({ error: 'Failed to translate', details: error.message });
  }
});

app.post('/api/documents', async (req, res) => {
  try {
    const { fileName, sourceLanguage, targetLanguage, originalText, translatedText } = req.body || {};
    const tgt = String(targetLanguage || '').split('-')[0].toLowerCase();
    if (DOC_TARGETS.indexOf(tgt) === -1 || typeof originalText !== 'string' || typeof translatedText !== 'string' || !originalText.trim()) {
      return res.status(400).json({ error: 'Invalid document data' });
    }
    if (originalText.length > 100000 || translatedText.length > 100000) {
      return res.status(413).json({ error: 'Document too large to save' });
    }
    if (!allowUsage(req, 0)) {
      return res.status(429).json({ error: 'Too many requests from your network. Please wait a few minutes and try again.' });
    }
    const id = uuidv4();
    const srcLang = String(sourceLanguage || 'auto').slice(0, 10);
    await firestore.collection('conversations').doc(id).set({
      sessionId: id,
      sourceLanguage: srcLang,
      targetLanguages: [tgt],
      createdAt: new Date(),
      type: 'document',
      fileName: String(fileName || 'Untitled document').slice(0, 120),
      messages: [{
        messageId: uuidv4(),
        originalText: originalText,
        translations: { [tgt]: translatedText },
        timestamp: new Date(),
        sourceLanguage: srcLang
      }]
    });
    res.status(200).json({ sessionId: id });
  } catch (error) {
    console.error('Document save error:', error);
    res.status(500).json({ error: 'Failed to save document', details: error.message });
  }
});

const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server, perMessageDeflate: false });
require('./rooms')(wss, { speechClient, translateClient, firestore, FieldValue, uuidv4 });
const activeSessions = new Map();

class TranslationSession {
  constructor(ws, sessionId, sourceLanguage, targetLanguages) {
    this.ws = ws;
    this.sessionId = sessionId;
    this.sourceLanguage = sourceLanguage;
    this.targetLanguages = targetLanguages;
    this.recognizeStream = null;
    this.conversationRef = firestore.collection('conversations').doc(sessionId);
    this.initializeConversation();
  }

  async initializeConversation() {
    try {
      await this.conversationRef.set({
        sessionId: this.sessionId,
        sourceLanguage: this.sourceLanguage,
        targetLanguages: this.targetLanguages,
        createdAt: new Date(),
        type: 'conversation',
        messages: []
      });
    } catch (error) {
      console.error('Failed to initialize conversation:', error);
      this.sendError('Failed to initialize conversation');
    }
  }

  startSpeechRecognition() {
    const request = {
      config: {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 48000,
        languageCode: this.sourceLanguage,
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
        ...(LATEST_LONG.has(this.sourceLanguage) ? { model: 'latest_long', useEnhanced: true } : {})
      },
      interimResults: true,
    };

    this.recognizeStream = speechClient
      .streamingRecognize(request)
      .on('data', async (data) => {
        if (data.results[0] && data.results[0].alternatives[0]) {
          const transcript = data.results[0].alternatives[0].transcript;
          const confidence = data.results[0].alternatives[0].confidence;
          const isFinal = data.results[0].isFinal;
          if (isFinal) {
            await this.handleTranscription(transcript, confidence);
          } else {
            this.ws.send(JSON.stringify({ type: 'interim_transcript', text: transcript, confidence, sessionId: this.sessionId }));
          }
        }
      })
      .on('error', (error) => {
        console.error('Speech recognition error:', error);
        this.sendError('Speech recognition failed', error.message);
      })
      .on('end', () => { console.log('Speech recognition stream ended'); });
  }

  async handleTranscription(originalText, confidence) {
    try {
      const messageId = uuidv4();
      const translations = {};
      for (const targetLang of this.targetLanguages) {
        try {
          const [translation] = await translateClient.translate(originalText, { from: String(this.sourceLanguage).split('-')[0], to: targetLang });
          translations[targetLang] = translation;
        } catch (translationError) {
          console.error(`Translation error for ${targetLang}:`, translationError);
          translations[targetLang] = `[Translation failed: ${translationError.message}]`;
        }
      }

      const messageData = { messageId, originalText, translations, confidence, timestamp: new Date(), sourceLanguage: this.sourceLanguage };
      await this.conversationRef.update({ messages: FieldValue.arrayUnion(messageData) });

      await pubsub.topic('translation-events').publish(Buffer.from(JSON.stringify({
        sessionId: this.sessionId, messageId, sourceLanguage: this.sourceLanguage, targetLanguages: this.targetLanguages,
        characterCount: originalText.length, confidence, timestamp: new Date().toISOString()
      })));

      this.ws.send(JSON.stringify({ type: 'translation_complete', messageId, originalText, translations, confidence, sessionId: this.sessionId }));
    } catch (error) {
      console.error('Translation error:', error);
      this.sendError('Translation failed', error.message);
    }
  }

  processAudioChunk(audioData) {
    if (this.recognizeStream && this.recognizeStream.writable) this.recognizeStream.write(audioData);
  }

  sendError(message, details = null) {
    this.ws.send(JSON.stringify({ type: 'error', message, details, sessionId: this.sessionId }));
  }

  endSession() {
    if (this.recognizeStream) this.recognizeStream.end();
    activeSessions.delete(this.sessionId);
  }
}

wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection established');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      switch (data.type) {
        case 'start_session': {
          const sessionId = uuidv4();
          const session = new TranslationSession(ws, sessionId, data.sourceLanguage || 'en-US', data.targetLanguages || ['es', 'fr', 'de']);
          activeSessions.set(sessionId, session);
          session.startSpeechRecognition();
          ws.send(JSON.stringify({ type: 'session_started', sessionId, sourceLanguage: session.sourceLanguage, targetLanguages: session.targetLanguages }));
          break;
        }
        case 'audio_data': {
          const activeSession = activeSessions.get(data.sessionId);
          if (activeSession && data.audio) activeSession.processAudioChunk(Buffer.from(data.audio, 'base64'));
          break;
        }
        case 'end_session': {
          const endSession = activeSessions.get(data.sessionId);
          if (endSession) {
            endSession.endSession();
            ws.send(JSON.stringify({ type: 'session_ended', sessionId: data.sessionId }));
          }
          break;
        }
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format', error: error.message }));
    }
  });

  ws.on('close', () => {
    for (const [sessionId, session] of activeSessions) {
      if (session.ws === ws) session.endSession();
    }
    console.log('WebSocket connection closed');
  });

  ws.on('error', (error) => { console.error('WebSocket error:', error); });
});

process.on('unhandledRejection', (err) => { console.error('Unhandled rejection:', err); });
process.on('uncaughtException', (err) => { console.error('Uncaught exception:', err); });

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => { console.log('Process terminated'); });
});

server.listen(PORT, () => { console.log(`Real-time translation service running on port ${PORT}`); });
