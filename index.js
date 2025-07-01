const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const installations = new Map();

// OAUTH CALLBACK - Process and redirect to frontend
app.get(['/oauth/callback', '/api/oauth/callback'], async (req, res) => {
  console.log('=== OAUTH CALLBACK ===');
  const { code, error, state } = req.query;
  
  if (error) {
    console.error('OAuth error:', error);
    return res.redirect(`https://listings.engageautomations.com/oauth-error?error=${encodeURIComponent(error)}`);
  }
  
  if (!code) {
    return res.redirect('https://listings.engageautomations.com/oauth-error?error=missing_code');
  }

  try {
    console.log('Processing OAuth code and redirecting to frontend...');
    
    // Exchange authorization code for tokens
    const body = new URLSearchParams({
      client_id: process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: process.env.GHL_REDIRECT_URI || 'https://dir.engageautomations.com/oauth/callback'
    });

    console.log('[OAUTH] Exchanging authorization code...');
    const tokenResponse = await axios.post('https://services.leadconnectorhq.com/oauth/token', body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    });

    const installationId = `install_${Date.now()}`;
    installations.set(installationId, {
      id: installationId,
      accessToken: tokenResponse.data.access_token,
      refreshToken: tokenResponse.data.refresh_token,
      expiresIn: tokenResponse.data.expires_in,
      expiresAt: Date.now() + (tokenResponse.data.expires_in * 1000),
      locationId: tokenResponse.data.locationId || 'WAvk87RmW9rBSDJHeOpH',
      scopes: tokenResponse.data.scope || '',
      tokenStatus: 'valid',
      createdAt: new Date().toISOString()
    });

    console.log(`[INSTALL] ✅ ${installationId} created successfully`);
    
    // Redirect to frontend with installation details
    const frontendUrl = `https://listings.engageautomations.com/?installation_id=${installationId}&welcome=true`;
    console.log(`[REDIRECT] Sending user to frontend: ${frontendUrl}`);
    
    res.redirect(302, frontendUrl);

  } catch (error) {
    console.error('OAuth processing error:', error.response?.data || error.message);
    
    // Redirect to frontend error page with details
    const errorParams = new URLSearchParams({
      error: 'oauth_processing_failed',
      details: error.response?.data?.message || error.message,
      timestamp: new Date().toISOString()
    });
    
    res.redirect(`https://listings.engageautomations.com/oauth-error?${errorParams}`);
  }
});

// TOKEN MANAGEMENT FUNCTIONS
async function refreshAccessToken(id) {
  const inst = installations.get(id);
  if (!inst || !inst.refreshToken) return false;

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
    inst.expiresAt = Date.now() + (data.expires_in * 1000);
    inst.tokenStatus = 'valid';
    
    console.log(`[REFRESH] Token updated for ${id}`);
    return true;
  } catch (error) {
    console.error(`[REFRESH] Failed for ${id}:`, error.response?.data || error.message);
    inst.tokenStatus = 'failed';
    return false;
  }
}

async function ensureFreshToken(id) {
  const inst = installations.get(id);
  if (!inst) throw new Error('Unknown installation');
  
  const timeUntilExpiry = inst.expiresAt - Date.now();
  if (timeUntilExpiry < 5 * 60 * 1000) {
    await refreshAccessToken(id);
  }
  
  if (inst.tokenStatus !== 'valid') throw new Error('Token invalid');
  return inst;
}

