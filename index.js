/* Railway OAuth Backend with Hardcoded Bridge URL
 * Version: 6.2.0-bridge-final
 * Bridge URL: https://62a303e9-3e97-4c9f-a7b4-c0026049fd6d-00-30skmv0mqe63e.janeway.replit.dev
 */

const express = require('express');
const axios = require('axios');
const app = express();

// Hardcoded bridge URL
const BRIDGE_URL = 'https://62a303e9-3e97-4c9f-a7b4-c0026049fd6d-00-30skmv0mqe63e.janeway.replit.dev';

app.use(express.json());

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'operational',
    version: '6.2.0-bridge-final',
    message: 'Railway Backend with Hardcoded Bridge URL',
    bridge_architecture: true,
    bridge_url: BRIDGE_URL,
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
    total: 0,
    authenticated: 0,
    bridge_architecture: true,
    bridge_url: BRIDGE_URL,
    installations: []
  });
});

// OAuth callback endpoint
app.get('/api/oauth/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.status(400).json({ error: 'Authorization code required' });
  }
  
  try {
    // Fetch OAuth credentials from bridge
    const credentialsResponse = await axios.get(`${BRIDGE_URL}/api/bridge/oauth-credentials`);
    const { clientId, clientSecret, redirectBase } = credentialsResponse.data;
    
    if (!clientId || !clientSecret) {
      throw new Error('Bridge credentials not available');
    }
    
    // Exchange code for tokens
    const tokenResponse = await axios.post('https://services.leadconnectorhq.com/oauth/token', {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: `${redirectBase}/api/oauth/callback`
    });
    
    const { access_token, refresh_token } = tokenResponse.data;
    
    // For now, just return success
    res.json({
      success: true,
      message: 'OAuth installation completed',
      bridge_url: BRIDGE_URL,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('OAuth callback error:', error.message);
    res.status(500).json({
      error: 'OAuth callback failed',
      message: error.message,
      bridge_url: BRIDGE_URL
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Railway OAuth Backend running on port ${PORT}`);
  console.log(`Bridge URL: ${BRIDGE_URL}`);
});