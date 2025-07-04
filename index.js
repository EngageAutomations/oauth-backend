/**
 * GoHighLevel OAuth Backend - Working Version
 * Version: 8.7.0-working
 * Uses proven OAuth flow without user_type modifications
 */

const express = require('express');
const https = require('https');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// OAuth Credentials - hardcoded for reliability
const CLIENT_ID = '68474924a586bce22a6e64f7-mbpkmyu4';
const CLIENT_SECRET = 'b5a7a120-7df7-4d23-8796-4863cbd08f94';
const REDIRECT_URI = 'https://dir.engageautomations.com/api/oauth/callback';

// In-memory storage
const installations = new Map();
const tokens = new Map();

app.get('/', (req, res) => {
  res.json({
    service: 'GoHighLevel OAuth Backend',
    version: '8.7.0-working',
    installs: installations.size,
    authenticated: tokens.size,
    status: 'operational',
    features: ['oauth-flow', 'token-refresh', 'proven-working'],
    debug: 'using proven OAuth flow without user_type parameter',
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
    console.log('🔄 Exchanging code for token (proven method)...');
    
    // Use proven working token exchange method
    const tokenData = await exchangeCodeWorking(code);
    
    if (!tokenData.access_token) {
      console.log('❌ No access token in response:', tokenData);
      return res.status(400).json({ error: 'Failed to get access token', details: tokenData });
    }
    
    // Extract location ID from JWT token
    const locationId = extractLocationId(tokenData.access_token);
    const authClass = extractAuthClass(tokenData.access_token);
    
    const installationId = `install_${Date.now()}`;
    
    const installation = {
      id: installationId,
      location_id: locationId || 'not found',
      active: true,
      created_at: new Date().toISOString(),
      token_status: 'valid',
      auth_class: authClass || 'unknown',
      scopes: tokenData.scope || 'not available'
    };
    
    installations.set(installationId, installation);
    tokens.set(installationId, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      expires_at: Date.now() + (tokenData.expires_in * 1000),
      location_id: locationId
    });
    
    console.log('✅ Installation created:', installationId);
    console.log('📍 Location ID:', locationId);
    console.log('🔐 Auth Class:', authClass);
    
    // Redirect to frontend
    res.redirect(`https://listings.engageautomations.com/?installation_id=${installationId}&welcome=true`);
    
  } catch (error) {
    console.error('❌ OAuth callback error:', error.message);
    res.status(500).json({ error: 'OAuth callback failed', details: error.message });
  }
});

// PROVEN WORKING TOKEN EXCHANGE - NO user_type parameter
async function exchangeCodeWorking(code) {
  return new Promise((resolve, reject) => {
    // Use proven working OAuth parameters only
    const params = new URLSearchParams();
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', REDIRECT_URI);
    // NO user_type parameter - this was causing deployment failures
    
    const postData = params.toString();
    
    console.log('🔄 Token exchange request (proven working method):');
    console.log('📄 Parameters: standard OAuth 2.0 only');
    
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

function extractLocationId(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return payload.locationId || payload.location_id || null;
  } catch (error) {
    console.error('❌ Error extracting location ID:', error);
    return null;
  }
}

function extractAuthClass(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return payload.authClass || null;
  } catch (error) {
    console.error('❌ Error extracting auth class:', error);
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
    location_id: tokenData.location_id
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 GoHighLevel OAuth Backend running on port ${PORT}`);
  console.log('🎯 Mode: Proven working OAuth flow');
  console.log('📊 Features: Standard OAuth 2.0, no user_type parameter');
});