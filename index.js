// Minimal Secure Railway Backend
// Simplified version for reliable deployment

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// In-memory install store
const installations = new Map();

// OAuth credentials from environment variables
const getOAuthCredentials = () => {
  return {
    clientId: process.env.GHL_CLIENT_ID || 'your-client-id',
    clientSecret: process.env.GHL_CLIENT_SECRET || 'your-client-secret',
    scopes: process.env.GHL_SCOPES || 'products.write medias.write',
    redirectBase: process.env.GHL_REDIRECT_URI || 'https://dir.engageautomations.com'
  };
};

// ENHANCED TOKEN LIFECYCLE HELPERS
const PADDING_MS = 10 * 60 * 1000; // 10 minutes padding for early expiry protection
const refreshers = new Map();

async function enhancedRefreshAccessToken(id) {
  const inst = installations.get(id);
  
  if (!inst) {
    console.log(`[REFRESH] Installation ${id} not found`);
    return false;
  }

  if (!inst.refreshToken) {
    console.log(`[REFRESH] No refresh token for ${id} - OAuth reinstall required`);
    inst.tokenStatus = 'refresh_required';
    return false;
  }

  try {
    console.log(`[REFRESH] Attempting token refresh for ${id}`);
    
    const credentials = getOAuthCredentials();
    
    const body = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: inst.refreshToken
    });

    const { data } = await axios.post(
      'https://services.leadconnectorhq.com/oauth/token',
      body,
      { 
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
        timeout: 15000 
      }
    );

    // Update installation with new tokens
    inst.accessToken = data.access_token;
    inst.refreshToken = data.refresh_token || inst.refreshToken;
    inst.expiresIn = data.expires_in;
    inst.expiresAt = Date.now() + data.expires_in * 1000;
    inst.tokenStatus = 'valid';
    inst.lastRefresh = new Date().toISOString();
    
    console.log(`[REFRESH] ✅ Token refreshed successfully for ${id}`);
    console.log(`[REFRESH] New expiry: ${new Date(inst.expiresAt).toISOString()}`);
    
    // Schedule next refresh
    scheduleRefreshSmart(id);
    
    return true;
    
  } catch (error) {
    console.error(`[REFRESH] ❌ Failed for ${id}:`, error.response?.data || error.message);
    
    if (error.response?.data?.error === 'invalid_grant') {
      console.log(`[REFRESH] Refresh token expired for ${id} - OAuth reinstall required`);
      inst.tokenStatus = 'refresh_expired';
    } else {
      inst.tokenStatus = 'refresh_failed';
    }
    
    return false;
  }
}

// Enhanced refresh scheduling
function scheduleRefreshSmart(id) {
  const inst = installations.get(id);
  if (!inst) return;

  // Clear existing refresh timer
  if (refreshers.has(id)) {
    clearTimeout(refreshers.get(id));
  }

  // Calculate time until refresh needed (refresh at 80% of token lifetime)
  const timeUntilExpiry = inst.expiresAt - Date.now();
  const refreshTime = Math.max(timeUntilExpiry * 0.8, 5 * 60 * 1000); // Minimum 5 minutes
  
  console.log(`[SCHEDULE] ${id} refresh scheduled in ${Math.round(refreshTime / 60000)} minutes`);

  const timer = setTimeout(async () => {
    console.log(`[SCHEDULE] Executing scheduled refresh for ${id}`);
    await enhancedRefreshAccessToken(id);
  }, refreshTime);

  refreshers.set(id, timer);
}

// OAUTH ENDPOINTS
app.get('/api/oauth/url', async (req, res) => {
  try {
    const credentials = getOAuthCredentials();
    const redirectUri = `${credentials.redirectBase}/api/oauth/callback`;
    
    const oauthUrl = `https://marketplace.leadconnectorhq.com/oauth/chooselocation?response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${credentials.clientId}&scope=${encodeURIComponent(credentials.scopes)}`;
    
    console.log('[OAUTH] Generated OAuth URL');
    
    res.json({
      success: true,
      oauthUrl,
      clientId: credentials.clientId.substring(0, 8) + '...',
      scopes: credentials.scopes,
      redirectUri
    });
    
  } catch (error) {
    console.error('[OAUTH] Failed to generate OAuth URL:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to generate OAuth URL',
      message: error.message
    });
  }
});

