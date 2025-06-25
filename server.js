const express = require('express');
const https = require('https');
const querystring = require('querystring');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let installations = [];

// Get OAuth credentials from Replit bridge
async function getBridgeCredentials() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'gohighlevel-oauth-marketplace-application.replit.app',
      path: '/api/bridge/oauth-credentials',
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.success ? parsed.credentials : null);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

app.get('/', (req, res) => {
  res.json({
    service: "GoHighLevel OAuth Backend",
    version: "3.0.0-complete",
    installs: installations.length,
    authenticated: installations.filter(i => i.ghlAccessToken).length,
    status: "operational",
    bridge_system: "active",
    ts: Date.now()
  });
});

app.get('/api/oauth/callback', async (req, res) => {
  console.log('OAuth callback received:', req.query);
  
  const { code, error } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    return res.redirect(`https://dir.engageautomations.com/?oauth=error&message=${encodeURIComponent(error)}`);
  }

  if (!code) {
    console.error('Missing authorization code');
    return res.redirect(`https://dir.engageautomations.com/?oauth=error&message=Missing%20authorization%20code`);
  }

  try {
    // Get credentials from bridge
    const credentials = await getBridgeCredentials();
    if (!credentials) {
      throw new Error('Bridge credentials not available');
    }

    console.log('Starting token exchange with GoHighLevel...');

    // Exchange code for tokens
    const tokenData = await new Promise((resolve, reject) => {
      const postData = querystring.stringify({
        grant_type: 'authorization_code',
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        code: String(code),
        redirect_uri: credentials.redirect_uri
      });

      const req = https.request({
        hostname: 'services.leadconnectorhq.com',
        path: '/oauth/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode === 200 && parsed.access_token) {
              resolve(parsed);
            } else {
              reject(new Error(`Token exchange failed: ${res.statusCode} - ${data}`));
            }
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    console.log('Token exchange successful, getting user info...');

    // Get user info
    const userInfo = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'services.leadconnectorhq.com',
        path: '/oauth/userinfo',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/json'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              resolve(JSON.parse(data));
            } else {
              console.warn('User info request failed:', res.statusCode);
              resolve(null);
            }
          } catch (e) {
            console.warn('Failed to parse user info');
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.end();
    });

    // Store installation with real OAuth data
    const installation = {
      id: installations.length + 1,
      ghlUserId: userInfo?.userId || `user_${Date.now()}`,
      ghlLocationId: userInfo?.locationId,
      ghlLocationName: userInfo?.locationName || 'GoHighLevel Account',
      ghlAccessToken: tokenData.access_token,
      ghlRefreshToken: tokenData.refresh_token,
      ghlTokenType: tokenData.token_type || 'Bearer',
      ghlExpiresIn: tokenData.expires_in || 3600,
      ghlScopes: tokenData.scope,
      isActive: true,
      bridgeSource: 'replit',
      installationDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    installations.push(installation);

    console.log('Installation saved successfully:', {
      id: installation.id,
      locationId: installation.ghlLocationId,
      locationName: installation.ghlLocationName
    });

    const successUrl = `https://dir.engageautomations.com/?oauth=success&installation_id=${installation.id}&location_id=${installation.ghlLocationId}&location_name=${encodeURIComponent(installation.ghlLocationName)}`;
    return res.redirect(successUrl);

  } catch (error) {
    console.error('OAuth callback error:', error.message);
    const errorMsg = encodeURIComponent(`OAuth failed: ${error.message}`);
    const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=${errorMsg}`;
    return res.redirect(errorUrl);
  }
});

app.get('/installations', (req, res) => {
  res.json({
    total: installations.length,
    authenticated: installations.filter(i => i.ghlAccessToken).length,
    installations: installations.map(install => ({
      id: install.id,
      ghlUserId: install.ghlUserId,
      ghlLocationId: install.ghlLocationId,
      ghlLocationName: install.ghlLocationName,
      isActive: install.isActive,
      hasToken: !!install.ghlAccessToken,
      scopes: install.ghlScopes,
      installationDate: install.installationDate
    }))
  });
});

app.get('/test', (req, res) => {
  res.json({ 
    message: 'OAuth backend operational',
    bridge_system: 'active',
    installations: installations.length,
    authenticated: installations.filter(i => i.ghlAccessToken).length,
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path,
    availableEndpoints: ['/', '/api/oauth/callback', '/installations', '/test']
  });
});

app.listen(PORT, () => {
  console.log(`OAuth backend started on port ${PORT}`);
  console.log(`OAuth callback: https://dir.engageautomations.com/api/oauth/callback`);
  console.log(`Bridge system: active`);
});