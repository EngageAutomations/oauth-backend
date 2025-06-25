// Railway Main Backend - Bridge Integration
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

// Bridge configuration
const BRIDGE_BASE_URL = 'https://gohighlevel-oauth-marketplace-application.replit.app';
let cachedCredentials = null;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Storage
let oauthInstallations = [];

// Get OAuth credentials from bridge
async function getOAuthCredentials() {
  if (cachedCredentials && cachedCredentials.expires > Date.now()) {
    return cachedCredentials.data;
  }

  try {
    const response = await axios.get(`${BRIDGE_BASE_URL}/api/bridge/oauth-credentials`, { 
      timeout: 10000
    });
    
    if (response.data.success) {
      cachedCredentials = {
        data: response.data.credentials,
        expires: Date.now() + (5 * 60 * 1000)
      };
      return response.data.credentials;
    }
    throw new Error('Bridge credentials request failed');
  } catch (error) {
    console.error('Bridge error:', error.message);
    throw error;
  }
}

// Routes
app.get('/', (req, res) => {
  res.json({
    service: "GoHighLevel OAuth Backend",
    version: "2.3.0-bridge-main",
    installs: oauthInstallations.length,
    authenticated: oauthInstallations.filter(i => i.isActive).length,
    status: "operational",
    features: ["oauth-integration", "bridge-system"],
    bridge_system: "replit-integration",
    ts: Date.now()
  });
});

// OAuth callback - MAIN ENDPOINT
app.get('/api/oauth/callback', async (req, res) => {
  console.log('=== OAUTH CALLBACK RECEIVED ===');
  console.log('Query params:', req.query);
  
  const { code, state, error } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=${encodeURIComponent(error)}`;
    return res.redirect(errorUrl);
  }

  if (!code) {
    console.error('Missing authorization code');
    const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=${encodeURIComponent('Missing authorization code')}`;
    return res.redirect(errorUrl);
  }

  try {
    console.log('=== TOKEN EXCHANGE STARTING ===');
    
    const credentials = await getOAuthCredentials();
    
    const tokenRequestData = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      code: String(code),
      redirect_uri: credentials.redirect_uri
    });

    console.log('Making token request to GoHighLevel...');
    
    const response = await axios.post('https://services.leadconnectorhq.com/oauth/token', 
      tokenRequestData.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log('=== TOKEN EXCHANGE SUCCESS ===');
    console.log('Access token received:', response.data.access_token ? 'YES' : 'NO');

    // Get user info
    let userInfo = null;
    try {
      const userResponse = await axios.get('https://services.leadconnectorhq.com/oauth/userinfo', {
        headers: { 'Authorization': `Bearer ${response.data.access_token}` },
        timeout: 10000
      });
      userInfo = userResponse.data;
      console.log('User info retrieved - Location ID:', userInfo.locationId);
    } catch (userError) {
      console.warn('Failed to get user info:', userError.message);
    }

    // Store installation
    const installationData = {
      ghlUserId: userInfo?.userId || `user_${Date.now()}`,
      ghlLocationId: userInfo?.locationId,
      ghlLocationName: userInfo?.locationName || 'GoHighLevel Account',
      ghlAccessToken: response.data.access_token,
      ghlRefreshToken: response.data.refresh_token,
      ghlTokenType: response.data.token_type || 'Bearer',
      ghlExpiresIn: response.data.expires_in || 3600,
      ghlScopes: response.data.scope,
      isActive: true,
      bridgeSource: 'replit',
      installationDate: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const installation = {
      id: oauthInstallations.length + 1,
      ...installationData
    };
    oauthInstallations.push(installation);

    console.log('=== INSTALLATION SAVED ===');
    console.log('Installation ID:', installation.id);
    console.log('Location ID:', installation.ghlLocationId);

    const successUrl = `https://dir.engageautomations.com/?oauth=success&installation_id=${installation.id}&location_id=${userInfo?.locationId || 'unknown'}`;
    console.log('Redirecting to success URL:', successUrl);
    
    return res.redirect(successUrl);

  } catch (error) {
    console.error('=== TOKEN EXCHANGE FAILED ===');
    console.error('Error:', error.message);
    
    if (axios.isAxiosError(error)) {
      console.error('Response status:', error.response?.status);
      console.error('Response data:', error.response?.data);
    }

    const errorMsg = encodeURIComponent('OAuth failed: ' + error.message);
    const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=${errorMsg}`;
    return res.redirect(errorUrl);
  }
});

app.get('/test', (req, res) => {
  res.json({ 
    message: 'Railway bridge backend working!', 
    timestamp: new Date().toISOString(),
    installations: oauthInstallations.length,
    bridge_system: 'active'
  });
});

app.listen(PORT, () => {
  console.log(`=== RAILWAY BRIDGE BACKEND STARTED ===`);
  console.log(`Port: ${PORT}`);
  console.log(`Bridge System: Replit Integration`);
  console.log(`Callback URL: https://dir.engageautomations.com/api/oauth/callback`);
  console.log(`Version: 2.3.0-bridge-main`);
});