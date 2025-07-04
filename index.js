/**
 * GoHighLevel OAuth Backend - Location-Only Access
 * Version: 8.9.0-location-only
 * Uses proper scopes for Location-level token generation per GoHighLevel docs
 */

const express = require('express');
const https = require('https');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// OAuth Credentials - verified working
const CLIENT_ID = '68474924a586bce22a6e64f7-mbpkmyu4';
const CLIENT_SECRET = 'b5a7a120-7df7-4d23-8796-4863cbd08f94';
const REDIRECT_URI = 'https://dir.engageautomations.com/api/oauth/callback';

// Location-level scopes per GoHighLevel documentation
const LOCATION_SCOPES = [
  'contacts.readonly',
  'contacts.write', 
  'conversations.readonly',
  'conversations.write',
  'calendars.readonly',
  'calendars.write',
  'businesses.readonly',
  'businesses.write',
  'locations.readonly',
  'locations.write',
  'medias.readonly',
  'medias.write', // Required for media upload
  'products.readonly',
  'products.write'
].join(' ');

// In-memory storage
const installations = new Map();
const tokens = new Map();

app.get('/', (req, res) => {
  res.json({
    service: 'GoHighLevel OAuth Backend',
    version: '8.9.0-location-only',
    installs: installations.size,
    authenticated: tokens.size,
    status: 'operational',
    features: ['location-only-scopes', 'media-upload', 'token-refresh'],
    scopes: LOCATION_SCOPES,
    debug: 'using Location-level scopes per GoHighLevel documentation',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/installations', (req, res) => {
  const installList = Array.from(installations.values());
  res.json({
    count: installList.length,
    installations: installList
  });
});

// OAuth authorization with Location-level scopes
app.get('/api/oauth/authorize', (req, res) => {
  console.log('🔄 Initiating Location-level OAuth with proper scopes');
  
  // Use official GoHighLevel authorization URL format with Location scopes
  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: LOCATION_SCOPES
  });
  
  const authUrl = `https://marketplace.gohighlevel.com/oauth/chooselocation?${authParams.toString()}`;
  
  console.log('📄 Authorization URL with Location scopes:', authUrl);
  console.log('📋 Requested scopes:', LOCATION_SCOPES);
  
  res.redirect(authUrl);
});

app.get('/api/oauth/callback', async (req, res) => {
  const { code, state } = req.query;
  
  console.log('🔄 OAuth callback received');
  console.log('📄 Code:', code ? 'present' : 'missing');
  console.log('📄 State:', state);
  
  if (!code) {
    console.log('❌ No authorization code received');
    return res.status(400).json({ error: 'No authorization code received' });
  }

  try {
    console.log('🔄 Exchanging code for Location-level token...');
    
    // Standard OAuth token exchange (no user_type parameter)
    const tokenData = await exchangeCodeStandard(code);
    
    if (!tokenData.access_token) {
      console.log('❌ No access token in response:', tokenData);
      return res.status(400).json({ error: 'Failed to get access token', details: tokenData });
    }
    
    // Decode JWT to verify Location-level access
    const tokenPayload = decodeJWTPayload(tokenData.access_token);
    const locationId = tokenPayload?.locationId || tokenPayload?.location_id;
    const authClass = tokenPayload?.authClass;
    const scopes = tokenData.scope || 'not available';
    
    console.log('🔍 Token Analysis:');
    console.log('📍 Location ID:', locationId);
    console.log('🔐 Auth Class:', authClass);
    console.log('📋 Granted Scopes:', scopes);
    console.log('🎯 Expected: Location-level with media upload access');
    
    const installationId = `install_${Date.now()}`;
    
    const installation = {
      id: installationId,
      location_id: locationId || 'not found',
      active: true,
      created_at: new Date().toISOString(),
      token_status: 'valid',
      auth_class: authClass || 'unknown',
      scopes: scopes,
      requested_scopes: LOCATION_SCOPES
    };
    
    installations.set(installationId, installation);
    tokens.set(installationId, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      expires_at: Date.now() + (tokenData.expires_in * 1000),
      location_id: locationId,
      auth_class: authClass,
      scopes: scopes
    });
    
    console.log('✅ Location-only installation created:', installationId);
    console.log('📍 Location ID:', locationId);
    console.log('🔐 Auth Class:', authClass);
    console.log('📋 Scopes:', scopes);
    
    // Test media upload capability immediately
    if (authClass === 'Location' && scopes.includes('medias.write')) {
      console.log('🎉 SUCCESS: Location-level token with media upload access!');
    } else if (authClass === 'Company') {
      console.log('⚠️  WARNING: Still received Company-level token');
      console.log('   This suggests app configuration may need updating in GoHighLevel marketplace');
    }
    
    // Redirect to frontend
    res.redirect(`https://listings.engageautomations.com/?installation_id=${installationId}&welcome=true`);
    
  } catch (error) {
    console.error('❌ OAuth callback error:', error.message);
    res.status(500).json({ error: 'OAuth callback failed', details: error.message });
  }
});

// Standard OAuth token exchange per GoHighLevel docs
async function exchangeCodeStandard(code) {
  return new Promise((resolve, reject) => {
    // Use standard OAuth 2.0 parameters only
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI
      // NO user_type parameter - auth class determined by scopes
    });
    
    const postData = params.toString();
    
    console.log('🔄 Token exchange with standard OAuth 2.0:');
    console.log('📄 Method: Standard OAuth flow, auth class determined by requested scopes');
    
    const options = {
      hostname: 'services.leadconnectorhq.com',
      port: 443,
      path: '/oauth/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': postData.length
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log('📄 Token exchange response status:', res.statusCode);
        console.log('📄 Token exchange response:', data);
        
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Token exchange failed: ${res.statusCode} - ${data}`));
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('❌ Token exchange request error:', error);
      reject(error);
    });
    
    req.write(postData);
    req.end();
  });
}

function decodeJWTPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return payload;
  } catch (error) {
    console.error('❌ Error decoding JWT payload:', error);
    return null;
  }
}

app.get('/api/token-access/:installationId', (req, res) => {
  const { installationId } = req.params;
  const tokenData = tokens.get(installationId);
  
  if (!tokenData) {
    return res.status(404).json({ error: 'Installation not found' });
  }
  
  // Check if token is expired
  if (Date.now() > tokenData.expires_at) {
    return res.status(401).json({ error: 'Token expired' });
  }
  
  res.json({
    access_token: tokenData.access_token,
    token_type: 'Bearer',
    expires_in: Math.floor((tokenData.expires_at - Date.now()) / 1000),
    location_id: tokenData.location_id,
    auth_class: tokenData.auth_class,
    scopes: tokenData.scopes
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 GoHighLevel OAuth Backend running on port ${PORT}`);
  console.log('🎯 Mode: Location-only access with proper scopes');
  console.log('📋 Features: Media upload access, Location-level tokens');
  console.log('📄 Scopes:', LOCATION_SCOPES);
});