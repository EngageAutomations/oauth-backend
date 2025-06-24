// index.js – Railway GoHighLevel Proxy (v1.6.0)
// ---------------------------------------------------------------------------
// • Location‑centric API  →  /locations/:locationId/products & /media
// • JWT gatekeeper        →  /api/auth/token
// • Env‑driven config     →  fails fast if critical vars are missing
// • Automatic token‑refresh (+ hourly cron safety‑net)
// • OAuth callback        →  stores installs (in‑memory)
// • Multer multi‑image upload (≤10 × 25 MB)
// • Legacy routes         →  410 Gone
// • Fast app.listen()     →  health‑checks pass within 1 s
// ---------------------------------------------------------------------------
/* eslint-disable no-console */

// ── 1. Imports & env ---------------------------------------------------------
import 'dotenv/config';                       // .env in dev, no‑op in prod
import express  from 'express';
import cors     from 'cors';
import multer   from 'multer';
import FormData from 'form-data';
import axios    from 'axios';
import jwt      from 'jsonwebtoken';
import cron     from 'node-cron';
import path     from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT   = process.env.PORT || 5000;
const HOST   = process.env.HOST || '0.0.0.0';
const SECRET = process.env.INTERNAL_JWT_SECRET;
const REFRESH_BUFFER_MS = 60_000; // refresh 60 s before expiry

// Fail fast if critical secrets missing
['GHL_CLIENT_ID', 'GHL_CLIENT_SECRET', 'INTERNAL_JWT_SECRET'].forEach(k => {
  if (!process.env[k]) {
    console.error(`❌ Missing env var ${k}`);
    process.exit(1);
  }
});

const app = express();

// ── 2. Middleware & health ---------------------------------------------------
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.send('OK'));

// ── 3. Installations map -----------------------------------------------------
/** @type {Map<string, import('./types').Installation>} */
const installations = new Map();

if (process.env.GHL_ACCESS_TOKEN && process.env.GHL_LOCATION_ID) {
  installations.set('seed', {
    id: 'seed',
    locationId: process.env.GHL_LOCATION_ID,
    accessToken: process.env.GHL_ACCESS_TOKEN,
    refreshToken: process.env.GHL_REFRESH_TOKEN || null,
    expiresAt: Date.now() + 8.64e7,
    orgName: 'Seed Install',
  });
}

const byLocation = loc => Array.from(installations.values()).find(i => i.locationId === loc);

// ── 4. OAuth callback --------------------------------------------------------
app.get('/api/oauth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');
  try {
    const { data } = await axios.post('https://services.leadconnectorhq.com/oauth/token', {
      client_id: process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
    });
    const id = data.installationId || `inst_${data.locationId}`;
    installations.set(id, {
      id,
      locationId: data.locationId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      orgName: data.orgName,
      userEmail: data.userEmail,
    });
    console.info('[oauth] stored install', data.locationId);
    res.redirect('/oauth-success.html');
  } catch (err) {
    console.error('[oauth] error', err.response?.data || err.message);
    res.status(500).send('OAuth failed');
  }
});

// ── 5. JWT gatekeeper & token mint ------------------------------------------
function requireJWT(req, res, next) {
  try {
    const raw = (req.headers.authorization || '').split(' ')[1];
    jwt.verify(raw, SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'JWT invalid or missing' });
  }
}

app.post('/api/auth/token', (req, res) => {
  const token = jwt.sign({ sub: 'replit-agent', role: req.body?.role || 'merchant' }, SECRET, { expiresIn: '8h' });
  res.json({ jwt: token });
});

// ── 6. Token refresh helpers -------------------------------------------------
async function refreshAccessToken(inst) {
  const { data } = await axios.post('https://services.leadconnectorhq.com/oauth/token', {
    client_id: process.env.GHL_CLIENT_ID,
    client_secret: process.env.GHL_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: inst.refreshToken,
  });
  Object.assign(inst, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? inst.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return inst.accessToken;
}

async function ensureFresh(inst) {
  if (inst.expiresAt > Date.now() + REFRESH_BUFFER_MS) return inst.accessToken;
  if (inst.refreshing) return inst.refreshing;
  inst.refreshing = refreshAccessToken(inst).finally(() => delete inst.refreshing);
  return inst.refreshing;
}

cron.schedule('0 * * * *', () => {
  installations.forEach(inst => {
    if (inst.expiresAt < Date.now() + 10 * 60 * 1000) ensureFresh(inst).catch(e => console.error('[cron]', e.message));
  });
});

// ── 7. Multer setup ----------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ── 8. API router (JWT‑protected) -------------------------------------------
const router = express.Router();
router.use(requireJWT);
app.use('/api/ghl', router);

// 8.1 Media upload
router.post('/locations/:locationId/media', upload.array('file', 10), async (req, res) => {
  const inst = byLocation(req.params.locationId);
  if (!inst) return res.status(404).json({ error: 'locationId unknown' });
  await ensureFresh(inst);
  try {
    const uploaded = [];
    for (const f of req.files) {
      const fd = new FormData();
      fd.append('file', f.buffer, { filename: f.originalname, contentType: f.mimetype });
      const { data } = await axios.post('https://services.leadconnectorhq.com/medias/upload-file', fd, {
        headers: { Authorization: `Bearer ${inst.accessToken}`, Version: '2021-07-28', ...fd.getHeaders() },
        timeout: 20000,
      });
      uploaded.push(data);
    }
    res.json({ uploaded });
  } catch (err) {
    console.error('[media] error', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: 'media upload failed', details: err.response?.data });
  }
});

// 8.2 Product creation
router.post('/locations/:locationId/products', async (req, res) => {
  const inst = byLocation(req.params.locationId);
  if (!inst) return res.status(404).json({ error: 'locationId unknown' });
  await ensureFresh(inst);
  try {
    const { data, status } = await axios.post('https://services.leadconnectorhq.com/products/', req.body, {
      headers: {
        Authorization: `Bearer ${inst.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Version: '2021-07-28',
      },
      timeout: 15000,
    });
    res.status(status).send(data);
  } catch (err) {
    console.error('[product] error', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: 'product create failed', details: err.response?.data });
  }
});

// ── 9. Legacy routes → 410 Gone --------------------------------------------
['/api/ghl/products', '/api/ghl/products/*', '/api/ghl/media', '/api/ghl/media/*'].forEach(p =>
  app.all(p, (_, res
