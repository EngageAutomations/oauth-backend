// index.js – GoHighLevel proxy with token‑refresh + *location‑centric* API (v1.4.7)
// ---------------------------------------------------------------------------
/* eslint-disable no-console */

const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const multer   = require('multer');
const FormData = require('form-data');
const fs       = require('fs');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Startup sanity log ------------------------------------------------------
console.log('Config check:', {
  CLIENT_ID: process.env.GHL_CLIENT_ID ? '[set]' : undefined,
  REDIRECT : process.env.GHL_REDIRECT_URI || '/api/oauth/callback'
});

// ── 1. Middleware & static ---------------------------------------------------
app.use(cors());
app.use(express.json({ limit:'50mb' }));
app.use(express.urlencoded({ extended:true, limit:'50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── 2. Installations store (in‑mem) ------------------------------------------
const installations = new Map();
if (process.env.GHL_ACCESS_TOKEN) {
  installations.set('install_seed', {
    id: 'install_seed',
    accessToken:  process.env.GHL_ACCESS_TOKEN,
    refreshToken: process.env.GHL_REFRESH_TOKEN || null,
    expiresIn:    86399,
    expiresAt:    Date.now() + 86399 * 1000,
    locationId:   process.env.GHL_LOCATION_ID || 'WAvk87RmW9rBSDJHeOpH',
    scopes:       process.env.GHL_SCOPES || 'products.write medias.write',
    tokenStatus:  'valid',
    createdAt:    new Date().toISOString()
  });
}

// ── 3. Token lifecycle helpers ----------------------------------------------
const PADDING_MS   = 5 * 60 * 1000; // refresh 5 min early
const refreshTimers = new Map();    // installId → timerId

async function refreshAccessToken(id) {
  const inst = installations.get(id);
  if (!inst || !inst.refreshToken) return;
  try {
    const body = new URLSearchParams({
      client_id:     process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: inst.refreshToken
    });
    const { data } = await axios.post('https://services.leadconnectorhq.com/oauth/token', body, {
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, timeout:15000 });
    Object.assign(inst, {
      accessToken:  data.access_token,
      refreshToken:data.refresh_token || inst.refreshToken,
      expiresIn:   data.expires_in,
      expiresAt:   Date.now() + data.expires_in*1000,
      tokenStatus: 'valid'
    });
    scheduleRefresh(id);
    console.log(`[REFRESH] ${id} ok → ${(data.expires_in/3600).toFixed(1)}h`);
  } catch(e) {
    console.error(`[REFRESH-FAIL] ${id}`, e.response?.data || e.message);
    inst.tokenStatus = 'invalid';
  }
}

function scheduleRefresh(id) {
  clearTimeout(refreshTimers.get(id));
  const inst = installations.get(id);
  if (!inst || !inst.expiresAt) return;
  const delay = Math.max(inst.expiresAt - Date.now() - PADDING_MS, 0);
  const t = setTimeout(()=>refreshAccessToken(id), delay);
  refreshTimers.set(id, t);
}

async function ensureFreshToken(id) {
  const inst = installations.get(id);
  if (!inst) throw new Error('Unknown installation');
  if (inst.expiresAt - Date.now() < PADDING_MS) await refreshAccessToken(id);
  if (inst.tokenStatus !== 'valid') throw new Error('Token invalid');
}

// ── 4. Helper: grab install from header/query --------------------------------
function getInstallFromReq(req, res) {
  const installationId = req.headers['x-installation-id'] || req.query.installation_id || req.body.installation_id;
  const inst = installations.get(installationId);
  if (!inst) {
    res.status(400).json({ success:false, error:`Installation not found: ${installationId}` });
    return null;
  }
  return inst;
}

// ── 5. Basic routes ----------------------------------------------------------
app.get('/', (_,res)=>res.json({ service:'GHL proxy', version:'1.4.7', installs:installations.size, ts:Date.now() }));
app.get('/health',(_,res)=>res.json({ ok:true, ts:Date.now() }));

// ── 6. FULL OAUTH FLOW -------------------------------------------------------
async function exchangeCode(code, redirectUri) {
  const body = new URLSearchParams({
    client_id:     process.env.GHL_CLIENT_ID,
    client_secret: process.env.GHL_CLIENT_SECRET,
    grant_type:    'authorization_code',
    code,
    redirect_uri:  redirectUri
  });
  const { data } = await axios.post('https://services.leadconnectorhq.com/oauth/token', body, {
    headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, timeout:15000 });
  return data;
}
function storeInstall(tokenData) {
  const id = `inst_${tokenData.locationId}_${Date.now()}`;
  installations.set(id, {
    id,
    accessToken:  tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresIn:    tokenData.expires_in,
    expiresAt:    Date.now() + tokenData.expires_in*1000,
    locationId:   tokenData.locationId,
    scopes:       tokenData.scope,
    tokenStatus:  'valid',
    createdAt:    new Date().toISOString()
  });
  scheduleRefresh(id);
  return id;
}

app.get(['/oauth/callback','/api/oauth/callback'], async (req,res)=>{
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');
  try {
    const redirectUri = req.path.startsWith('/api')
      ? (process.env.GHL_REDIRECT_URI || 'https://dir.engageautomations.com/api/oauth/callback')
      : (process.env.GHL_REDIRECT_URI || 'https://dir.engageautomations.com/oauth/callback');
    const tokenData = await exchangeCode(code, redirectUri);
    const installId = storeInstall(tokenData);
    res.redirect(`https://listings.engageautomations.com/?installation_id=${installId}&welcome=true`);
  } catch(e) {
    console.error('OAuth error', e.response?.data || e.message);
    res.status(500).send('OAuth failed');
  }
});

app.get('/api/oauth/status', (req,res)=>{
  const inst = installations.get(req.query.installation_id);
  if (!inst) return res.json({ authenticated:false });
  res.json({ authenticated:true, tokenStatus:inst.tokenStatus, locationId:inst.locationId });
});

// ── 7. Legacy routes remain unchanged (products/create, media/upload, etc.) --

// ── 8. LOCATION-CENTRIC ROUTES ---------------------------------------------
const memUpload = multer({ storage: multer.memoryStorage(), limits:{ fileSize:25*1024*1024 } });
app.post('/api/ghl/locations/:locationId/media', memUpload.array('file', 10), async (req,res)=>{
  const { locationId } = req.params;
  const inst = Array.from(installations.values()).find(i => i.locationId === locationId);
  if (!inst) return res.status(404).json({ success:false, error:`Unknown locationId ${locationId}` });
  try {
    await ensureFreshToken(inst.id);
    const results = [];
    for (const f of req.files) {
      const form = new FormData();
      form.append('file', f.buffer, { filename:f.originalname, contentType:f.mimetype });
      const { data } = await axios.post('https://services.leadconnectorhq.com/medias/upload-file', form, {
        headers:{ ...form.getHeaders(), Authorization:`Bearer ${inst.access
