// index.js – GoHighLevel integration w/ automatic token refresh + media upload proxy

const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const multer   = require('multer');          // parses inbound multipart from browser
const FormData = require('form-data');       // builds outbound multipart to GHL
const fs       = require('fs');

const app  = express();
const port = process.env.PORT || 3000;

// ───────────────────────────────────────────────────────
// Middleware
// ───────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ───────────────────────────────────────────────────────
// In‑memory installation store (use DB/Redis in prod)
// ───────────────────────────────────────────────────────
const installations = new Map();

// Seeded install so the app works before first OAuth round‑trip
if (process.env.GHL_ACCESS_TOKEN) {
  installations.set('install_seed', {
    id: 'install_seed',
    accessToken: process.env.GHL_ACCESS_TOKEN,
    refreshToken: process.env.GHL_REFRESH_TOKEN || null,
    expiresIn: 86399,
    expiresAt: Date.now() + 86399 * 1000,
    locationId: process.env.GHL_LOCATION_ID || 'WAvk87RmW9rBSDJHeOpH',
    scopes: process.env.GHL_SCOPES || 'medias.write medias.readonly',
    tokenStatus: 'valid',
    createdAt: new Date().toISOString()
  });
}

// ───────────────────────────────────────────────────────
// TOKEN‑REFRESH HELPERS (single source of truth)
// ───────────────────────────────────────────────────────
const DEFAULT_REFRESH_PADDING_MS = 5 * 60 * 1000;  // refresh 5 min early
const refreshTimers = new Map();

async function refreshAccessToken (installationId) {
  const inst = installations.get(installationId);
  if (!inst || !inst.refreshToken) return;

  try {
    const formData = new URLSearchParams({
      client_id:     process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: inst.refreshToken
    });

    const { data } = await axios.post(
      'https://services.leadconnectorhq.com/oauth/token',
      formData,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    );

    inst.accessToken  = data.access_token;
    inst.refreshToken = data.refresh_token || inst.refreshToken; // sometimes unchanged
    inst.expiresIn    = data.expires_in;
    inst.expiresAt    = Date.now() + data.expires_in * 1000;
    inst.tokenStatus  = 'valid';

    scheduleTokenRefresh(installationId);
    console.log(`[REFRESH] ${installationId} – token good for ${ (data.expires_in/3600).toFixed(1) } h`);
  } catch (err) {
    console.error(`[REFRESH‑FAIL] ${installationId}`, err.response?.data || err.message);
    inst.tokenStatus = 'invalid';
  }
}

function scheduleTokenRefresh (installationId) {
  clearTimeout(refreshTimers.get(installationId));

  const inst = installations.get(installationId);
  if (!inst || !inst.expiresAt) return;

  const msUntil = Math.max(inst.expiresAt - Date.now() - DEFAULT_REFRESH_PADDING_MS, 0);
  const t = setTimeout(() => refreshAccessToken(installationId), msUntil);
  refreshTimers.set(installationId, t);
}

async function ensureFreshToken (installationId) {
  const inst = installations.get(installationId);
  if (!inst) throw new Error('Unknown installation');

  if (!inst.expiresAt || inst.expiresAt - Date.now() < DEFAULT_REFRESH_PADDING_MS) {
    await refreshAccessToken(installationId);
  }
  if (inst.tokenStatus !== 'valid') {
    throw new Error('Access token invalid / refresh failed');
  }
}

// ───────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────
function requireInstall (req, res) {
  const installationId = req.method === 'GET' ? req.query.installation_id : req.body.installationId;
  const inst = installations.get(installationId);
  if (!inst || !inst.accessToken) {
    res.status(400).json({
      success: false,
      error: `Access token not available for installation: ${installationId}`,
      availableInstallations: Array.from(installations.keys())
    });
    return null;
  }
  return inst;
}

// ───────────────────────────────────────────────────────
// Basic endpoints
// ───────────────────────────────────────────────────────
app.get('/', (req, res)=>{
  res.json({ service:'GoHighLevel API Backend', version:'1.3.0', status:'running', timestamp:new Date().toISOString(), activeInstallations: installations.size });
});

app.get('/health', (req,res)=>{
  res.json({ status:'healthy', timestamp:new Date().toISOString(), installs: installations.size });
});

