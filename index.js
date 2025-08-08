/**
 * Enhanced OAuth Backend with Location Token Conversion
 * v10.0.0-location-conversion - Automatic Company â†’ Location token conversion
 * 
 * DEPLOYMENT INSTRUCTIONS:
 * 1. Copy this entire file content
 * 2. Replace the index.js content in the oauth-backend GitHub repository
 * 3. Update package.json version to "10.0.0-location-conversion"
 * 4. Railway will automatically deploy the changes
 */

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');

const app = express();

// Middleware
app.use(cors({
  origin: ['https://dir.engageautomations.com', 'http://localhost:3000', 'http://localhost:8080'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// In-memory storage
const installations = new Map();
const locationTokens = new Map(); // Store Location tokens separately

// File upload configuration
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    cb(null, allowedTypes.includes(file.mimetype));
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'GoHighLevel OAuth Backend',
    version: '10.0.0-location-conversion',
    features: [
      'location-user-type',
      'location-token-conversion',
      'media-upload',
      'token-refresh',
      'automatic-retry'
    ],
    debug: 'Company tokens automatically converted to Location tokens for media APIs'
  });
});

// LOCATION TOKEN CONVERSION FUNCTION
async function convertToLocationToken(companyToken, companyId, locationId) {
  try {
    const params = new URLSearchParams({
      companyId: companyId,
      locationId: locationId
    });

    console.log('[LOCATION-CONVERT] Converting Company token to Location token...');
    console.log('[LOCATION-CONVERT] Company ID:', companyId);
    console.log('[LOCATION-CONVERT] Location ID:', locationId);

    const response = await axios.post(
      'https://services.leadconnectorhq.com/oauth/locationToken',
      params,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Bearer ${companyToken}`,
          'Version': '2021-07-28',
          'Accept': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log('[LOCATION-CONVERT] âœ… Successfully converted Company token to Location token');
    
    // Decode and verify the new Location token
    const locationJWT = decodeJWT(response.data.access_token);
    console.log('[LOCATION-CONVERT] New token authClass:', locationJWT?.authClass);
    console.log('[LOCATION-CONVERT] New token authClassId:', locationJWT?.authClassId);
    
    return response.data;
  } catch (error) {
    console.error('[LOCATION-CONVERT] âŒ Conversion failed:', error.response?.data || error.message);
    throw error;
  }
}

// GET LOCATION TOKEN FOR INSTALLATION
async function getLocationToken(installationId) {
  const inst = installations.get(installationId);
  if (!inst || !inst.accessToken) {
    throw new Error('Installation not found');
  }

  // Check if we already have a valid location token
  if (locationTokens.has(installationId)) {
    const locationToken = locationTokens.get(installationId);
    
    // Check if location token is still valid (with 5 minute buffer)
    if (locationToken.expiresAt > Date.now() + (5 * 60 * 1000)) {
      console.log('[LOCATION-TOKEN] âœ… Using cached Location token for', installationId);
      return locationToken.accessToken;
    }
    
    // Location token expired, remove it
    console.log('[LOCATION-TOKEN] âš ï¸ Location token expired, removing cache for', installationId);
    locationTokens.delete(installationId);
  }

  // Convert Company token to Location token
  try {
    const jwt = decodeJWT(inst.accessToken);
    const companyId = jwt.authClassId;
    const locationId = inst.locationId || 'WAvk87RmW9rBSDJHeOpH'; // Use known working location

    console.log('[LOCATION-TOKEN] Starting conversion for', installationId);
    console.log('[LOCATION-TOKEN] Company authClass:', jwt.authClass);
    console.log('[LOCATION-TOKEN] Company authClassId:', companyId);

    const locationTokenData = await convertToLocationToken(
      inst.accessToken,
      companyId,
      locationId
    );

    // Store the location token
    locationTokens.set(installationId, {
      accessToken: locationTokenData.access_token,
      refreshToken: locationTokenData.refresh_token,
      expiresAt: Date.now() + (locationTokenData.expires_in * 1000),
      locationId: locationTokenData.locationId,
      userType: 'Location',
      createdAt: new Date().toISOString()
    });

    console.log('[LOCATION-TOKEN] âœ… Stored Location token for', installationId);
    console.log('[LOCATION-TOKEN] Location ID:', locationTokenData.locationId);
    
    return locationTokenData.access_token;

  } catch (error) {
    console.error('[LOCATION-TOKEN] âŒ Failed to get Location token for', installationId, ':', error.message);
    throw error;
  }
}

// JWT DECODE UTILITY
function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = parts[1];
    const paddedPayload = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decodedPayload = Buffer.from(paddedPayload, 'base64').toString('utf8');
    return JSON.parse(decodedPayload);
  } catch (error) {
    console.error('JWT decode error:', error.message);
    return null;
  }
}

// ENHANCED TOKEN REFRESH WITH LOCATION SUPPORT
async function enhancedRefreshAccessToken(id) {
  try {
    const inst = installations.get(id);
    if (!inst || !inst.refreshToken) {
      console.log(`[REFRESH] âŒ No refresh token for ${id}`);
      return false;
    }

    const body = new URLSearchParams({
      client_id: process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: inst.refreshToken,
      user_type: 'Location' // Keep using Location user type
    });

    const { data } = await axios.post('https://services.leadconnectorhq.com/oauth/token', body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    });

    // Update Company token
    inst.accessToken = data.access_token;
    inst.refreshToken = data.refresh_token;
    inst.expiresIn = data.expires_in;
    inst.expiresAt = Date.now() + data.expires_in * 1000;
    inst.tokenStatus = 'valid';
    inst.lastRefresh = new Date().toISOString();

    // Clear location token to force new conversion on next request
    if (locationTokens.has(id)) {
      console.log('[REFRESH] ðŸ”„ Clearing cached Location token to force reconversion');
      locationTokens.delete(id);
    }

    console.log(`[REFRESH] âœ… Refreshed tokens for ${id}`);
    scheduleRefreshSmart(id);
    return true;

  } catch (error) {
    console.error(`[REFRESH] âŒ Failed for ${id}:`, error.response?.data || error.message);
    const inst = installations.get(id);
    if (inst) {
      inst.tokenStatus = 'refresh_failed';
    }
    return false;
  }
}

// SMART TOKEN REFRESH SCHEDULING
function scheduleRefreshSmart(id) {
  const inst = installations.get(id);
  if (!inst) return;

  // Clear existing timeouts
  if (inst.refreshTimeout) {
    clearTimeout(inst.refreshTimeout);
  }

  // Schedule refresh at 80% of token lifetime (with 10 minute minimum padding)
  const lifetime = inst.expiresIn * 1000;
  const refreshTime = Math.max(lifetime * 0.8, lifetime - (10 * 60 * 1000));

  inst.refreshTimeout = setTimeout(async () => {
    console.log(`[SCHEDULE] ðŸ”„ Auto-refreshing token for ${id}`);
    await enhancedRefreshAccessToken(id);
  }, refreshTime);

  console.log(`[SCHEDULE] â° Token refresh scheduled for ${id} in ${Math.floor(refreshTime / 1000 / 60)} minutes`);
}

// Enhanced token exchange with retry logic and comprehensive error handling
async function exchangeCodeWithRetry(code, redirectUri, clientId, clientSecret, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`ðŸ”„ Token exchange attempt ${attempt}/${maxRetries}`);
      
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        user_type: 'Location' // Prevent user type issues
      });
      
      const response = await axios.post('https://services.leadconnectorhq.com/oauth/token', body, {
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        timeout: 15000
      });
      
      console.log(`âœ… Token exchange successful on attempt ${attempt}`);
      return response.data;
      
    } catch (error) {
      console.error(`âŒ Attempt ${attempt} failed:`, error.response?.data || error.message);
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
}

// Legacy function for backward compatibility
async function exchangeCode(code, redirectUri) {
  const clientId = process.env.GHL_CLIENT_ID || '68474924a586bce22a6e64f7-mbpkmyu4';
  const clientSecret = process.env.GHL_CLIENT_SECRET || 'b5a7a120-7df7-4d23-8796-4863cbd08f94';
  return await exchangeCodeWithRetry(code, redirectUri, clientId, clientSecret);
}

function storeInstall(tokenData) {
  const id = `install_${Date.now()}`;
  
  // Decode JWT to get auth class and location info
  const jwt = decodeJWT(tokenData.access_token);
  const authClass = jwt?.authClass || 'unknown';
  const locationId = jwt?.authClassId || tokenData.locationId || 'WAvk87RmW9rBSDJHeOpH';
  
  installations.set(id, {
    id,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresIn: tokenData.expires_in,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
    locationId: authClass === 'Location' ? locationId : 'WAvk87RmW9rBSDJHeOpH',
    scopes: tokenData.scope || '',
    tokenStatus: 'valid',
    authClass: authClass,
    method: 'user_type Location parameter + automatic conversion',
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString()
  });
  
  scheduleRefreshSmart(id);
  console.log(`[NEW INSTALL] ${id} stored with auth class: ${authClass}`);
  
  // Log token conversion capability
  if (authClass === 'Company') {
    console.log(`[NEW INSTALL] Company token detected - Location conversion available`);
  } else if (authClass === 'Location') {
    console.log(`[NEW INSTALL] Location token detected - direct usage available`);
  }
  
  return id;
}

// ENHANCED OAUTH CALLBACK WITH ERROR PREVENTION
app.get(['/oauth/callback', '/api/oauth/callback'], async (req, res) => {
  const startTime = Date.now();
  console.log('=== OAUTH CALLBACK - ERROR PREVENTION MODE ===');
  console.log('ðŸ“¥ Query params:', req.query);
  console.log('ðŸŒ Request URL:', req.url);
  console.log('ðŸ”— Referer:', req.get('Referer'));
  
  const { code, error, state, location_id } = req.query;
  
  // ERROR PREVENTION CHECK #1: OAuth Error Parameter
  if (error) {
    console.error('âŒ OAuth error from GoHighLevel:', error);
    return res.redirect(`https://dir.engageautomations.com/?error=oauth_denied&details=${error}&timestamp=${Date.now()}`);
  }
  
  // ERROR PREVENTION CHECK #2: Missing Authorization Code
  if (!code) {
    console.error('âŒ No authorization code received');
    console.log('ðŸ” Full query object:', JSON.stringify(req.query, null, 2));
    return res.redirect(`https://dir.engageautomations.com/?error=no_code&timestamp=${Date.now()}`);
  }
  
  // ERROR PREVENTION CHECK #3: Code Format Validation
  if (code.length < 10) {
    console.error('âŒ Authorization code too short:', code.length);
    return res.redirect(`https://dir.engageautomations.com/?error=invalid_code_format&timestamp=${Date.now()}`);
  }
  
  try {
    // ERROR PREVENTION CHECK #4: Environment Variables with Fallbacks
    const clientId = process.env.GHL_CLIENT_ID || '68474924a586bce22a6e64f7-mbpkmyu4';
    const clientSecret = process.env.GHL_CLIENT_SECRET || 'b5a7a120-7df7-4d23-8796-4863cbd08f94';
    const redirectUri = process.env.GHL_REDIRECT_URI || 'https://dir.engageautomations.com/api/oauth/callback';
    
    console.log('ðŸ”‘ Using CLIENT_ID:', clientId.substring(0, 8) + '...');
    console.log('ðŸ”— Using REDIRECT_URI:', redirectUri);
    
    // ERROR PREVENTION CHECK #5: Immediate Token Exchange (prevent expiration)
    console.log('âš¡ Starting immediate token exchange...');
    const tokenData = await exchangeCodeWithRetry(code, redirectUri, clientId, clientSecret);
    
    // ERROR PREVENTION CHECK #6: Token Validation
    if (!tokenData.access_token) {
      throw new Error('No access token received');
    }
    
    console.log('âœ… Token exchange successful');
    const processingTime = Date.now() - startTime;
    console.log(`â±ï¸ Processing time: ${processingTime}ms`);
    
    const id = storeInstall(tokenData);
    console.log('ðŸ’¾ Installation stored with ID:', id);
    
    // SUCCESS: Redirect with installation data
    const url = `https://dir.engageautomations.com/?installation_id=${id}&welcome=true&processing_time=${processingTime}`;
    console.log('ðŸŽ‰ Redirecting to success page:', url);
    res.redirect(url);
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('âŒ OAuth callback error:', error.response?.data || error.message);
    console.error('â±ï¸ Failed after:', processingTime + 'ms');
    
    // Enhanced error reporting
    const errorDetails = {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      processing_time: processingTime,
      timestamp: Date.now()
    };
    
    const url = `https://dir.engageautomations.com/?error=oauth_failed&details=${encodeURIComponent(JSON.stringify(errorDetails))}`;
    res.redirect(url);
  }
});

