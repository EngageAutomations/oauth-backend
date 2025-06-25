// Railway OAuth Backend with Bridge System
// GitHub: https://github.com/EngageAutomations/oauth-backend
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

const storage = {
  createInstallation(installationData) {
    const installation = {
      id: oauthInstallations.length + 1,
      ...installationData,
      installationDate: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    oauthInstallations.push(installation);
    return installation;
  },

  getAllInstallations() {
    return oauthInstallations.sort((a, b) => new Date(b.installationDate) - new Date(a.installationDate));
  },

  getInstallationByUserId(ghlUserId) {
    return oauthInstallations
      .filter(install => install.ghlUserId === ghlUserId)
      .sort((a, b) => new Date(b.installationDate) - new Date(a.installationDate))[0];
  }
};

// Get OAuth credentials from bridge
async function getOAuthCredentials() {
  if (cachedCredentials && cachedCredentials.expires > Date.now()) {
    return cachedCredentials.data;
  }

  try {
    const response = await axios.get(`${BRIDGE_BASE_URL}/api/bridge/oauth-credentials`, { 
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
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
    version: "2.2.0-bridge-integrated",
    installs: oauthInstallations.length,
    authenticated: oauthInstallations.filter(i => i.isActive).length,
    status: "operational",
    features: ["oauth-integration", "bridge-system"],
    bridge_system: "replit-integration",
    ts: Date.now()
  });
});

app.get('/installations', (req, res) => {
  res.json({
    total: oauthInstallations.length,
    installations: oauthInstallations.map(install => ({
      id: install.id,
      ghlUserId: install.ghlUserId,
      ghlLocationId: install.ghlLocationId,
      ghlLocationName: install.ghlLocationName,
      isActive: install.isActive,
      installationDate: install.installationDate
    })),
    authenticated: oauthInstallations.filter(i => i.isActive).length
  });
});

app.get('/api/oauth/url', async (req, res) => {
  try {
    const credentials = await getOAuthCredentials();
    
    const scopes = 'locations.readonly locations.write contacts.readonly contacts.write opportunities.readonly opportunities.write products.readonly products.write medias.readonly medias.write';
    const state = `oauth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const authUrl = `https://marketplace.leadconnectorhq.com/oauth/chooselocation?response_type=code&redirect_uri=${encodeURIComponent(credentials.redirect_uri)}&client_id=${credentials.client_id}&state=${state}&scope=${encodeURIComponent(scopes)}`;
    
    res.json({
      success: true,
      authUrl: authUrl,
      state: state,
      clientId: credentials.client_id,
      redirectUri: credentials.redirect_uri,
      bridge_source: 'replit'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to generate OAuth URL',
      message: error.message
    });
  }
});

// OAuth callback - FIXED
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
      bridgeSource: 'replit'
    };

    const savedInstallation = storage.createInstallation(installationData);
    console.log('=== INSTALLATION SAVED ===');
    console.log('Installation ID:', savedInstallation.id);
    console.log('Location ID:', savedInstallation.ghlLocationId);

    const successUrl = `https://dir.engageautomations.com/?oauth=success&installation_id=${savedInstallation.id}&location_id=${userInfo?.locationId || 'unknown'}`;
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

app.get('/health', async (req, res) => {
  try {
    const credentials = await getOAuthCredentials();
    res.json({
      status: 'healthy',
      bridge_connection: 'working',
      credentials_available: !!credentials.client_id,
      installations: oauthInstallations.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      bridge_connection: 'failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path,
    method: req.method,
    availableEndpoints: [
      'GET /',
      'GET /installations', 
      'GET /api/oauth/callback',
      'GET /api/oauth/url',
      'GET /test',
      'GET /health'
    ]
  });
});

app.listen(PORT, () => {
  console.log(`=== RAILWAY BRIDGE BACKEND STARTED ===`);
  console.log(`Port: ${PORT}`);
  console.log(`Bridge System: Replit Integration`);
  console.log(`Callback URL: https://dir.engageautomations.com/api/oauth/callback`);
  console.log(`Bridge URL: ${BRIDGE_BASE_URL}`);
  console.log(`Version: 2.2.0-bridge-integrated`);
});