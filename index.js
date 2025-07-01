/**
 * OAuth Backend v5.9.1-image-upload-fixed
 * Simplified implementation with image upload for GoHighLevel
 */

const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// Configure multer for memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// In-memory installations storage
const installations = new Map();

// OAuth environment variables
const GHL_CLIENT_ID = process.env.GHL_CLIENT_ID || 'YOUR_GHL_CLIENT_ID';
const GHL_CLIENT_SECRET = process.env.GHL_CLIENT_SECRET || 'YOUR_GHL_CLIENT_SECRET';
const GHL_REDIRECT_URI = process.env.GHL_REDIRECT_URI || 'https://dir.engageautomations.com/oauth/callback';

// Token refresh utility
async function refreshTokenIfNeeded(installation) {
  const now = Date.now();
  const timeUntilExpiry = installation.expiresAt - now;
  
  // Refresh if expiring within 2 hours
  if (timeUntilExpiry < 2 * 60 * 60 * 1000) {
    console.log('Refreshing token for installation:', installation.id);
    
    try {
      const response = await axios.post('https://services.leadconnectorhq.com/oauth/token', new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: GHL_CLIENT_ID,
        client_secret: GHL_CLIENT_SECRET,
        refresh_token: installation.refreshToken
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const tokenData = response.data;
      installation.accessToken = tokenData.access_token;
      installation.expiresAt = now + (tokenData.expires_in * 1000);
      installation.tokenStatus = 'valid';
      
      console.log('✅ Token refreshed successfully');
      return installation.accessToken;
    } catch (error) {
      console.error('❌ Token refresh failed:', error.response?.data || error.message);
      installation.tokenStatus = 'expired';
      return null;
    }
  }
  
  return installation.accessToken;
}

// OAuth callback
app.get('/oauth/callback', async (req, res) => {
  const { code, error } = req.query;
  
  if (error) {
    console.error('OAuth error:', error);
    return res.redirect(`https://listings.engageautomations.com/?error=${encodeURIComponent(error)}`);
  }
  
  if (!code) {
    return res.send('OAuth callback endpoint is working!');
  }
  
  try {
    console.log('🔄 Processing OAuth callback...');
    
    // Exchange code for token
    const tokenResponse = await axios.post('https://services.leadconnectorhq.com/oauth/token', new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: GHL_CLIENT_ID,
      client_secret: GHL_CLIENT_SECRET,
      code: String(code),
      redirect_uri: GHL_REDIRECT_URI
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const tokenData = tokenResponse.data;
    console.log('✅ Token exchange successful');

    // Get user info
    const userResponse = await axios.get('https://services.leadconnectorhq.com/users/me', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Version': '2021-07-28'
      }
    });

    const userData = userResponse.data;

    // Get location info
    let locationData = null;
    try {
      const locationResponse = await axios.get('https://services.leadconnectorhq.com/locations/', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Version': '2021-07-28'
        }
      });
      
      if (locationResponse.data.locations && locationResponse.data.locations.length > 0) {
        locationData = locationResponse.data.locations[0];
      }
    } catch (locationError) {
      console.log('Location data not available');
    }

    // Store installation
    const installationId = `install_${Date.now()}`;
    const installation = {
      id: installationId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      tokenStatus: 'valid',
      userId: userData.id,
      userEmail: userData.email,
      userName: userData.name || `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
      locationId: locationData?.id || '',
      locationName: locationData?.name || '',
      scopes: tokenData.scope || '',
      createdAt: new Date().toISOString()
    };
    
    installations.set(installationId, installation);
    
    console.log('✅ Installation stored:', installationId);
    
    // Redirect to frontend
    return res.redirect(`https://listings.engageautomations.com/?installation_id=${installationId}&welcome=true`);
    
  } catch (error) {
    console.error('❌ OAuth error:', error.response?.data || error.message);
    return res.redirect(`https://listings.engageautomations.com/?error=oauth_failed`);
  }
});

// Image Upload API
app.post('/api/images/upload', upload.single('file'), async (req, res) => {
  console.log('=== Image Upload Request ===');
  
  try {
    const { installation_id } = req.body;
    
    if (!installation_id) {
      return res.status(400).json({ success: false, error: 'installation_id required' });
    }
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    
    console.log('File:', req.file.originalname, 'Size:', req.file.size);
    
    // Get installation
    const installation = installations.get(installation_id);
    if (!installation) {
      return res.status(404).json({ 
        success: false, 
        error: 'Installation not found',
        available: Array.from(installations.keys())
      });
    }
    
    // Refresh token if needed
    const accessToken = await refreshTokenIfNeeded(installation);
    if (!accessToken) {
      return res.status(401).json({
        success: false,
        error: 'Token expired or invalid'
      });
    }
    
    // Create form data for GoHighLevel
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });
    
    console.log('🚀 Uploading to GoHighLevel...');
    
    // Upload to GoHighLevel media library
    const uploadResponse = await axios.post('https://services.leadconnectorhq.com/medias/upload-file', formData, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Version': '2021-07-28',
        ...formData.getHeaders()
      },
      timeout: 30000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    console.log('✅ Upload successful!');
    
    res.json({
      success: true,
      media: uploadResponse.data,
      message: 'Image uploaded to GoHighLevel media library'
    });
    
  } catch (error) {
    console.error('❌ Upload error:', error.response?.data || error.message);
    
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data?.message || error.message || 'Upload failed'
    });
  }
});

// Media listing API
app.get('/api/images/list', async (req, res) => {
  try {
    const { installation_id } = req.query;
    
    if (!installation_id) {
      return res.status(400).json({ success: false, error: 'installation_id required' });
    }
    
    const installation = installations.get(installation_id);
    if (!installation) {
      return res.status(404).json({ success: false, error: 'Installation not found' });
    }
    
    const accessToken = await refreshTokenIfNeeded(installation);
    if (!accessToken) {
      return res.status(401).json({ success: false, error: 'Token expired' });
    }
    
    const response = await axios.get('https://services.leadconnectorhq.com/medias/', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Version': '2021-07-28'
      }
    });
    
    res.json({
      success: true,
      media: response.data.medias || []
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Installations endpoint
app.get('/installations', (req, res) => {
  const installationList = Array.from(installations.values()).map(inst => ({
    id: inst.id,
    locationId: inst.locationId,
    locationName: inst.locationName,
    userName: inst.userName,
    tokenStatus: inst.tokenStatus,
    createdAt: inst.createdAt,
    expiresAt: inst.expiresAt,
    timeUntilExpiry: inst.expiresAt - Date.now()
  }));
  
  res.json({
    installations: installationList,
    count: installationList.length,
    frontend: 'https://listings.engageautomations.com',
    note: 'OAuth backend with image upload'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '5.9.1-image-upload-fixed',
    features: ['oauth', 'image-upload'],
    installations: installations.size
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'GoHighLevel OAuth Backend',
    version: '5.9.1-image-upload-fixed',
    endpoints: ['/oauth/callback', '/api/images/upload', '/api/images/list', '/installations'],
    status: 'operational'
  });
});

app.listen(port, () => {
  console.log(`OAuth Backend v5.9.1 running on port ${port}`);
  console.log('Image upload endpoints ready');
});