// INSTALLATIONS ENDPOINT
app.get('/installations', (req, res) => {
  const installList = Array.from(installations.values()).map(inst => ({
    id: inst.id,
    location_id: inst.locationId,
    active: true,
    created_at: inst.createdAt,
    token_status: inst.tokenStatus,
    auth_class: inst.authClass,
    method: inst.method,
    scopes: inst.scopes,
    has_location_token: locationTokens.has(inst.id)
  }));
  
  res.json({
    count: installations.size,
    installations: installList
  });
});

// TOKEN ACCESS ENDPOINT (Company tokens)
app.get('/api/token-access/:id', async (req, res) => {
  try {
    const inst = installations.get(req.params.id);
    if (!inst) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    // Check token freshness
    if (inst.expiresAt <= Date.now()) {
      const refreshed = await enhancedRefreshAccessToken(req.params.id);
      if (!refreshed) {
        return res.status(401).json({ error: 'Token expired and refresh failed' });
      }
    }

    const jwt = decodeJWT(inst.accessToken);
    
    res.json({
      access_token: inst.accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor((inst.expiresAt - Date.now()) / 1000),
      scope: inst.scopes,
      location_id: inst.locationId,
      auth_class: jwt?.authClass || 'unknown'
    });
  } catch (error) {
    console.error('Token access error:', error.message);
    res.status(500).json({ error: 'Token access failed', details: error.message });
  }
});

