const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const OAUTH_CONFIG = {
  clientId: '68474924a586bce22a6e64f7-mbpkmyu4',
  clientSecret: 'b5a7a120-7df7-4d23-8796-4863cbd08f94',
  redirectUri: 'https://dir.engageautomations.com/api/oauth/callback'
};

const installations = new Map();
let authCount = 0;

app.use(cors());
app.use(express.json());

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'GoHighLevel OAuth Backend',
    version: '5.3.0-callback-fixed',
    installs: installations.size,
    authenticated: authCount,
    status: 'operational',
    features: ['oauth', 'products', 'images', 'pricing'],
    debug: 'callback routing fixed',
    ts: Date.now()
  });
});

// Debug endpoint
app.get('/debug', (req, res) => {
  res.json({
    oauthConfig: {
      clientId: OAUTH_CONFIG.clientId,
      redirectUri: OAUTH_CONFIG.redirectUri,
      hasSecret: !!OAUTH_CONFIG.clientSecret
    },
    installations: installations.size
  });
});

// OAuth callback endpoint - FIXED ROUTING
app.get('/api/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  
  console.log('↪️ CALLBACK HIT:', { 
    code: !!code, 
    state, 
    error, 
    timestamp: new Date().toISOString(),
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  if (error) {
    console.log('❌ OAUTH ERROR:', error);
    return res.redirect(`https://dir.engageautomations.com/?oauth=error&message=${encodeURIComponent(error)}`);
  }
  
  if (!code) {
    console.log('❌ NO CODE PROVIDED');
    return res.redirect('https://dir.engageautomations.com/?oauth=error&message=Missing%20authorization%20code');
  }
  
  try {
    console.log('→ EXCHANGING TOKEN WITH GHL');
    console.log('→ Using Client ID:', OAUTH_CONFIG.clientId);
    console.log('→ Using Redirect URI:', OAUTH_CONFIG.redirectUri);
    
    const tokenResponse = await axios.post('https://services.leadconnectorhq.com/oauth/token', {
      client_id: OAUTH_CONFIG.clientId,
      client_secret: OAUTH_CONFIG.clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: OAUTH_CONFIG.redirectUri
    });
    
    console.log('← GHL RESPONSE STATUS:', tokenResponse.status);
    
    if (tokenResponse.status === 200) {
      console.log('✅ TOKEN EXCHANGE SUCCESS');
      
      const { access_token, refresh_token, scope, expires_in } = tokenResponse.data;
      
      const userResponse = await axios.get('https://services.leadconnectorhq.com/oauth/userinfo', {
        headers: { 'Authorization': `Bearer ${access_token}` }
      });
      
      console.log('← USER INFO STATUS:', userResponse.status);
      
      if (userResponse.status === 200) {
        const userData = userResponse.data;
        console.log('✅ USER INFO SUCCESS:', { userId: userData.id, locationId: userData.locationId });
        
        const installation = {
          id: `install_${Date.now()}`,
          ghlUserId: userData.id,
          ghlLocationId: userData.locationId,
          ghlLocationName: userData.companyName || userData.locationId,
          accessToken: access_token,
          refreshToken: refresh_token,
          scope: scope,
          expiresIn: expires_in,
          installationDate: new Date().toISOString(),
          isActive: true
        };
        
        installations.set(userData.locationId, installation);
        authCount++;
        
        console.log('✅ INSTALLATION SAVED:', installation.id);
        console.log('📊 TOTAL INSTALLATIONS:', installations.size);
        
        return res.redirect(`https://dir.engageautomations.com/?oauth=success&location=${userData.locationId}`);
      }
    }
    
    console.log('❌ TOKEN EXCHANGE FAILED:', tokenResponse.status, tokenResponse.data);
    return res.redirect('https://dir.engageautomations.com/?oauth=error&message=Token%20exchange%20failed');
    
  } catch (error) {
    console.error('❌ OAUTH CALLBACK ERROR:', error.response?.data || error.message);
    return res.redirect(`https://dir.engageautomations.com/?oauth=error&message=${encodeURIComponent(error.message)}`);
  }
});

// Test callback endpoint
app.get('/api/oauth/callback/test', (req, res) => {
  res.json({
    message: 'OAuth callback endpoint is accessible',
    timestamp: new Date().toISOString(),
    path: req.path
  });
});

// Installations endpoint
app.get('/installations', (req, res) => {
  const installationsList = Array.from(installations.values()).map(install => ({
    id: install.id,
    ghlUserId: install.ghlUserId,
    ghlLocationId: install.ghlLocationId,
    ghlLocationName: install.ghlLocationName,
    hasToken: !!install.accessToken,
    isActive: install.isActive,
    scopes: install.scope,
    installationDate: install.installationDate
  }));
  
  res.json({
    total: installations.size,
    authenticated: authCount,
    installations: installationsList
  });
});

// Product creation endpoint
app.post('/api/products/create', async (req, res) => {
  try {
    if (installations.size === 0) {
      return res.status(401).json({
        success: false,
        error: 'No active GoHighLevel installation found'
      });
    }
    
    const installation = Array.from(installations.values())[0];
    
    const productData = {
      name: req.body.name,
      description: req.body.description,
      type: req.body.type || 'DIGITAL',
      price: req.body.price,
      currency: req.body.currency || 'USD'
    };
    
    const response = await axios.post('https://services.leadconnectorhq.com/products/', productData, {
      headers: {
        'Authorization': `Bearer ${installation.accessToken}`,
        'Version': '2021-07-28'
      }
    });
    
    console.log('✅ PRODUCT CREATED:', response.data.product?.name);
    
    res.json({
      success: true,
      product: response.data.product,
      locationId: installation.ghlLocationId
    });
    
  } catch (error) {
    console.error('❌ PRODUCT CREATION ERROR:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 OAuth Backend v5.3.0-callback-fixed running on port ${PORT}`);
  console.log(`📋 Client ID: ${OAUTH_CONFIG.clientId}`);
  console.log(`🔗 Redirect URI: ${OAUTH_CONFIG.redirectUri}`);
  console.log(`🔧 Callback endpoint: /api/oauth/callback`);
});