// index.js – refreshed with automatic token renewal

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// ───────────────────────────────────────────────────────
// Middleware
// ───────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ───────────────────────────────────────────────────────
// Installation store (in‑memory Map for demo; swap for DB)
// ───────────────────────────────────────────────────────
const installations = new Map();

// Seeded installation so your frontend keeps working after a redeploy
installations.set('install_1750106970265', {
  id: 'install_1750106970265',
  accessToken: process.env.GHL_ACCESS_TOKEN || null,
  refreshToken: null,
  locationId: 'WAvk87RmW9rBSDJHeOpH',
  scopes:
    'products/prices.write products/prices.readonly products/collection.readonly medias.write medias.readonly locations.readonly contacts.readonly contacts.write products/collection.write users.readonly',
  tokenStatus: process.env.GHL_ACCESS_TOKEN ? 'valid' : 'missing',
  createdAt: new Date().toISOString(),
});

// ───────────────────────────────────────────────────────
// TOKEN‑REFRESH HELPERS
// ───────────────────────────────────────────────────────
const DEFAULT_REFRESH_PADDING_MS = 5 * 60 * 1000; // refresh 5 min early
const refreshTimers = new Map();

async function refreshAccessToken(installationId) {
  const inst = installations.get(installationId);
  if (!inst || !inst.refreshToken) return;

  try {
    const formData = new URLSearchParams({
      client_id: process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: inst.refreshToken,
    });

    const { data } = await axios.post(
      'https://services.leadconnectorhq.com/oauth/token',
      formData,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      },
    );

    inst.accessToken = data.access_token;
    inst.refreshToken = data.refresh_token || inst.refreshToken; // sometimes unchanged
    inst.expiresIn = data.expires_in;
    inst.expiresAt = Date.now() + data.expires_in * 1000;
    inst.tokenStatus = 'valid';

    scheduleTokenRefresh(installationId);
    console.log(
      `[REFRESH] ${installationId} – new token good for ${(data.expires_in / 3600).toFixed(1)} h`,
    );
  } catch (err) {
    console.error(`[REFRESH‑FAIL] ${installationId}`, err.response?.data || err.message);
    inst.tokenStatus = 'invalid';
  }
}

function scheduleTokenRefresh(installationId) {
  clearTimeout(refreshTimers.get(installationId));

  const inst = installations.get(installationId);
  if (!inst || !inst.expiresAt) return;

  const msUntilRefresh = Math.max(
    inst.expiresAt - Date.now() - DEFAULT_REFRESH_PADDING_MS,
    0,
  );
  const t = setTimeout(() => refreshAccessToken(installationId), msUntilRefresh);
  refreshTimers.set(installationId, t);
}

async function ensureFreshToken(installationId) {
  const inst = installations.get(installationId);
  if (!inst) throw new Error('Unknown installation');

  if (!inst.expiresAt || inst.expiresAt - Date.now() < DEFAULT_REFRESH_PADDING_MS) {
    await refreshAccessToken(installationId);
  }
  if (inst.tokenStatus !== 'valid') {
    throw new Error('Access token invalid and refresh failed');
  }
}

// ───────────────────────────────────────────────────────
// Utility: wrapper to quickly reject missing‑token installs
// ───────────────────────────────────────────────────────
function requireInstall(req, res) {
  const { installationId } = req.method === 'GET' ? req.query : req.body;
  const inst = installations.get(installationId);
  if (!inst || !inst.accessToken) {
    res.status(400).json({
      success: false,
      error: `Access token not available for installation: ${installationId}`,
      availableInstallations: Array.from(installations.keys()),
    });
    return null;
  }
  return inst;
}

// ───────────────────────────────────────────────────────
// Root & health
// ───────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'GoHighLevel API Backend',
    version: '1.3.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    activeInstallations: installations.size,
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    hasToken: !!process.env.GHL_ACCESS_TOKEN,
    installations: installations.size,
    installationIds: Array.from(installations.keys()),
  });
});