// AUTO-RETRY API WRAPPER
async function makeGHLAPICall(installationId, requestConfig, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const installation = await ensureFreshToken(installationId);
      
      const config = {
        ...requestConfig,
        headers: {
          'Authorization': `Bearer ${installation.accessToken}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
          ...requestConfig.headers
        },
        timeout: 15000
      };
      
      const response = await axios(config);
      console.log(`[API] Success on attempt ${attempt}`);
      return response;
      
    } catch (error) {
      console.log(`[API] Attempt ${attempt} failed:`, error.response?.status, error.response?.data?.message || error.message);
      
      if (error.response?.status === 401 && attempt < maxRetries) {
        console.log(`[RETRY] Token expired, refreshing and retrying...`);
        await refreshAccessToken(installationId);
        continue;
      }
      
      if (attempt === maxRetries) {
        throw error;
      }
    }
  }
}

// BASIC ROUTES
app.get('/', (req, res) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
    <title>GoHighLevel OAuth Backend</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        .header { text-align: center; margin-bottom: 40px; }
        .status { background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .feature { display: inline-block; background: #e7f3ff; padding: 8px 16px; margin: 5px; border-radius: 20px; }
        .endpoint { background: #f8f9fa; padding: 10px; margin: 10px 0; border-left: 4px solid #007bff; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔗 GoHighLevel OAuth Backend</h1>
        <p>Version 5.8.0-frontend-redirect | Status: Operational</p>
    </div>
    
    <div class="status">
        <h3>System Status</h3>
        <p><strong>Installations:</strong> ${installations.size}</p>
        <p><strong>Authenticated:</strong> ${Array.from(installations.values()).filter(inst => inst.tokenStatus === 'valid').length}</p>
        <p><strong>Frontend:</strong> <a href="https://listings.engageautomations.com">listings.engageautomations.com</a></p>
        <p><strong>Last Updated:</strong> ${new Date().toISOString()}</p>
    </div>
    
    <h3>🚀 Features</h3>
    <div class="feature">OAuth Processing</div>
    <div class="feature">Frontend Redirect</div>
    <div class="feature">Auto-Retry System</div>
    <div class="feature">Token Management</div>
    
    <h3>📡 API Endpoints</h3>
    <div class="endpoint"><strong>POST</strong> /api/products/create - Create products with auto-retry</div>
    <div class="endpoint"><strong>GET</strong> /installations - View installations</div>
    <div class="endpoint"><strong>GET</strong> /api/token-health/:id - Token status</div>
</body>
</html>
`;
  
  res.send(html);
});

app.get('/installations', (req, res) => {
  const installationsArray = Array.from(installations.values()).map(inst => ({
    id: inst.id,
    locationId: inst.locationId,
    tokenStatus: inst.tokenStatus,
    createdAt: inst.createdAt,
    expiresAt: inst.expiresAt,
    timeUntilExpiry: Math.max(0, Math.round((inst.expiresAt - Date.now()) / 1000))
  }));
  
  res.json({
    installations: installationsArray,
    count: installationsArray.length,
    frontend: 'https://listings.engageautomations.com'
  });
});

// TOKEN HEALTH CHECK
app.get('/api/token-health/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const installation = installations.get(id);
    
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }
    
    const timeUntilExpiry = installation.expiresAt - Date.now();
    const isExpiringSoon = timeUntilExpiry < 10 * 60 * 1000; // 10 minutes
    
    res.json({
      installationId: id,
      tokenStatus: installation.tokenStatus,
      expiresAt: installation.expiresAt,
      timeUntilExpiry: Math.max(0, Math.round(timeUntilExpiry / 1000)),
      isExpiringSoon,
      locationId: installation.locationId
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PRODUCT CREATION WITH AUTO-RETRY
app.post('/api/products/create', async (req, res) => {
  try {
    const { name, description, productType, sku, currency, installation_id } = req.body;
    
    if (!installation_id) {
      return res.status(400).json({ success: false, error: 'installation_id required' });
    }
    
    if (!name) {
      return res.status(400).json({ success: false, error: 'product name required' });
    }
    
    const installation = await ensureFreshToken(installation_id);
    
    const productData = {
      name,
      description: description || '',
      productType: productType || 'DIGITAL',
      locationId: installation.locationId,
      ...(sku && { sku }),
      ...(currency && { currency })
    };
    
    const response = await makeGHLAPICall(installation_id, {
      method: 'POST',
      url: 'https://services.leadconnectorhq.com/products/',
      data: productData
    });
    
    res.json({
      success: true,
      product: response.data.product || response.data,
      message: 'Product created successfully with auto-retry protection'
    });
    
  } catch (error) {
    console.error('[PRODUCT] Creation error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
      message: 'Failed to create product after retries'
    });
  }
});

app.listen(port, () => {
  console.log(`✅ OAuth Backend v5.8.0-frontend-redirect running on port ${port}`);
  console.log(`🔗 OAuth processing with frontend redirect to listings.engageautomations.com`);
  console.log(`🔄 Auto-retry system with 3 attempts and smart token refresh`);
});