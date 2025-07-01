/**
 * Pure OAuth Backend - Only OAuth Functionality
 * Handles OAuth callback, token management, and provides bridge for API backend
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory OAuth installation store
const installations = new Map();

// GoHighLevel OAuth Configuration
const CLIENT_ID = 'Q7DGQOCn7LgdPdGCKZiKzwCfx3eUlEgEp1lM8zVqo2';
const CLIENT_SECRET = 'Q4zrAwYqKdWp8NKSHy72bGLIJpRzrlUpZ4bUhFhU';
const REDIRECT_URI = 'https://dir.engageautomations.com/api/oauth/callback';

// OAuth Callback Handler
app.get('/api/oauth/callback', async (req, res) => {
  console.log('=== OAuth Callback Received ===');
  const { code, location_id, error, error_description } = req.query;
  
  if (error) {
    console.log('❌ OAuth error:', error, error_description);
    return res.status(400).send(`<html><body>
      <h2>OAuth Error</h2>
      <p>Error: ${error}</p>
      <p>Description: ${error_description}</p>
    </body></html>`);
  }
  
  if (!code) {
    console.log('❌ No authorization code received');
    return res.status(400).send('<html><body><h2>Error: No authorization code received</h2></body></html>');
  }
  
  try {
    console.log('🔄 Exchanging authorization code for tokens...');
    console.log('   Code:', code.substring(0, 20) + '...');
    console.log('   Location ID:', location_id);
    
    // Exchange code for tokens using URLSearchParams
    const tokenParams = new URLSearchParams();
    tokenParams.append('client_id', CLIENT_ID);
    tokenParams.append('client_secret', CLIENT_SECRET);
    tokenParams.append('grant_type', 'authorization_code');
    tokenParams.append('code', code);
    tokenParams.append('redirect_uri', REDIRECT_URI);
    
    const tokenResponse = await axios.post(
      'https://services.leadconnectorhq.com/oauth/token',
      tokenParams,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        timeout: 30000
      }
    );
    
    const { access_token, refresh_token, expires_in, scope } = tokenResponse.data;
    console.log('✅ Tokens received successfully');
    console.log('   Expires in:', expires_in, 'seconds');
    console.log('   Scopes:', scope);
    
    // Generate installation ID
    const installation_id = `install_${Date.now()}`;
    
    // Store installation with tokens
    installations.set(installation_id, {
      id: installation_id,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      expiresAt: Date.now() + (expires_in * 1000),
      locationId: location_id,
      scopes: scope,
      tokenStatus: 'valid',
      createdAt: new Date().toISOString(),
      lastRefresh: null
    });
    
    console.log(`✅ Installation ${installation_id} stored successfully`);
    
    // Redirect to frontend with installation details
    const frontendUrl = `https://listings.engageautomations.com/?installation_id=${installation_id}&welcome=true`;
    
    res.send(`<html><body>
      <h2>OAuth Installation Successful!</h2>
      <p>Installation ID: ${installation_id}</p>
      <p>Location ID: ${location_id}</p>
      <p>Token Status: Valid</p>
      <p>Redirecting to application...</p>
      <script>
        setTimeout(() => {
          window.location.href = '${frontendUrl}';
        }, 2000);
      </script>
    </body></html>`);
    
  } catch (error) {
    console.error('❌ Token exchange error:', error);
    
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    
    res.status(500).send(`<html><body>
      <h2>OAuth Installation Failed</h2>
      <p>Error: ${error.message}</p>
      <p>Please try the installation again.</p>
    </body></html>`);
  }
});

// Token Access Bridge for API Backend
app.post('/api/token-access', async (req, res) => {
  try {
    const { installation_id } = req.body;
    
    if (!installation_id) {
      return res.status(400).json({ success: false, error: 'installation_id required' });
    }
    
    const installation = installations.get(installation_id);
    
    if (!installation) {
      return res.status(404).json({ 
        success: false, 
        error: 'Installation not found',
        hint: 'Please complete OAuth installation first'
      });
    }
    
    // Check if token needs refresh (within 10 minutes of expiry)
    const needsRefresh = (installation.expiresAt - Date.now()) < (10 * 60 * 1000);
    
    if (needsRefresh && installation.refreshToken) {
      console.log(`🔄 Refreshing token for installation ${installation_id}`);
      
      try {
        const refreshParams = new URLSearchParams();
        refreshParams.append('client_id', CLIENT_ID);
        refreshParams.append('client_secret', CLIENT_SECRET);
        refreshParams.append('grant_type', 'refresh_token');
        refreshParams.append('refresh_token', installation.refreshToken);
        
        const refreshResponse = await axios.post(
          'https://services.leadconnectorhq.com/oauth/token',
          refreshParams,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Accept': 'application/json'
            }
          }
        );
        
        const { access_token, refresh_token, expires_in } = refreshResponse.data;
        
        // Update installation with new tokens
        installation.accessToken = access_token;
        installation.refreshToken = refresh_token || installation.refreshToken;
        installation.expiresIn = expires_in;
        installation.expiresAt = Date.now() + (expires_in * 1000);
        installation.lastRefresh = new Date().toISOString();
        installation.tokenStatus = 'refreshed';
        
        installations.set(installation_id, installation);
        
        console.log(`✅ Token refreshed for installation ${installation_id}`);
        
      } catch (refreshError) {
        console.error('❌ Token refresh failed:', refreshError);
        installation.tokenStatus = 'refresh_failed';
        installations.set(installation_id, installation);
      }
    }
    
    res.json({
      success: true,
      accessToken: installation.accessToken,
      installation: {
        id: installation.id,
        locationId: installation.locationId,
        tokenStatus: installation.tokenStatus,
        expiresAt: installation.expiresAt,
        scopes: installation.scopes
      }
    });
    
  } catch (error) {
    console.error('Token access error:', error);
    res.status(500).json({
      success: false,
      error: 'Token access failed'
    });
  }
});

// Installation Status
app.get('/installations', (req, res) => {
  const installList = Array.from(installations.values()).map(install => ({
    id: install.id,
    locationId: install.locationId,
    tokenStatus: install.tokenStatus,
    createdAt: install.createdAt,
    lastRefresh: install.lastRefresh,
    expiresAt: install.expiresAt
  }));
  
  res.json({
    count: installList.length,
    installations: installList
  });
});

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Pure OAuth Backend',
    version: '6.0.0-pure-oauth',
    features: ['oauth-callback', 'token-management', 'api-bridge'],
    installations: installations.size,
    timestamp: Date.now()
  });
});

// Root Status
app.get('/', (req, res) => {
  res.json({
    service: 'GoHighLevel OAuth Backend',
    version: '6.0.0-pure-oauth', 
    purpose: 'OAuth authentication only',
    endpoints: [
      'GET /api/oauth/callback',
      'POST /api/token-access',
      'GET /installations',
      'GET /health'
    ],
    installations: installations.size,
    status: 'operational'
  });
});

app.listen(port, () => {
  console.log(`Pure OAuth Backend v6.0.0 running on port ${port}`);
  console.log('Purpose: OAuth authentication and token management only');
  console.log('API Backend: Separate service handles GoHighLevel API calls');
});