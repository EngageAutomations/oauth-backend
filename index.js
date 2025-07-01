const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');

const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 25 * 1024 * 1024 }
});

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const installations = new Map();

// TOKEN HELPERS
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
    inst.expiresAt = Date.now() + data.expires_in * 1000;
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
  if (timeUntilExpiry < 5 * 60 * 1000) { // 5 minutes padding
    await refreshAccessToken(id);
  }
  
  if (inst.tokenStatus !== 'valid') throw new Error('Token invalid');
  return inst;
}

// BASIC ROUTES
app.get('/', (req, res) => {
  res.json({
    service: "GoHighLevel OAuth Backend",
    version: "5.5.0-enhanced-api",
    status: "operational",
    installs: installations.size,
    authenticated: Array.from(installations.values()).filter(inst => inst.tokenStatus === 'valid').length,
    features: ["oauth", "products", "media-upload", "token-refresh"],
    endpoints: ["/api/products/create", "/api/media/upload", "/installations"],
    enhanced: new Date().toISOString()
  });
});

app.get('/installations', (req, res) => {
  const installationsArray = Array.from(installations.values()).map(inst => ({
    id: inst.id,
    locationId: inst.locationId,
    tokenStatus: inst.tokenStatus,
    createdAt: inst.createdAt,
    expiresAt: inst.expiresAt
  }));
  
  res.json({
    installations: installationsArray,
    count: installationsArray.length
  });
});

// OAUTH CALLBACK
app.get(['/oauth/callback', '/api/oauth/callback'], async (req, res) => {
  console.log('=== OAUTH CALLBACK ===');
  const { code, error } = req.query;
  
  if (error) {
    console.error('OAuth error:', error);
    return res.status(400).json({ error: 'OAuth error', details: error });
  }
  
  if (!code) {
    return res.status(400).json({ error: 'Authorization code required' });
  }

  try {
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

    const id = `install_${Date.now()}`;
    installations.set(id, {
      id,
      accessToken: tokenResponse.data.access_token,
      refreshToken: tokenResponse.data.refresh_token,
      expiresIn: tokenResponse.data.expires_in,
      expiresAt: Date.now() + tokenResponse.data.expires_in * 1000,
      locationId: tokenResponse.data.locationId || 'WAvk87RmW9rBSDJHeOpH',
      scopes: tokenResponse.data.scope || '',
      tokenStatus: 'valid',
      createdAt: new Date().toISOString()
    });

    console.log(`[INSTALL] ${id} created successfully`);
    
    res.json({
      success: true,
      installationId: id,
      message: 'OAuth installation successful'
    });

  } catch (error) {
    console.error('OAuth callback error:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false, 
      error: 'OAuth callback failed',
      details: error.response?.data || error.message
    });
  }
});

// PRODUCT CREATION
app.post('/api/products/create', async (req, res) => {
  try {
    const { name, description, productType, sku, currency, installation_id } = req.body;
    
    console.log(`[PRODUCT] Creating: ${name}`);
    
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
    
    console.log(`[PRODUCT] Sending to GHL:`, productData);
    
    const productResponse = await axios.post('https://services.leadconnectorhq.com/products/', productData, {
      headers: {
        'Authorization': `Bearer ${installation.accessToken}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    
    console.log(`[PRODUCT] Created successfully: ${productResponse.data.product?.id || 'unknown'}`);
    
    res.json({
      success: true,
      product: productResponse.data.product || productResponse.data,
      message: 'Product created successfully'
    });
    
  } catch (error) {
    console.error('[PRODUCT] Creation error:', error.response?.data || error.message);
    
    // Try token refresh on 401
    if (error.response?.status === 401) {
      try {
        console.log('[PRODUCT] Attempting token refresh...');
        await refreshAccessToken(req.body.installation_id);
        // Could retry here, but for now just return the error
      } catch (refreshError) {
        console.error('[PRODUCT] Token refresh failed:', refreshError.message);
      }
    }
    
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
      message: 'Failed to create product'
    });
  }
});

// MEDIA UPLOAD
app.post('/api/media/upload', upload.single('file'), async (req, res) => {
  try {
    const { installation_id } = req.body;
    
    console.log(`[MEDIA] Uploading: ${req.file?.originalname}`);
    
    if (!installation_id) {
      return res.status(400).json({ success: false, error: 'installation_id required' });
    }
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'file required' });
    }
    
    const installation = await ensureFreshToken(installation_id);
    
    const formData = new FormData();
    formData.append('file', fs.createReadStream(req.file.path), {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });
    
    console.log(`[MEDIA] Uploading to GHL for location: ${installation.locationId}`);
    
    const uploadResponse = await axios.post('https://services.leadconnectorhq.com/medias/upload-file', formData, {
      headers: {
        'Authorization': `Bearer ${installation.accessToken}`,
        'Version': '2021-07-28',
        ...formData.getHeaders()
      },
      params: {
        locationId: installation.locationId
      },
      timeout: 30000
    });
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    console.log(`[MEDIA] Upload successful: ${uploadResponse.data.url || uploadResponse.data.fileUrl}`);
    
    res.json({
      success: true,
      mediaUrl: uploadResponse.data.url || uploadResponse.data.fileUrl,
      mediaId: uploadResponse.data.id,
      data: uploadResponse.data
    });
    
  } catch (error) {
    // Clean up file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    console.error('[MEDIA] Upload error:', error.response?.data || error.message);
    
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
      message: 'Failed to upload media'
    });
  }
});

// PRODUCT LISTING
app.get('/api/products', async (req, res) => {
  try {
    const { installation_id } = req.query;
    
    if (!installation_id) {
      return res.status(400).json({ success: false, error: 'installation_id required' });
    }
    
    const installation = await ensureFreshToken(installation_id);
    
    const productsResponse = await axios.get('https://services.leadconnectorhq.com/products/', {
      headers: {
        'Authorization': `Bearer ${installation.accessToken}`,
        'Version': '2021-07-28'
      },
      params: {
        locationId: installation.locationId
      },
      timeout: 15000
    });
    
    res.json({
      success: true,
      products: productsResponse.data.products || productsResponse.data,
      count: productsResponse.data.products?.length || 0
    });
    
  } catch (error) {
    console.error('[PRODUCTS] List error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

app.listen(port, () => {
  console.log(`✅ Enhanced OAuth Backend running on port ${port}`);
  console.log(`📊 Features: OAuth, Product Creation, Media Upload`);
  console.log(`🔗 Endpoints: /api/products/create, /api/media/upload, /api/products`);
});