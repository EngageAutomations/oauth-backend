// updated-index.js – Complete Railway GHL Proxy (v1.5.0)
// ------------------------------------------------------------
// * Location‑centric API (products + media)
// * JWT gatekeeper & token refresh
// * OAuth callback + installation storage
// * Multer multi‑image upload (≤ 10 × 25 MB)
// * Legacy routes return 410 (deprecated)
// * Immediate listen to satisfy Replit probe
// ------------------------------------------------------------

/* eslint-disable no-console */

// ── 1. Imports & env ─────────────────────────────────────────
const express     = require('express');
const cors        = require('cors');
const multer      = require('multer');
const FormData    = require('form-data');
const axios       = require('axios');
const jwt         = require('jsonwebtoken');
const path        = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

// ── 2. Middleware: CORS, parsers, static ────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // React build if present
app.get('/health', (_, res) => res.send('OK'));

// ── 3. Installation store (in‑mem + helper funcs) ───────────
/**
 * installation schema ≈ {
 *   id, locationId, accessToken, refreshToken, expiresAt,
 *   orgName?, userEmail?
 * }
 */
const installations = new Map();

// seed from env so we can smoke‑test without OAuth first
if (process.env.GHL_ACCESS_TOKEN && process.env.GHL_LOCATION_ID) {
  installations.set('install_seed', {
    id:          'install_seed',
    locationId:   process.env.GHL_LOCATION_ID,
    accessToken:  process.env.GHL_ACCESS_TOKEN,
    refreshToken: process.env.GHL_REFRESH_TOKEN || null,
    expiresAt:    Date.now() + 8.64e7, // 24 h
    orgName:     'Seed Install',
  });
}

function getByLocation(id) {
  return Array.from(installations.values()).find(i => i.locationId === id);
}

// ── 4. OAuth callback (stores new tokens) ───────────────────
app.get('/api/oauth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing code');

    const body = {
      client_id:     process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
      grant_type:    'authorization_code',
      code
    };

    const { data } = await axios.post('https://services.leadconnectorhq.com/oauth/token', body);
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
    console.log('[oauth] stored new installation', data.locationId);
    res.redirect('/oauth-success.html');
  } catch (err) {
    console.error('[oauth] callback error', err.response?.data || err.message);
    res.status(500).send('OAuth failed');
  }
});

// ── 5. JWT helper & auth route ──────────────────────────────
const SECRET = process.env.INTERNAL_JWT_SECRET || 'dev-secret';
function requireJWT(req, res, next) {
  try {
    const raw = (req.headers.authorization || '').split(' ')[1];
    jwt.verify(raw, SECRET);
    next();
  } catch (_) {
    res.status(401).json({ error: 'JWT invalid or missing' });
  }
}

app.post('/api/auth/token', (req, res) => {
  const token = jwt.sign(
    { sub: 'replit-agent', role: req.body?.role || 'merchant' },
    SECRET,
    { expiresIn: '8h' }
  );
  res.json({ jwt: token });
});

// ── 6. Access‑token refresh logic ───────────────────────────
async function refreshAccessToken(inst) {
  const body = {
    client_id:     process.env.GHL_CLIENT_ID,
    client_secret: process.env.GHL_CLIENT_SECRET,
    grant_type:    'refresh_token',
    refresh_token: inst.refreshToken,
  };
  const { data } = await axios.post('https://services.leadconnectorhq.com/oauth/token', body);
  Object.assign(inst, {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token ?? inst.refreshToken,
    expiresAt:    Date.now() + data.expires_in * 1000,
  });
  console.info('[refresh] success for', inst.locationId);
  return inst.accessToken;
}

async function ensureFreshToken(inst) {
  const buffer = 60_000; // 60 s head‑room
  if (inst.expiresAt > Date.now() + buffer) return inst.accessToken;
  if (inst.refreshing) return inst.refreshing;
  inst.refreshing = refreshAccessToken(inst).finally(() => delete inst.refreshing);
  return inst.refreshing;
}

// ── 7. Multer for multipart image upload ────────────────────
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ── 8. API router (JWT protected) ───────────────────────────
const router = express.Router();
router.use(requireJWT);
app.use('/api/ghl', router);

// 8.1 Multi-image upload
router.post('/locations/:locationId/media', uploadMem.array('file', 10), async (req, res) => {
  const inst = getByLocation(req.params.locationId);
  if (!inst) return res.status(404).json({ error: 'unknown locationId' });

  await ensureFreshToken(inst);
  const results = [];
  try {
    for (const f of req.files) {
      const fd = new FormData();
      fd.append('file', f.buffer, { filename: f.originalname, contentType: f.mimetype });
      const { data } = await axios.post('https://services.leadconnectorhq.com/medias/upload-file', fd, {
        headers: { Authorization: `Bearer ${inst.accessToken}`, Version: '2021-07-28', ...fd.getHeaders() },
        timeout: 20000,
      });
      results.push(data);
    }
    res.json({ uploaded: results });
  } catch (err) {
    console.error('[media] error', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: 'upload failed', details: err.response?.data });
  }
});

// 8.2 Product create
router.post('/locations/:locationId/products', async (req, res) => {
  const inst = getByLocation(req.params.locationId);
  if (!inst) return res.status(404).json({ error: 'unknown locationId' });
  await ensureFreshToken(inst);

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

// ── 9. Legacy endpoints → 410 Gone ──────────────────────────
app.all('/api/ghl/products/*', (_, res) => res.status(410).json({ error: 'Route deprecated — use /locations/:locationId/products' }));
app.all('/api/ghl/media/*',    (_, res) => res.status(410).json({ error: 'Route deprecated — use /locations/:locationId/media' }));

// ── 10. Start server fast so Replit proxy stays mapped ─────
app.listen(PORT, HOST, () => console.log(`🟢 Express bound http://${HOST}:${PORT}`));

// heavy bootstrap async but non-blocking
(async () => {
  console.log('Bootstrapping (DB, schedulers)…');
  // await connectDB(); // if you have DB
  console.log('✅ GHL proxy ready');
})();