// LOCATION TOKEN ACCESS ENDPOINT - NEW
app.get('/api/location-token/:id', async (req, res) => {
  try {
    console.log('[LOCATION-ENDPOINT] Request for Location token:', req.params.id);
    
    const locationToken = await getLocationToken(req.params.id);
    const locationTokenData = locationTokens.get(req.params.id);
    
    res.json({
      access_token: locationToken,
      token_type: 'Bearer',
      expires_in: Math.floor((locationTokenData.expiresAt - Date.now()) / 1000),
      location_id: locationTokenData.locationId,
      auth_class: 'Location',
      created_at: locationTokenData.createdAt
    });
  } catch (error) {
    console.error('Location token access error:', error.message);
    res.status(500).json({ 
      error: 'Location token access failed', 
      details: error.message,
      hint: 'Company token may not have oauth.write scope or location conversion failed'
    });
  }
});

// ENHANCED MEDIA UPLOAD WITH AUTOMATIC LOCATION TOKEN CONVERSION
app.post('/api/media/upload', upload.single('file'), async (req, res) => {
  console.log('=== ENHANCED MEDIA UPLOAD WITH LOCATION TOKEN ===');
  
  try {
    const { installation_id } = req.body;
    
    if (!installation_id) {
      return res.status(400).json({ success: false, error: 'installation_id required' });
    }
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'file required' });
    }
    
    console.log(`[MEDIA] Uploading file: ${req.file.originalname} with automatic Location token conversion`);
    
    // Get Location token for media upload
    const locationToken = await getLocationToken(installation_id);
    const locationTokenData = locationTokens.get(installation_id);
    
    // Create form data for GoHighLevel API
    const formData = new FormData();
    formData.append('file', fs.createReadStream(req.file.path), {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });
    
    // Upload using Location token
    console.log(`[MEDIA] Using Location token for upload to location: ${locationTokenData.locationId}`);
    
    const uploadResponse = await axios.post(
      'https://services.leadconnectorhq.com/medias/upload-file',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${locationToken}`,
          'Version': '2021-07-28',
          ...formData.getHeaders()
        },
        maxBodyLength: Infinity,
        timeout: 30000
      }
    );
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    console.log('[MEDIA] âœ… Upload successful with Location token');
    res.json({
      success: true,
      message: 'File uploaded successfully with Location token',
      data: uploadResponse.data,
      tokenType: 'Location',
      locationId: locationTokenData.locationId,
      conversionUsed: true
    });
    
  } catch (error) {
    // Clean up file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    const errorMessage = error.response?.data?.message || error.message;
    const statusCode = error.response?.status || 500;
    
    console.error('[MEDIA] âŒ Upload failed:', errorMessage);
    console.error('[MEDIA] Status:', statusCode);
    
    res.status(statusCode).json({
      success: false,
      error: 'Media upload failed',
      details: errorMessage,
      tokenType: 'Location',
      hint: statusCode === 401 ? 'Location token may have expired or insufficient permissions' : 'Check file format and size'
    });
  }
});

// OAUTH STATUS
app.get('/api/oauth/status', (req, res) => {
  const inst = installations.get(req.query.installation_id);
  if (!inst) return res.json({ authenticated: false });
  
  const hasLocationToken = locationTokens.has(req.query.installation_id);
  
  res.json({ 
    authenticated: true, 
    tokenStatus: inst.tokenStatus, 
    locationId: inst.locationId,
    authClass: inst.authClass,
    hasLocationToken: hasLocationToken,
    conversionAvailable: inst.authClass === 'Company'
  });
});

// TOKEN HEALTH ENDPOINT
app.get('/api/token-health/:id', async (req, res) => {
  const inst = installations.get(req.params.id);
  if (!inst) {
    return res.status(404).json({ error: 'Installation not found' });
  }

  const timeUntilExpiry = Math.floor((inst.expiresAt - Date.now()) / 1000 / 60);
  const hasLocationToken = locationTokens.has(req.params.id);
  
  let locationTokenInfo = null;
  if (hasLocationToken) {
    const locToken = locationTokens.get(req.params.id);
    locationTokenInfo = {
      expiresIn: Math.floor((locToken.expiresAt - Date.now()) / 1000 / 60),
      locationId: locToken.locationId,
      createdAt: locToken.createdAt
    };
  }
  
  res.json({
    installationId: req.params.id,
    tokenStatus: inst.tokenStatus,
    authClass: inst.authClass,
    timeUntilExpiry: timeUntilExpiry,
    locationId: inst.locationId,
    hasLocationToken: hasLocationToken,
    locationTokenInfo: locationTokenInfo,
    lastRefresh: inst.lastRefresh || 'never'
  });
});

// MANUAL LOCATION TOKEN CONVERSION ENDPOINT
app.post('/api/convert-to-location/:id', async (req, res) => {
  try {
    console.log('[MANUAL-CONVERT] Manual Location token conversion requested for:', req.params.id);
    
    const locationToken = await getLocationToken(req.params.id);
    const locationTokenData = locationTokens.get(req.params.id);
    
    res.json({
      success: true,
      message: 'Location token conversion successful',
      locationId: locationTokenData.locationId,
      expiresIn: Math.floor((locationTokenData.expiresAt - Date.now()) / 1000),
      createdAt: locationTokenData.createdAt
    });
    
  } catch (error) {
    console.error('[MANUAL-CONVERT] âŒ Manual conversion failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Location token conversion failed',
      details: error.message
    });
  }
});

// OAuth validation endpoint for debugging
app.get('/api/oauth/validate', (req, res) => {
  const config = {
    clientId: process.env.GHL_CLIENT_ID || '68474924a586bce22a6e64f7-mbpkmyu4',
    clientSecret: process.env.GHL_CLIENT_SECRET ? '***CONFIGURED***' : 'FALLBACK_USED',
    redirectUri: process.env.GHL_REDIRECT_URI || 'https://dir.engageautomations.com/api/oauth/callback',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  };
  
  res.json({
    status: 'OAuth configuration validated',
    config,
    installations: Object.keys(installations).length,
    locationTokens: Object.keys(locationTokens).length
  });
});

// Error monitoring endpoint
app.get('/api/oauth/errors', (req, res) => {
  // This would typically connect to a logging service
  res.json({
    message: 'Error monitoring endpoint active',
    commonErrors: [
      'invalid_grant - Authorization code expired or already used',
      'redirect_uri_mismatch - Redirect URI doesn\'t match app configuration',
      'invalid_client - Client ID/Secret mismatch',
      'unsupported_grant_type - Grant type not supported'
    ],
    preventionTips: [
      'Use authorization codes immediately after receiving them',
      'Verify redirect URI matches exactly in GHL app settings',
      'Check environment variables are properly set',
      'Implement retry logic for temporary failures'
    ]
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`ðŸš€ Enhanced OAuth Backend v10.0.0 running on port ${PORT}`);
  console.log('âœ… Location token conversion enabled');
  console.log('âœ… Automatic Company â†’ Location token conversion for media APIs');
  console.log('âœ… Enhanced token management with dual token storage');
  console.log('');
  console.log('ðŸ“‹ NEW ENDPOINTS:');
  console.log('â€¢ GET /api/location-token/:id - Get Location token for installation');
  console.log('â€¢ POST /api/convert-to-location/:id - Manual Location token conversion');
  console.log('â€¢ POST /api/media/upload - Enhanced media upload with Location tokens');
  console.log('â€¢ GET /api/oauth/validate - OAuth configuration validation');
  console.log('â€¢ GET /api/oauth/errors - Error monitoring and debugging');
  console.log('');
  console.log('ðŸ”„ Token Conversion Flow:');
  console.log('1. Company token received from OAuth');
  console.log('2. Location token generated on first media upload');
  console.log('3. Location token cached for subsequent requests');
  console.log('4. Automatic reconversion after token refresh');
});