// ───────────────────────────────────────────────────────
// OAuth helpers
// ───────────────────────────────────────────────────────
function finishOAuth(req, res, redirectBase) {
  return async (tokenData) => {
    const installationId = `install_${Date.now()}`;
    console.log('Token exchange successful, creating installation:', installationId);
    console.log('Location ID:', tokenData.locationId);

    installations.set(installationId, {
      id: installationId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      locationId: tokenData.locationId || 'WAvk87RmW9rBSDJHeOpH',
      scopes: tokenData.scope || '',
      tokenStatus: 'valid',
      createdAt: new Date().toISOString(),
    });

    scheduleTokenRefresh(installationId);

    const welcomeUrl = `${redirectBase}?installation_id=${installationId}&welcome=true`;
    res.redirect(welcomeUrl);
  };
}

async function exchangeCodeForToken(code, redirectUri) {
  const formData = new URLSearchParams({
    client_id: process.env.GHL_CLIENT_ID,
    client_secret: process.env.GHL_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const tokenResponse = await axios.post(
    'https://services.leadconnectorhq.com/oauth/token',
    formData,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 },
  );

  return tokenResponse.data;
}

// Primary callback
app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Authorization code required' });

  try {
    const tokenData = await exchangeCodeForToken(
      code,
      process.env.GHL_REDIRECT_URI || 'https://dir.engageautomations.com/oauth/callback',
    );
    await finishOAuth(req, res, 'https://listings.engageautomations.com/')(tokenData);
  } catch (error) {
    console.error('OAuth error:', error.response?.data || error.message);
    res.status(500).json({ error: 'OAuth failed', message: error.message });
  }
});

// API‑prefixed callback (for GHL marketplace)
app.get('/api/oauth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Authorization code required' });

  try {
    const tokenData = await exchangeCodeForToken(
      code,
      process.env.GHL_REDIRECT_URI || 'https://dir.engageautomations.com/api/oauth/callback',
    );
    await finishOAuth(req, res, 'https://listings.engageautomations.com/')(tokenData);
  } catch (error) {
    console.error('OAuth error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'OAuth failed',
      message: error.message,
      details: error.response?.data,
    });
  }
});

// OAuth status helper
app.get('/api/oauth/status', (req, res) => {
  const installationId = req.query.installation_id;
  const installation = installations.get(installationId);
  if (!installation) return res.json({ authenticated: false, message: 'Installation not found' });

  res.json({
    authenticated: true,
    installationId: installation.id,
    locationId: installation.locationId,
    scopes: installation.scopes,
    tokenStatus: installation.tokenStatus,
    hasAccessToken: !!installation.accessToken,
  });
});

// ───────────────────────────────────────────────────────
// GoHighLevel API routes
// ───────────────────────────────────────────────────────
app.get('/api/ghl/test-connection', async (req, res) => {
  const installation = requireInstall(req, res);
  if (!installation) return;

  try {
    await ensureFreshToken(installation.id);

    const response = await axios.get(
      `https://services.leadconnectorhq.com/locations/${installation.locationId}`,
      {
        headers: {
          Authorization: `Bearer ${installation.accessToken}`,
          Version: '2021-07-28',
          Accept: 'application/json',
        },
        timeout: 15000,
      },
    );

    res.json({
      success: true,
      message: 'GoHighLevel connection successful',
      locationId: installation.locationId,
      locationData: response.data,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: 'Connection failed',
      details: error.response?.data || error.message,
      status: error.response?.status,
    });
  }
});

app.post('/api/ghl/products/create', async (req, res) => {
  const installation = requireInstall(req, res);
  if (!installation) return;

  const { name, description, price, productType = 'DIGITAL' } = req.body;
  const productData = {
    name,
    description,
    locationId: installation.locationId,
    productType,
    availableInStore: true,
  };
  if (price && !isNaN(parseFloat(price))) productData.price = parseFloat(price);

  try {
    await ensureFreshToken(installation.id);

    const response = await axios.post(
      'https://services.leadconnectorhq.com/products/',
      productData,
      {
        headers: {
          Authorization: `Bearer ${installation.accessToken}`,
          'Content-Type': 'application/json',
          Version: '2021-07-28',
          Accept: 'application/json',
        },
        timeout: 15000,
      },
    );

    res.json({
      success: true,
      message: 'Product created successfully in GoHighLevel',
      product: response.data.product,
      productId: response.data.product?.id,
      locationId: installation.locationId,
    });
  } catch (error) {
    console.error('Product creation error:', error.response?.data || error.message);
    res.status(400).json({
      success: false,
      error: 'Product creation failed',
      details: error.response?.data || error.message,
      status: error.response?.status,
    });
  }
});

