// OAuth Backend Fix - Add missing endpoints for installation tracking
// This file adds the missing /installations endpoint and debugging

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory install store
const installations = new Map();

// Add pre-seeded installation if env vars exist
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

// TOKEN LIFECYCLE HELPERS
const PADDING_MS = 5 * 60 * 1000;
const refreshers = new Map();

async function refreshAccessToken(id) {
  const inst = installations.get(id);
  if (!inst || !inst.refreshToken) return;

  try {
    const body = new URLSearchParams({
      client_id: process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: inst.refreshToken
    });

    const { data } = await axios.post(
      'https://services.leadconnectorhq.com/oauth/token',
      body,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    );

    inst.accessToken = data.access_token;
    inst.refreshToken = data.refresh_token || inst.refreshToken;
    inst.expiresIn = data.expires_in;
    inst.expiresAt = Date.now() + data.expires_in * 1000;
    inst.tokenStatus = 'valid';

    scheduleRefresh(id);
    console.log(`[REFRESH] ${id} → ${(data.expires_in / 3600).toFixed(1)} h`);
  } catch (err) {
    console.error(`[REFRESH-FAIL] ${id}`, err.response?.data || err.message);
    inst.tokenStatus = 'invalid';
  }
}

function scheduleRefresh(id) {
  clearTimeout(refreshers.get(id));
  const inst = installations.get(id);
  if (!inst || !inst.expiresAt) return;
  const delay = Math.max(inst.expiresAt - Date.now() - PADDING_MS, 0);
  const t = setTimeout(() => refreshAccessToken(id), delay);
  refreshers.set(id, t);
}

async function ensureFreshToken(id) {
  const inst = installations.get(id);
  if (!inst) throw new Error('Unknown installation');
  if (!inst.expiresAt || inst.expiresAt - Date.now() < PADDING_MS) {
    await refreshAccessToken(id);
  }
  if (inst.tokenStatus !== 'valid') throw new Error('Token invalid');
}

function requireInstall(req, res) {
  const installationId = req.method === 'GET' ? req.query.installation_id : req.body.installation_id;
  const inst = installations.get(installationId);
  if (!inst || !inst.accessToken) {
    res.status(400).json({ success: false, error: `Installation not found: ${installationId}` });
    return null;
  }
  return inst;
}