// ───────────────────────────────────────────────────────
// OAuth flow
// ───────────────────────────────────────────────────────
async function exchangeCodeForToken (code, redirectUri) {
  const form = new URLSearchParams({
    client_id: process.env.GHL_CLIENT_ID,
    client_secret: process.env.GHL_CLIENT_SECRET,
    grant_type:'authorization_code',
    code,
    redirect_uri: redirectUri
  });
  const { data } = await axios.post('https://services.leadconnectorhq.com/oauth/token', form, { headers:{'Content-Type':'application/x-www-form-urlencoded'}, timeout:15000 });
  return data;
}

function finishOAuth (redirectBase) {
  return async (tokenData, res) => {
    const installationId = `install_${Date.now()}`;

    installations.set(installationId, {
      id: installationId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      locationId: tokenData.locationId || 'WAvk87RmW9rBSDJHeOpH',
      scopes: tokenData.scope || '',
      tokenStatus: 'valid',
      createdAt: new Date().toISOString()
    });

    scheduleTokenRefresh(installationId);

    const url = `${redirectBase}?installation_id=${installationId}&welcome=true`;
    res.redirect(url);
  };
}

app.get('/oauth/callback', async (req, res)=>{
  const { code } = req.query;
  if (!code) return res.status(400).json({ error:'Authorization code required' });
  try {
    const tokenData = await exchangeCodeForToken(code, process.env.GHL_REDIRECT_URI || 'https://dir.engageautomations.com/oauth/callback');
    await finishOAuth('https://listings.engageautomations.com/')(tokenData, res);
  } catch(e) {
    console.error('OAuth error', e.response?.data || e.message);
    res.status(500).json({ error:'OAuth failed', details: e.response?.data || e.message });
  }
});

app.get('/api/oauth/callback', async (req, res)=>{
  const { code } = req.query;
  if (!code) return res.status(400).json({ error:'Authorization code required' });
  try {
    const tokenData = await exchangeCodeForToken(code, process.env.GHL_REDIRECT_URI || 'https://dir.engageautomations.com/api/oauth/callback');
    await finishOAuth('https://listings.engageautomations.com/')(tokenData, res);
  } catch(e) {
    console.error('OAuth error', e.response?.data || e.message);
    res.status(500).json({ error:'OAuth failed', details: e.response?.data || e.message });
  }
});

app.get('/api/oauth/status', (req,res)=>{
  const inst = installations.get(req.query.installation_id);
  if (!inst) return res.json({ authenticated:false, message:'Installation not found' });
  res.json({ authenticated:true, installationId: inst.id, locationId: inst.locationId, scopes: inst.scopes, tokenStatus: inst.tokenStatus, hasAccessToken: !!inst.accessToken });
});

// ───────────────────────────────────────────────────────
// GHL proxy routes
// ───────────────────────────────────────────────────────
app.get('/api/ghl/test-connection', async (req,res)=>{
  const inst = requireInstall(req,res); if (!inst) return;
  try {
    await ensureFreshToken(inst.id);
    const { data } = await axios.get(`https://services.leadconnectorhq.com/locations/${inst.locationId}`,{
      headers:{ Authorization:`Bearer ${inst.accessToken}`, Version:'2021-07-28', Accept:'application/json' }, timeout:15000 });
    res.json({ success:true, message:'Connection OK', locationData:data });
  } catch(e) {
    res.status(400).json({ success:false, error:'Connection failed', details: e.response?.data || e.message });
  }
});

app.post('/api/ghl/products/create', async (req,res)=>{
  const inst = requireInstall(req,res); if (!inst) return;
  const { name, description, price, productType='DIGITAL' } = req.body;
  const product = { name, description, locationId: inst.locationId, productType, availableInStore:true };
  if (price && !isNaN(parseFloat(price))) product.price = parseFloat(price);
  try {
    await ensureFreshToken(inst.id);
    const { data } = await axios.post('https://services.leadconnectorhq.com/products/', product, {
      headers:{ Authorization:`Bearer ${inst.accessToken}`, 'Content-Type':'application/json', Version:'2021-07-28', Accept:'application/json' }, timeout:15000 });
    res.json({ success:true, product:data.product, productId:data.product?.id });
  } catch(e) {
    res.status(400).json({ success:false, error:'Product creation failed', details:e.response?.data || e.message });
  }
});