app.get('/api/ghl/products', async (req, res) => {
  const installation = requireInstall(req, res);
  if (!installation) return;

  const { limit = 20, offset = 0 } = req.query;

  try {
    await ensureFreshToken(installation.id);

    const response = await axios.get(
      `https://services.leadconnectorhq.com/products/?locationId=${installation.locationId}&limit=${limit}&offset=${offset}`,
      {
        headers: {
          Authorization: `Bearer ${installation.accessToken}`,
          Version: '2021-07-28',
          Accept: 'application/json',
        },
        timeout: 15000,
      },
    );

    res.json({
      success: true,
      products: response.data.products || [],
      total: response.data.total || 0,
      locationId: installation.locationId,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: 'Failed to fetch products',
      details: error.response?.data || error.message,
    });
  }
});

app.post('/api/ghl/contacts/create', async (req, res) => {
  const installation = requireInstall(req, res);
  if (!installation) return;

  const { firstName, lastName, email, phone } = req.body;
  const contactData = {
    firstName: firstName || 'Test',
    lastName: lastName || 'Contact',
    email: email || `test${Date.now()}@example.com`,
    locationId: installation.locationId,
    source: 'OAuth Integration',
  };
  if (phone) contactData.phone = phone;

  try {
    await ensureFreshToken(installation.id);

    const response = await axios.post(
      'https://services.leadconnectorhq.com/contacts/',
      contactData,
      {
        headers: {
          Authorization: `Bearer ${installation.accessToken}`,
          'Content-Type': 'application/json',
          Version: '2021-07-28',
          Accept: 'application/json',
        },
        timeout: 15000,
      },
    );

    res.json({
      success: true,
      message: 'Contact created successfully in GoHighLevel',
      contact: response.data.contact,
      contactId: response.data.contact?.id,
      locationId: installation.locationId,
    });
  } catch (error) {
    console.error('Contact creation error:', error.response?.data || error.message);
    res.status(400).json({
      success: false,
      error: 'Contact creation failed',
      details: error.response?.data || error.message,
      status: error.response?.status,
    });
  }
});

// Quick route to verify write scopes work from the UI
app.post('/api/ghl/test-product', async (req, res) => {
  const installation = requireInstall(req, res);
  if (!installation) return;

  const testProduct = {
    name: 'Test Product from OAuth Integration',
    description:
      'This product was created automatically via the production OAuth marketplace integration to verify API functionality',
    locationId: installation.locationId,
    productType: 'DIGITAL',
    availableInStore: true,
    price: 29.99,
  };

  try {
    await ensureFreshToken(installation.id);

    const response = await axios.post(
      'https://services.leadconnectorhq.com/products/',
      testProduct,
      {
        headers: {
          Authorization: `Bearer ${installation.accessToken}`,
          'Content-Type': 'application/json',
          Version: '2021-07-28',
          Accept: 'application/json',
        },
        timeout: 15000,
      },
    );

    res.json({
      success: true,
      message: 'Test product created successfully in GoHighLevel',
      product: response.data.product,
      productId: response.data.product?.id,
      installationId: installation.id,
      locationId: installation.locationId,
    });
  } catch (error) {
    console.error('Test product creation error:', error.response?.data || error.message);
    res.status(400).json({
      success: false,
      error: 'Test product creation failed',
      details: error.response?.data || error.message,
      status: error.response?.status,
    });
  }
});

// ───────────────────────────────────────────────────────
// Boot
// ───────────────────────────────────────────────────────
app.listen(port, '0.0.0.0', () => {
  console.log(`GoHighLevel API Backend v1.3.0 running on port ${port}`);
  console.log('Health check: /health');
  console.log('OAuth callback: /api/oauth/callback');
  console.log(`Access token: ${process.env.GHL_ACCESS_TOKEN ? 'Present' : 'Missing – will be captured via OAuth'}`);
  console.log(`Active installations: ${installations.size}`);

  // Re‑arm timers on container restart
  for (const id of installations.keys()) scheduleTokenRefresh(id);
});

module.exports = app;