app.get('/api/oauth/callback', async (req, res) => {
  const { code, state } = req.query;
  
  if (!code) {
    return res.status(400).json({
      success: false,
      error: 'Authorization code missing'
    });
  }

  try {
    console.log('[OAUTH] Processing callback with authorization code');
    
    const credentials = getOAuthCredentials();
    const redirectUri = `${credentials.redirectBase}/api/oauth/callback`;
    
    // Exchange code for tokens
    const body = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri
    });

    const { data } = await axios.post(
      'https://services.leadconnectorhq.com/oauth/token',
      body,
      { 
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000 
      }
    );

    // Create installation
    const installationId = `install_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const installation = {
      id: installationId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      expiresAt: Date.now() + data.expires_in * 1000,
      locationId: data.locationId || 'unknown',
      scopes: data.scope || credentials.scopes,
      tokenStatus: 'valid',
      createdAt: new Date().toISOString(),
      lastRefresh: null
    };

    installations.set(installationId, installation);
    
    // Schedule token refresh
    scheduleRefreshSmart(installationId);
    
    console.log(`[OAUTH] ✅ Installation created: ${installationId}`);
    console.log(`[OAUTH] Location ID: ${installation.locationId}`);
    console.log(`[OAUTH] Token expires: ${new Date(installation.expiresAt).toISOString()}`);
    
    res.json({
      success: true,
      installationId,
      locationId: installation.locationId,
      expiresAt: installation.expiresAt,
      message: 'OAuth installation completed successfully'
    });
    
  } catch (error) {
    console.error('[OAUTH] ❌ Callback processing failed:', error.response?.data || error.message);
    
    res.status(500).json({
      success: false,
      error: 'OAuth callback processing failed',
      message: error.message,
      details: error.response?.data
    });
  }
});

// WELCOME ENDPOINT
app.get('/welcome', (req, res) => {
  res.json({
    message: 'Railway OAuth Backend - Minimal Secure Version',
    version: '7.0.0-minimal',
    features: ['oauth', 'products', 'images', 'pricing', 'media-upload'],
    timestamp: new Date().toISOString(),
    installations: installations.size
  });
});

// HEALTH CHECK
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '7.0.0-minimal',
    timestamp: new Date().toISOString(),
    installations: installations.size
  });
});

// ROOT ENDPOINT
app.get('/', (req, res) => {
  res.json({
    name: 'Railway OAuth Backend - Minimal Secure Version',
    version: '7.0.0-minimal',
    status: 'operational',
    installations: installations.size,
    endpoints: [
      'GET /',
      'GET /health',
      'GET /welcome',
      'GET /api/oauth/url',
      'GET /api/oauth/callback',
      'GET /installations'
    ],
    timestamp: new Date().toISOString()
  });
});

// INSTALLATIONS ENDPOINT
app.get('/installations', (req, res) => {
  const installList = Array.from(installations.values()).map(inst => ({
    id: inst.id,
    locationId: inst.locationId,
    tokenStatus: inst.tokenStatus,
    expiresAt: inst.expiresAt,
    createdAt: inst.createdAt,
    lastRefresh: inst.lastRefresh,
    timeUntilExpiry: Math.max(0, inst.expiresAt - Date.now())
  }));

  res.json({
    success: true,
    count: installations.size,
    installations: installList,
    timestamp: new Date().toISOString()
  });
});

// Initialize with environment token if available
async function initializeServer() {
  try {
    console.log('[STARTUP] Initializing minimal secure backend...');
    
    // Pre-seed installation if we have access token in env
    if (process.env.GHL_ACCESS_TOKEN) {
      installations.set('install_seed', {
        id: 'install_seed',
        accessToken: process.env.GHL_ACCESS_TOKEN,
        refreshToken: process.env.GHL_REFRESH_TOKEN || null,
        expiresIn: 86399,
        expiresAt: Date.now() + 86399 * 1000,
        locationId: process.env.GHL_LOCATION_ID || 'WAvk87RmW9rBSDJHeOpH',
        scopes: getOAuthCredentials().scopes,
        tokenStatus: 'valid',
        createdAt: new Date().toISOString()
      });
      console.log('[STARTUP] Pre-seeded installation created');
    }
    
    console.log('[STARTUP] ✅ Initialization complete');
    
  } catch (error) {
    console.error('[STARTUP] ❌ Initialization failed:', error.message);
  }
}

// Start server
async function startServer() {
  await initializeServer();
  
  app.listen(port, () => {
    console.log(`🚀 Railway OAuth Backend - Minimal Secure Version running on port ${port}`);
    console.log(`🔗 Backend URL: http://localhost:${port}`);
    console.log(`📊 Installations: ${installations.size}`);
  });
}

startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});