app.get('/api/ghl/products', async (req,res)=>{
  const inst = requireInstall(req,res); if (!inst) return;
  const { limit=20, offset=0 } = req.query;
  try {
    await ensureFreshToken(inst.id);
    const { data } = await axios.get(`https://services.leadconnectorhq.com/products/?locationId=${inst.locationId}&limit=${limit}&offset=${offset}`, {
      headers:{ Authorization:`Bearer ${inst.accessToken}`, Version:'2021-07-28', Accept:'application/json' }, timeout:15000 });
    res.json({ success:true, products:data.products || [], total:data.total || 0 });
  } catch(e) {
    res.status(400).json({ success:false, error:'Fetch products failed', details:e.response?.data || e.message });
  }
});

app.post('/api/ghl/contacts/create', async (req,res)=>{
  const inst = requireInstall(req,res); if (!inst) return;
  const { firstName='Test', lastName='Contact', email=`test${Date.now()}@example.com`, phone } = req.body;
  const contact = { firstName, lastName, email, locationId: inst.locationId, source:'OAuth Integration' };
  if (phone) contact.phone = phone;
  try {
    await ensureFreshToken(inst.id);
    const { data } = await axios.post('https://services.leadconnectorhq.com/contacts/', contact, {
      headers:{ Authorization:`Bearer ${inst.accessToken}`, 'Content-Type':'application/json', Version:'2021-07-28', Accept:'application/json' }, timeout:15000 });
    res.json({ success:true, contact:data.contact, contactId:data.contact?.id });
  } catch(e) {
    res.status(400).json({ success:false, error:'Contact creation failed', details:e.response?.data || e.message });
  }
});

// ───────────────────────────────────────────────────────
// NEW: Media upload proxy – handles images & files
// POST /api/ghl/media/upload  (multipart/form-data, field=file)
// ───────────────────────────────────────────────────────
const uploadTmp = multer({ dest:'/tmp' });

app.post('/api/ghl/media/upload', uploadTmp.single('file'), async (req, res)=>{
  const inst = requireInstall(req,res); if (!inst) return;
  if (!req.file) return res.status(400).json({ success:false, error:'file field missing' });

  try {
    await ensureFreshToken(inst.id);

    const form = new FormData();
    form.append('file', fs.createReadStream(req.file.path));
    form.append('fileName', req.file.originalname);
    form.append('locationId', inst.locationId);

    const { data } = await axios.post('https://services.leadconnectorhq.com/medias/upload-file', form, {
      headers:{ ...form.getHeaders(), Authorization:`Bearer ${inst.accessToken}`, Version:'2021-07-28', Accept:'application/json' }, timeout:20000 });

    fs.unlink(req.file.path, ()=>{});

    res.json({ success:true, mediaId:data.fileId, url:data.fileUrl, locationId:inst.locationId });
  } catch(e) {
    fs.unlink(req.file.path, ()=>{});
    res.status(400).json({ success:false, error:'Media upload failed', details:e.response?.data || e.message });
  }
});

// test helper – create a dummy product quickly
app.post('/api/ghl/test-product', async (req,res)=>{
  const inst = requireInstall(req,res); if (!inst) return;
  const testProduct = { name:'Test Product from OAuth Integration', description:'Created automatically to verify API functionality', locationId:inst.locationId, productType:'DIGITAL', availableInStore:true, price:29.99 };
  try {
    await ensureFreshToken(inst.id);
    const { data } = await axios.post('https://services.leadconnectorhq.com/products/', testProduct, {
      headers:{ Authorization:`Bearer ${inst.accessToken}`, 'Content-Type':'application/json', Version:'2021-07-28', Accept:'application/json' }, timeout:15000 });
    res.json({ success:true, productId:data.product?.id, product:data.product });
  } catch(e) {
    res.status(400).json({ success:false, error:'Test product creation failed', details:e.response?.data || e.message });
  }
});

// ───────────────────────────────────────────────────────
// Boot
// ───────────────────────────────────────────────────────
app.listen(port,'0.0.0.0',()=>{
