// index.js – Fully‑featured Railway GHL Proxy  (v1.5.2)
// -----------------------------------------------------------------------------
// ✅  Location‑centric API – /locations/:locationId/products & /media
// ✅  JWT gatekeeper (+ /api/auth/token)
// ✅  Automatic access‑token refresh with scheduled pre‑emptive refresh
// ✅  OAuth callback – stores new installs (in‑memory for now)
// ✅  Multer multi‑image upload  (≤10 files, 25 MB each)
// ✅  Legacy routes return 410 Gone
// ✅  Immediate app.listen() so Replit proxy maps PORT quickly
// -----------------------------------------------------------------------------
//  Requirements (package.json):
//    "express", "cors", "multer", "form-data", "axios", "jsonwebtoken", "node-cron"
// -----------------------------------------------------------------------------

/* eslint-disable no-console */

// ── 1. Imports & env ----------------------------------------------------------
const express   = require('express');
const cors      = require('cors');
const multer    = require('multer');
const FormData  = require('form-data');
const axios     = require('axios');
const jwt       = require('jsonwebtoken');
const cron      = require('node-cron');
const path      = require('path');
require('dotenv').config();

const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';
const SECRET = process.env.INTERNAL_JWT_SECRET || 'super‑secret‑dev‑key';
const REFRESH_BUFFER_MS = 60_000; // refresh 60 s before expiry

const app = express();

// ── 2. Middleware: CORS, parsers, static, health -----------------------------
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.send('OK'));

// ── 3. In‑memory installation store & helpers --------------------------------
/**
 * installation = {
 *   id, locationId, accessToken, refreshToken, expiresAt, orgName?, userEmail?,
 *   refreshing?: Promise<string>
 * }
 */
const installations = new Map();

// seed install for smoke tests
if (process.env.GHL_ACCESS_TOKEN && process.env.GHL_LOCATION_ID) {
  installations.set('install_seed', {
    id:           'install_seed',
    locationId:   process.env.GHL_LOCATION_ID,
    accessToken:  process.env.GHL_ACCESS_TOKEN,
    refreshToken: process.env.GHL_REFRESH_TOKEN || null,
    expiresAt:    Date.now() + 8.64e7,
    orgName:      'Seed Install',
  });
}

function byLocation(locationId) {
  return Array.from(installations.values()).find(i => i.locationId === locationId);
}

// ── 4. OAuth callback – stores/updates token bundle --------------------------
app.get('/api/oauth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');

  try {
    const { data } = await axios.post('https://services.leadconnectorhq.com/oauth/token', {
      client_id:     process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
      grant_type:    'authorization_code',
      code,
    });

    const instId = data.installationId || `inst_${data.locationId}`;
    installations.set(instId, {
      id:           instId,
      locationId:   data.locationId,
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      expiresAt:    Date.now() + data.expires_in * 1000,
      orgName:      data.orgName,
      userEmail:    data.userEmail,
    });
    console.log(`[oauth] stored installation ${data.locationId}`);
    res.redirect('/oauth-success.html');
  } catch (err) {
    console.error('[oauth] error', err.response?.data || err.message);
    res.status(500).send('OAuth flow failed');
  }
});

// ── 5. JWT gatekeeper & token‑mint route ------------------------------------
function requireJWT(req, res, next) {
  try {
    const raw = (req.headers.authorization || '').split(' ')[1];
    jwt.verify(raw, SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'JWT invalid or missing' });
  }
}

app.post('/api/auth/token', (req, res) => {
  const token = jwt.sign(
    { sub: 'replit-agent', role: req.body?.role || 'merchant' },
    SECRET,
    { expiresIn: '8h' },
  );
  res.json({ jwt: token });
});

// ── 6. Token‑refresh helpers --------------------------------------------------
async function refreshAccessToken(inst) {
  console.log('[refresh] refreshing token for', inst.locationId);
  const { data } = await axios.post('https://services.leadconnectorhq.com/oauth/token', {
    client_id:     process.env.GHL_CLIENT_ID,
    client_secret: process.env.GHL_CLIENT_SECRET,
    grant_type:    'refresh_token',
    refresh_token: inst.refreshToken,
  });
  Object.assign(inst, {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token ?? inst.refreshToken,
    expiresAt:    Date.now() + data.expires_in * 1000,
  });
  return inst.accessToken;
}

async function ensureFresh(inst) {
  if (inst.expiresAt > Date.now() + REFRESH_BUFFER_MS) return inst.accessToken;
  if (inst.refreshing) return inst.refreshing;
  inst.refreshing = refreshAccessToken(inst).finally(() => delete inst.refreshing);
  return inst.refreshing;
}

// scheduled global refresh safety‑net (runs every hour)
cron.schedule('0 * * * *', async () => {
  for (const inst of installations.values()) {
    if (inst.expiresAt < Date.now() + 10 * 60 * 1000) { // < 10 min
      try { await ensureFresh(inst); } catch (e) { console.error('[cron refresh]', e.message); }
    }
  }
});

// ── 7. Multer setup for image upload ----------------------------------------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ── 8. JWT‑protected API routes ---------------------------------------------
const router = express.Router();
router.use(requireJWT);
app.use('/api/ghl', router);

// 8.1 Media upload
router.post('/locations/:locationId/media', upload.array('file', 10), async (req, res) => {
  const inst = byLocation(req.params.locationId);
  if (!inst) return res.status(404).json({ error: 'locationId unknown' });

  await ensureFresh(inst);
  const uploaded = [];
  try {
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

// ── 9. Legacy routes return 410 ---------------------------------------------
app.all(['/api/ghl/products', '/api/ghl/products/*'], (_, res) => res