// BASIC ROUTES
app.get('/', (req, res) => {
  const authenticatedCount = Array.from(installations.values()).filter(inst => inst.tokenStatus === 'valid').length;
  res.json({
    service: "GoHighLevel OAuth Backend",
    version: "5.2.1-products-safe",
    installs: installations.size,
    authenticated: authenticatedCount,
    status: "operational",
    features: ["oauth", "products", "images", "pricing"],
    debug: "product endpoints added safely",
    ts: Date.now()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// MISSING INSTALLATIONS ENDPOINT - This was the problem!
app.get('/installations', (req, res) => {
  const installList = Array.from(installations.values()).map(inst => ({
    id: inst.id,
    locationId: inst.locationId,
    tokenStatus: inst.tokenStatus,
    createdAt: inst.createdAt,
    expiresAt: new Date(inst.expiresAt).toISOString(),
    scopes: inst.scopes
  }));
  
  res.json({
    total: installations.size,
    authenticated: installList.filter(inst => inst.tokenStatus === 'valid').length,
    installations: installList
  });
});

// OAuth token exchange
async function exchangeCode(code, redirectUri) {
  const body = new URLSearchParams({
    client_id: process.env.GHL_CLIENT_ID,
    client_secret: process.env.GHL_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });
  const { data } = await axios.post('https://services.leadconnectorhq.com/oauth/token', body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000
  });
  return data;
}

function storeInstall(tokenData) {
  const id = `install_${Date.now()}`;
  installations.set(id, {
    id,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresIn: tokenData.expires_in,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
    locationId: tokenData.locationId || 'WAvk87RmW9rBSDJHeOpH',
    scopes: tokenData.scope || '',
    tokenStatus: 'valid',
    createdAt: new Date().toISOString()
  });
  scheduleRefresh(id);
  console.log(`[NEW INSTALL] ${id} stored with location ${tokenData.locationId || 'WAvk87RmW9rBSDJHeOpH'}`);
  return id;
}

// OAUTH CALLBACK - Enhanced with better logging
app.get(['/oauth/callback', '/api/oauth/callback'], async (req, res) => {
  console.log('=== OAUTH CALLBACK RECEIVED ===');
  console.log('Query params:', req.query);
  console.log('Headers:', req.headers);
  
  const { code, error, state } = req.query;
  
  if (error) {
    console.error('OAuth error from GHL:', error);
    return res.status(400).json({ error: 'OAuth error', details: error });
  }
  
  if (!code) {
    console.error('No authorization code received');
    return res.status(400).json({ error: 'code required' });
  }
  
  try {
    const redirectUri = req.path.startsWith('/api')
      ? (process.env.GHL_REDIRECT_URI || 'https://dir.engageautomations.com/api/oauth/callback')
      : (process.env.GHL_REDIRECT_URI || 'https://dir.engageautomations.com/oauth/callback');

    console.log('Exchanging code for tokens...');
    console.log('Redirect URI:', redirectUri);
    
    const tokenData = await exchangeCode(code, redirectUri);
    console.log('Token exchange successful');
    
    const id = storeInstall(tokenData);
    console.log('Installation stored with ID:', id);
    
    const url = `https://listings.engageautomations.com/?installation_id=${id}&welcome=true`;
    console.log('Redirecting to:', url);
    
    res.redirect(url);
  } catch (e) {
    console.error('OAuth error:', e.response?.data || e.message);
    res.status(500).json({ error: 'OAuth failed', details: e.response?.data || e.message });
  }
});

app.get('/api/oauth/status', (req, res) => {
  const inst = installations.get(req.query.installation_id);
  if (!inst) return res.json({ authenticated: false });
  res.json({ authenticated: true, tokenStatus: inst.tokenStatus, locationId: inst.locationId });
});

// ===== PRODUCT API ENDPOINTS (ADDED SAFELY) =====

// Create Product
app.post('/api/products/create', async (req, res) => {
  const inst = requireInstall(req, res);
  if (!inst) return;

  try {
    await ensureFreshToken(inst.id);
    
    const productData = {
      locationId: inst.locationId,
      name: req.body.name,
      description: req.body.description,
      productType: req.body.productType || 'DIGITAL'
    };

    console.log('Creating product:', productData);

    const { data } = await axios.post(
      'https://services.leadconnectorhq.com/products/',
      productData,
      {
        headers: {
          Authorization: `Bearer ${inst.accessToken}`,
          Version: '2021-07-28',
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log('Product created successfully:', data);
    res.json({ success: true, product: data });
  } catch (error) {
    console.error('Product creation error:', error.response?.data || error.message);
    res.status(400).json({ 
      success: false, 
      error: error.response?.data || error.message 
    });
  }
});

// List Products
app.get('/api/products', async (req, res) => {
  const inst = requireInstall(req, res);
  if (!inst) return;

  try {
    await ensureFreshToken(inst.id);
    
    const { limit = 20, offset = 0 } = req.query;

    const { data } = await axios.get(
      `https://services.leadconnectorhq.com/products/?locationId=${inst.locationId}&limit=${limit}&offset=${offset}`,
      {
        headers: {
          Authorization: `Bearer ${inst.accessToken}`,
          Version: '2021-07-28',
          Accept: 'application/json'
        },
        timeout: 15000
      }
    );

    res.json({ success: true, products: data.products || [], total: data.total || 0 });
  } catch (error) {
    console.error('Product listing error:', error.response?.data || error.message);
    res.status(400).json({ 
      success: false, 
      error: error.response?.data || error.message 
    });
  }
});

// Create Product Price
app.post('/api/products/:productId/prices', async (req, res) => {
  const inst = requireInstall(req, res);
  if (!inst) return;

  try {
    await ensureFreshToken(inst.id);
    
    const { productId } = req.params;
    const priceData = {
      name: req.body.name,
      type: req.body.type || 'one_time',
      amount: req.body.amount,
      currency: req.body.currency || 'USD'
    };

    if (req.body.type === 'recurring' && req.body.recurring) {
      priceData.recurring = req.body.recurring;
    }

    console.log('Creating price for product:', productId, priceData);

    const { data } = await axios.post(
      `https://services.leadconnectorhq.com/products/${productId}/prices`,
      priceData,
      {
        headers: {
          Authorization: `Bearer ${inst.accessToken}`,
          Version: '2021-07-28',
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log('Price created successfully:', data);
    res.json({ success: true, price: data });
  } catch (error) {
    console.error('Price creation error:', error.response?.data || error.message);
    res.status(400).json({ 
      success: false, 
      error: error.response?.data || error.message 
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`OAuth backend running on port ${port}`);
  console.log(`Installations: ${installations.size}`);
  console.log('Ready for OAuth callbacks and product API calls');
});