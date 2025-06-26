/* Railway OAuth Backend - Self-Contained
 * Version: 7.0.0-self-contained
 * No external bridge dependency
 */

const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// OAuth credentials embedded directly in code
const OAUTH_CONFIG = {
  clientId: process.env.GHL_CLIENT_ID || '67671c52e4b0b29a36063fb6',
  clientSecret: process.env.GHL_CLIENT_SECRET || '72e0e7c4-ee9d-4bad-a6fb-2b6b49bb6b7b',
  redirectBase: 'https://dir.engageautomations.com'
};

// In-memory installation storage
const installations = new Map();

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'operational',
    version: '7.0.0-self-contained',
    message: 'Self-Contained OAuth Backend',
    oauth_embedded: true,
    installs: installations.size,
    endpoints: [
      'GET /installations',
      'GET /api/oauth/callback',
      'POST /api/media/upload',
      'POST /api/products/create',
      'POST /api/products/:productId/prices'
    ]
  });
});

// Installations endpoint
app.get('/installations', (req, res) => {
  res.json({
    total: installations.size,
    authenticated: installations.size,
    oauth_embedded: true,
    installations: Array.from(installations.values())
  });
});

// OAuth callback endpoint
app.get('/api/oauth/callback', async (req, res) => {
  const { code, locationId } = req.query;
  
  if (!code) {
    return res.status(400).json({ error: 'Authorization code required' });
  }
  
  try {
    console.log('Processing OAuth callback with embedded credentials');
    
    // Exchange code for tokens using embedded credentials
    const tokenResponse = await axios.post('https://services.leadconnectorhq.com/oauth/token', {
      client_id: OAUTH_CONFIG.clientId,
      client_secret: OAUTH_CONFIG.clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: `${OAUTH_CONFIG.redirectBase}/api/oauth/callback`
    });
    
    const { access_token, refresh_token, scope } = tokenResponse.data;
    
    // Store installation
    const installationId = locationId || Date.now().toString();
    const installation = {
      id: installationId,
      locationId: locationId,
      accessToken: access_token,
      refreshToken: refresh_token,
      scope: scope,
      createdAt: new Date().toISOString()
    };
    
    installations.set(installationId, installation);
    
    console.log(`OAuth installation completed: ${installationId}`);
    
    res.json({
      success: true,
      message: 'OAuth installation completed successfully',
      installationId: installationId,
      locationId: locationId,
      scope: scope,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('OAuth callback error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'OAuth callback failed',
      message: error.message,
      details: error.response?.data
    });
  }
});

// Product creation endpoint
app.post('/api/products/create', async (req, res) => {
  try {
    const { locationId, ...productData } = req.body;
    
    // Get installation
    const installation = Array.from(installations.values()).find(inst => inst.locationId === locationId);
    if (!installation) {
      return res.status(401).json({ error: 'OAuth installation required' });
    }
    
    // Create product in GoHighLevel
    const response = await axios.post(`https://services.leadconnectorhq.com/products/`, productData, {
      headers: {
        'Authorization': `Bearer ${installation.accessToken}`,
        'Version': '2021-07-28'
      }
    });
    
    res.json(response.data);
    
  } catch (error) {
    res.status(500).json({
      error: 'Product creation failed',
      message: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Self-Contained OAuth Backend running on port ${PORT}`);
  console.log(`OAuth Client ID: ${OAUTH_CONFIG.clientId}`);
});