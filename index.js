// Railway OAuth Backend - Minimal Stable Version
const express = require('express');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple storage
let installations = [];

// Health check
app.get('/', (req, res) => {
  res.json({
    service: "GoHighLevel OAuth Backend",
    version: "2.4.0-minimal-stable",
    installs: installations.length,
    status: "operational",
    bridge_system: "active",
    ts: Date.now()
  });
});

// OAuth callback endpoint
app.get('/api/oauth/callback', async (req, res) => {
  console.log('OAuth callback received:', req.query);
  
  const { code, error } = req.query;

  if (error) {
    const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=${encodeURIComponent(error)}`;
    return res.redirect(errorUrl);
  }

  if (!code) {
    const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=Missing%20authorization%20code`;
    return res.redirect(errorUrl);
  }

  try {
    // Hardcoded credentials for stability
    const credentials = {
      client_id: '68474924a586bce22a6e64f7-mbpkmyu4',
      client_secret: 'ghl_app_jhlqBCXdVq0rwLNJ2Q3BuqLRHJdkhMtPq0jVK2jYzIQSYGmWV94pUJcKu1YM',
      redirect_uri: 'https://dir.engageautomations.com/api/oauth/callback'
    };

    const https = require('https');
    const querystring = require('querystring');

    const postData = querystring.stringify({
      grant_type: 'authorization_code',
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      code: String(code),
      redirect_uri: credentials.redirect_uri
    });

    const options = {
      hostname: 'services.leadconnectorhq.com',
      path: '/oauth/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const tokenRequest = https.request(options, (tokenRes) => {
      let data = '';
      tokenRes.on('data', (chunk) => data += chunk);
      
      tokenRes.on('end', () => {
        try {
          const tokenData = JSON.parse(data);
          
          if (!tokenData.access_token) {
            throw new Error('No access token received');
          }

          // Get user info
          const userOptions = {
            hostname: 'services.leadconnectorhq.com',
            path: '/oauth/userinfo',
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`,
              'Accept': 'application/json'
            }
          };

          const userRequest = https.request(userOptions, (userRes) => {
            let userData = '';
            userRes.on('data', (chunk) => userData += chunk);
            
            userRes.on('end', () => {
              let userInfo = null;
              try {
                if (userData) {
                  userInfo = JSON.parse(userData);
                }
              } catch (e) {
                console.warn('Failed to parse user info');
              }

              // Store installation
              const installation = {
                id: installations.length + 1,
                ghlUserId: userInfo?.userId || `user_${Date.now()}`,
                ghlLocationId: userInfo?.locationId,
                ghlLocationName: userInfo?.locationName || 'GoHighLevel Account',
                ghlAccessToken: tokenData.access_token,
                ghlRefreshToken: tokenData.refresh_token,
                isActive: true,
                installationDate: new Date().toISOString()
              };

              installations.push(installation);

              console.log('Installation saved:', installation.id, installation.ghlLocationId);

              const successUrl = `https://dir.engageautomations.com/?oauth=success&installation_id=${installation.id}&location_id=${userInfo?.locationId || 'unknown'}`;
              return res.redirect(successUrl);
            });
          });

          userRequest.on('error', (err) => {
            console.error('User info request error:', err);
            const successUrl = `https://dir.engageautomations.com/?oauth=success&installation_id=temp_${Date.now()}`;
            return res.redirect(successUrl);
          });

          userRequest.end();

        } catch (error) {
          console.error('Token parsing error:', error.message);
          const errorMsg = encodeURIComponent(`Token parsing failed: ${error.message}`);
          const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=${errorMsg}`;
          return res.redirect(errorUrl);
        }
      });
    });

    tokenRequest.on('error', (err) => {
      console.error('Token request error:', err);
      const errorMsg = encodeURIComponent(`OAuth failed: ${err.message}`);
      const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=${errorMsg}`;
      return res.redirect(errorUrl);
    });

    tokenRequest.write(postData);
    tokenRequest.end();

  } catch (error) {
    console.error('OAuth callback error:', error.message);
    const errorMsg = encodeURIComponent(`OAuth failed: ${error.message}`);
    const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=${errorMsg}`;
    return res.redirect(errorUrl);
  }
});

// Installations endpoint
app.get('/installations', (req, res) => {
  res.json({
    total: installations.length,
    installations: installations.map(install => ({
      id: install.id,
      ghlUserId: install.ghlUserId,
      ghlLocationId: install.ghlLocationId,
      ghlLocationName: install.ghlLocationName,
      isActive: install.isActive,
      installationDate: install.installationDate
    }))
  });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ 
    message: 'Railway backend operational',
    installations: installations.length,
    timestamp: new Date().toISOString()
  });
});

// Error handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path,
    availableEndpoints: ['/', '/api/oauth/callback', '/installations', '/test']
  });
});

app.listen(PORT, () => {
  console.log(`Railway backend started on port ${PORT}`);
  console.log(`OAuth callback: https://dir.engageautomations.com/api/oauth/callback`);
});