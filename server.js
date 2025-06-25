const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory storage
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
  }
};

// OAuth config
const oauthConfig = {
  clientId: '68474924a586bce22a6e64f7-mbpkmyu4',
  clientSecret: 'ghl_app_jhlqBCXdVq0rwLNJ2Q3BuqLRHJdkhMtPq0jVK2jYzIQSYGmWV94pUJcKu1YM',
  redirectUri: 'https://dir.engageautomations.com/api/oauth/callback'
};

app.get('/', (req, res) => {
  res.json({
    service: "GoHighLevel OAuth Backend",
    version: "5.1.0-debug",
    installs: oauthInstallations.length,
    authenticated: oauthInstallations.filter(i => i.ghlAccessToken).length,
    status: "operational",
    features: ["oauth", "products", "images", "pricing"],
    debug: "callback logging active",
    ts: Date.now()
  });
});

// ENHANCED OAuth callback with comprehensive logging
app.get('/api/oauth/callback', async (req, res) => {
  // CHECK 1: Log if callback is ever hit
  console.log('↪️ CALLBACK HIT:', req.query);
  console.log('↪️ CALLBACK TIMESTAMP:', new Date().toISOString());
  console.log('↪️ CALLBACK HEADERS:', req.headers);
  console.log('↪️ CALLBACK URL:', req.url);

  const { code, state, error } = req.query;

  if (error) {
    console.log('❌ OAUTH ERROR RECEIVED:', error);
    const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=${encodeURIComponent(error)}`;
    return res.redirect(errorUrl);
  }

  if (!code) {
    console.log('❌ NO AUTHORIZATION CODE PROVIDED');
    const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=Missing%20authorization%20code`;
    return res.redirect(errorUrl);
  }

  console.log('✅ AUTHORIZATION CODE RECEIVED:', String(code).substring(0, 20) + '...');

  try {
    const https = require('https');
    const querystring = require('querystring');

    // CHECK 2: Log outbound token exchange request
    console.log('→ EXCHANGING TOKEN WITH GHL');
    console.log('→ CLIENT ID:', oauthConfig.clientId.slice(-4));
    console.log('→ REDIRECT URI:', oauthConfig.redirectUri);
    console.log('→ CODE LENGTH:', String(code).length);

    const tokenRequestData = querystring.stringify({
      grant_type: 'authorization_code',
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      code: String(code),
      redirect_uri: oauthConfig.redirectUri
    });

    console.log('→ REQUEST DATA PREPARED, SENDING TO GHL...');

    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'services.leadconnectorhq.com',
        path: '/oauth/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(tokenRequestData)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('← GHL RESPONSE STATUS:', res.statusCode);
          console.log('← GHL RESPONSE HEADERS:', res.headers);
          console.log('← GHL RESPONSE DATA:', data);
          
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode === 200 && parsed.access_token) {
              console.log('✅ TOKEN EXCHANGE SUCCESS');
              resolve(parsed);
            } else {
              console.log('❌ TOKEN EXCHANGE FAILED - STATUS:', res.statusCode);
              reject(new Error(`Token exchange failed: ${res.statusCode} - ${data}`));
            }
          } catch (e) {
            console.log('❌ INVALID JSON RESPONSE:', data);
            reject(new Error(`Invalid JSON response: ${data}`));
          }
        });
      });
      
      req.on('error', (error) => {
        console.log('❌ REQUEST ERROR:', error.message);
        reject(error);
      });
      
      req.write(tokenRequestData);
      req.end();
    });

    console.log('✅ TOKEN EXCHANGE SUCCESSFUL');
    console.log('✅ ACCESS TOKEN LENGTH:', response.access_token ? response.access_token.length : 'N/A');
    console.log('✅ SCOPES RECEIVED:', response.scope);

    // Get user info
    console.log('→ FETCHING USER INFO FROM GHL...');
    const userInfo = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'services.leadconnectorhq.com',
        path: '/oauth/userinfo',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${response.access_token}`,
          'Accept': 'application/json'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('← USER INFO STATUS:', res.statusCode);
          console.log('← USER INFO DATA:', data);
          try {
            if (res.statusCode === 200) {
              resolve(JSON.parse(data));
            } else {
              resolve(null);
            }
          } catch (e) {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.end();
    });

    console.log('✅ USER INFO RETRIEVED');
    if (userInfo) {
      console.log('✅ USER ID:', userInfo.userId);
      console.log('✅ LOCATION ID:', userInfo.locationId);
      console.log('✅ LOCATION NAME:', userInfo.locationName);
    }

    const installationData = {
      ghlUserId: userInfo?.userId || `user_${Date.now()}`,
      ghlLocationId: userInfo?.locationId,
      ghlLocationName: userInfo?.locationName || 'GoHighLevel Account',
      ghlAccessToken: response.access_token,
      ghlRefreshToken: response.refresh_token,
      ghlTokenType: response.token_type || 'Bearer',
      ghlExpiresIn: response.expires_in || 3600,
      ghlScopes: response.scope,
      isActive: true
    };

    const savedInstallation = storage.createInstallation(installationData);
    console.log('✅ INSTALLATION SAVED - ID:', savedInstallation.id);
    console.log('✅ INSTALLATION COUNT:', oauthInstallations.length);

    return res.redirect('https://dir.engageautomations.com/');

  } catch (error) {
    console.log('❌ OAUTH FLOW FAILED:', error.message);
    console.log('❌ ERROR STACK:', error.stack);
    const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=${encodeURIComponent(error.message)}`;
    return res.redirect(errorUrl);
  }
});

