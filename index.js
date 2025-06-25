// Railway OAuth Backend - Stable Version with Bridge System
const express = require('express');

const app = express();
const PORT = process.env.PORT || 5000;

// Bridge configuration
const BRIDGE_BASE_URL = 'https://gohighlevel-oauth-marketplace-application.replit.app';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple in-memory storage
let installations = [];

// Get credentials from bridge
async function getBridgeCredentials() {
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`${BRIDGE_BASE_URL}/api/bridge/oauth-credentials`);
    const data = await response.json();
    return data.success ? data.credentials : null;
  } catch (error) {
    console.error('Bridge error:', error.message);
    return null;
  }
}

// Health check
app.get('/', (req, res) => {
  res.json({
    service: "GoHighLevel OAuth Backend",
    version: "2.3.0-stable-bridge",
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
    const credentials = await getBridgeCredentials();
    
    if (!credentials) {
      throw new Error('Bridge credentials not available');
    }

    const fetch = (await import('node-fetch')).default;
    
    const tokenResponse = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        code: String(code),
        redirect_uri: credentials.redirect_uri
      })
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();
    
    if (!tokenData.access_token) {
      throw new Error('No access token received');
    }

    // Get user info
    const userResponse = await fetch('https://services.leadconnectorhq.com/oauth/userinfo', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });

    let userInfo = null;
    if (userResponse.ok) {
      userInfo = await userResponse.json();
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
    bridge_system: 'active',
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
  console.log(`Bridge system: ${BRIDGE_BASE_URL}`);
});