// Create product endpoint
app.post('/api/products/create', async (req, res) => {
  try {
    console.log('→ PRODUCT CREATION REQUEST RECEIVED');
    console.log('→ REQUEST BODY:', req.body);

    const activeInstallation = oauthInstallations.find(i => i.isActive && i.ghlAccessToken);
    
    if (!activeInstallation) {
      console.log('❌ NO ACTIVE INSTALLATION FOUND');
      return res.status(401).json({
        success: false,
        error: 'No active GoHighLevel installation found',
        totalInstallations: oauthInstallations.length
      });
    }

    console.log('✅ USING INSTALLATION:', activeInstallation.id);
    console.log('✅ LOCATION ID:', activeInstallation.ghlLocationId);

    const https = require('https');
    const requestBody = {
      locationId: activeInstallation.ghlLocationId,
      name: req.body.name,
      description: req.body.description,
      type: req.body.type || 'DIGITAL',
      currency: req.body.currency || 'USD'
    };

    console.log('→ CREATING PRODUCT IN GHL:', requestBody);

    const product = await new Promise((resolve, reject) => {
      const postData = JSON.stringify(requestBody);
      const req = https.request({
        hostname: 'services.leadconnectorhq.com',
        path: '/products/',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${activeInstallation.ghlAccessToken}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('← PRODUCT API STATUS:', res.statusCode);
          console.log('← PRODUCT API RESPONSE:', data);
          try {
            if (res.statusCode === 200 || res.statusCode === 201) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`Product API error: ${res.statusCode} - ${data}`));
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

    console.log('✅ PRODUCT CREATED SUCCESSFULLY:', product);

    res.json({
      success: true,
      product: product,
      message: 'Product created successfully in your GoHighLevel account',
      locationId: activeInstallation.ghlLocationId
    });

  } catch (error) {
    console.log('❌ PRODUCT CREATION ERROR:', error.message);
    res.status(500).json({
      success: false,
      error: 'Product creation failed',
      message: error.message
    });
  }
});

app.get('/installations', (req, res) => {
  console.log('→ INSTALLATIONS REQUEST - CURRENT COUNT:', oauthInstallations.length);
  res.json({
    total: oauthInstallations.length,
    authenticated: oauthInstallations.filter(i => i.ghlAccessToken).length,
    installations: oauthInstallations.map(install => ({
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

app.get('/debug', (req, res) => {
  res.json({
    message: 'Debug OAuth backend with comprehensive logging',
    version: '5.1.0-debug',
    installations: oauthInstallations.length,
    authenticated: oauthInstallations.filter(i => i.ghlAccessToken).length,
    oauthConfig: {
      clientId: oauthConfig.clientId,
      redirectUri: oauthConfig.redirectUri,
      hasSecret: !!oauthConfig.clientSecret
    },
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => {
  console.log('→ 404 REQUEST:', req.method, req.path);
  res.status(404).json({ 
    error: 'Not found',
    path: req.path
  });
});

app.listen(PORT, () => {
  console.log(`Debug OAuth backend started on port ${PORT}`);
  console.log(`OAuth callback: https://dir.engageautomations.com/api/oauth/callback`);
  console.log(`Version: 5.1.0-debug with comprehensive callback logging`);
  console.log(`Client ID: ${oauthConfig.clientId}`);
  console.log(`Redirect URI: ${oauthConfig.redirectUri}`);
});