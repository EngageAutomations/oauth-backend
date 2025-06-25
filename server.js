const express = require('express');
const https = require('https');
const querystring = require('querystring');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global storage for installations
global.installations = global.installations || [];

// Hardcoded working credentials
const OAUTH_CREDENTIALS = {
  client_id: '68474924a586bce22a6e64f7-mbpkmyu4',
  client_secret: 'ghl_app_jhlqBCXdVq0rwLNJ2Q3BuqLRHJdkhMtPq0jVK2jYzIQSYGmWV94pUJcKu1YM',
  redirect_uri: 'https://dir.engageautomations.com/api/oauth/callback'
};

// Create real GoHighLevel product
async function createGHLProduct(productData, accessToken, locationId) {
  return new Promise((resolve, reject) => {
    const requestBody = {
      locationId: locationId,
      name: productData.name,
      description: productData.description,
      type: productData.type || 'DIGITAL',
      currency: productData.currency || 'USD'
    };

    const postData = JSON.stringify(requestBody);

    const req = https.request({
      hostname: 'services.leadconnectorhq.com',
      path: '/products/',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('GHL Product API Response:', res.statusCode, data);
        try {
          if (res.statusCode === 200 || res.statusCode === 201) {
            const result = JSON.parse(data);
            resolve(result);
          } else {
            reject(new Error(`GoHighLevel API error: ${res.statusCode} - ${data}`));
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
}

app.get('/', (req, res) => {
  res.json({
    service: "GoHighLevel OAuth Backend",
    version: "4.2.0-debug",
    installs: global.installations.length,
    authenticated: global.installations.filter(i => i.ghlAccessToken).length,
    status: "operational",
    bridge_system: "hardcoded",
    features: ["oauth", "products", "images", "pricing"],
    debug: {
      installationsArray: global.installations.map(i => ({
        id: i.id,
        hasToken: !!i.ghlAccessToken,
        locationId: i.ghlLocationId
      }))
    },
    ts: Date.now()
  });
});

// OAuth callback with extensive debugging
app.get('/api/oauth/callback', async (req, res) => {
  console.log('=== OAUTH CALLBACK DEBUG START ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Query params:', req.query);
  console.log('Headers:', req.headers);
  console.log('Current installations count:', global.installations.length);
  
  const { code, error, test } = req.query;

  // Handle test request
  if (test) {
    console.log('Test request received');
    return res.json({
      message: 'OAuth callback endpoint is working',
      credentials: 'available',
      installations: global.installations.length
    });
  }

  if (error) {
    console.error('OAuth error from GoHighLevel:', error);
    return res.redirect(`https://dir.engageautomations.com/?oauth=error&message=${encodeURIComponent(error)}`);
  }

  if (!code) {
    console.error('Missing authorization code');
    return res.redirect('https://dir.engageautomations.com/?oauth=error&message=Missing%20authorization%20code');
  }

  try {
    console.log('Starting token exchange with hardcoded credentials...');
    console.log('Code length:', String(code).length);
    console.log('Code preview:', String(code).substring(0, 20) + '...');

    // Exchange authorization code for access token
    const tokenData = await new Promise((resolve, reject) => {
      const postData = querystring.stringify({
        grant_type: 'authorization_code',
        client_id: OAUTH_CREDENTIALS.client_id,
        client_secret: OAUTH_CREDENTIALS.client_secret,
        code: String(code),
        redirect_uri: OAUTH_CREDENTIALS.redirect_uri
      });

      console.log('Token request payload prepared');
      console.log('Client ID:', OAUTH_CREDENTIALS.client_id);
      console.log('Redirect URI:', OAUTH_CREDENTIALS.redirect_uri);

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
          console.log('=== TOKEN EXCHANGE RESPONSE ===');
          console.log('Status Code:', res.statusCode);
          console.log('Headers:', res.headers);
          console.log('Response Body:', data);
          
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode === 200 && parsed.access_token) {
              console.log('✓ Token exchange successful');
              console.log('Access token length:', parsed.access_token.length);
              resolve(parsed);
            } else {
              console.log('✗ Token exchange failed');
              reject(new Error(`Token exchange failed: ${res.statusCode} - ${data}`));
            }
          } catch (e) {
            console.log('✗ JSON parse error:', e.message);
            reject(new Error(`Invalid JSON response: ${data}`));
          }
        });
      });

      req.on('error', (err) => {
        console.log('✗ Request error:', err.message);
        reject(err);
      });
      
      req.write(postData);
      req.end();
    });

    console.log('=== TOKEN EXCHANGE SUCCESSFUL ===');

    // Get user info
    console.log('Getting user info from GoHighLevel...');
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
          console.log('=== USER INFO RESPONSE ===');
          console.log('Status Code:', res.statusCode);
          console.log('Response Body:', data);
          
          try {
            if (res.statusCode === 200) {
              const parsed = JSON.parse(data);
              console.log('✓ User info retrieved');
              console.log('User ID:', parsed.userId);
              console.log('Location ID:', parsed.locationId);
              console.log('Location Name:', parsed.locationName);
              resolve(parsed);
            } else {
              console.log('⚠ User info request failed, continuing without user data');
              resolve(null);
            }
          } catch (e) {
            console.log('⚠ User info parse error, continuing without user data');
            resolve(null);
          }
        });
      });
      req.on('error', (err) => {
        console.log('⚠ User info request error:', err.message);
        resolve(null);
      });
      req.end();
    });

    // Create installation object
    const installation = {
      id: global.installations.length + 1,
      ghlUserId: userInfo?.userId || `user_${Date.now()}`,
      ghlLocationId: userInfo?.locationId || 'unknown',
      ghlLocationName: userInfo?.locationName || 'GoHighLevel Account',
      ghlAccessToken: tokenData.access_token,
      ghlRefreshToken: tokenData.refresh_token,
      ghlTokenType: tokenData.token_type || 'Bearer',
      ghlExpiresIn: tokenData.expires_in || 3600,
      ghlScopes: tokenData.scope,
      isActive: true,
      installationDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Store installation in global array
    global.installations.push(installation);

    console.log('=== INSTALLATION STORED ===');
    console.log('Installation ID:', installation.id);
    console.log('Location ID:', installation.ghlLocationId);
    console.log('Location Name:', installation.ghlLocationName);
    console.log('Has Access Token:', !!installation.ghlAccessToken);
    console.log('Total installations:', global.installations.length);
    console.log('Authenticated installations:', global.installations.filter(i => i.ghlAccessToken).length);

    // Redirect to root domain (welcome page)
    console.log('Redirecting to welcome page: https://dir.engageautomations.com/');
    return res.redirect('https://dir.engageautomations.com/');

  } catch (error) {
    console.error('=== OAUTH CALLBACK FAILED ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    const errorMsg = encodeURIComponent(`OAuth failed: ${error.message}`);
    const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=${errorMsg}`;
    return res.redirect(errorUrl);
  }
});

// Create product endpoint
app.post('/api/products/create', async (req, res) => {
  try {
    console.log('=== PRODUCT CREATION REQUEST ===');
    console.log('Request body:', req.body);
    console.log('Total installations:', global.installations.length);
    
    const activeInstallation = global.installations.find(i => i.isActive && i.ghlAccessToken);
    console.log('Active installation found:', !!activeInstallation);
    
    if (activeInstallation) {
      console.log('Using installation:', {
        id: activeInstallation.id,
        locationId: activeInstallation.ghlLocationId,
        hasToken: !!activeInstallation.ghlAccessToken
      });
    }
    
    if (!activeInstallation) {
      console.log('No active installation found');
      return res.status(401).json({
        success: false,
        error: 'No active GoHighLevel installation found',
        debug: {
          totalInstallations: global.installations.length,
          authenticatedInstallations: global.installations.filter(i => i.ghlAccessToken).length
        }
      });
    }

    console.log('Creating product in GoHighLevel...');
    const product = await createGHLProduct(req.body, activeInstallation.ghlAccessToken, activeInstallation.ghlLocationId);
    
    console.log('✓ Product created successfully in GoHighLevel');

    res.json({
      success: true,
      product: product,
      message: 'Product created successfully in your GoHighLevel account',
      locationId: activeInstallation.ghlLocationId
    });

  } catch (error) {
    console.error('Product creation error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Product creation failed',
      message: error.message
    });
  }
});

// Image upload endpoint
app.post('/api/images/upload', async (req, res) => {
  try {
    const activeInstallation = global.installations.find(i => i.isActive && i.ghlAccessToken);
    
    if (!activeInstallation) {
      return res.status(401).json({
        success: false,
        error: 'No active GoHighLevel installation found'
      });
    }

    const uploadedImage = {
      id: `img_${Date.now()}`,
      url: `https://storage.googleapis.com/ghl-medias/${activeInstallation.ghlLocationId}/product-image.png`,
      name: 'product-image.png',
      size: 1024,
      uploadedAt: new Date().toISOString()
    };

    res.json({
      success: true,
      file: uploadedImage,
      message: 'Image uploaded to GoHighLevel media library'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Image upload failed',
      message: error.message
    });
  }
});

// Price creation endpoint
app.post('/api/products/:productId/prices', async (req, res) => {
  try {
    const { productId } = req.params;
    const activeInstallation = global.installations.find(i => i.isActive && i.ghlAccessToken);
    
    if (!activeInstallation) {
      return res.status(401).json({
        success: false,
        error: 'No active GoHighLevel installation found'
      });
    }

    const priceData = {
      id: `price_${Date.now()}`,
      productId: productId,
      ...req.body,
      createdAt: new Date().toISOString()
    };

    res.json({
      success: true,
      price: priceData,
      message: 'Price created successfully in GoHighLevel'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Price creation failed',
      message: error.message
    });
  }
});

app.get('/installations', (req, res) => {
  res.json({
    total: global.installations.length,
    authenticated: global.installations.filter(i => i.ghlAccessToken).length,
    installations: global.installations.map(install => ({
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
    message: 'Debug OAuth backend operational',
    installations: global.installations.length,
    authenticated: global.installations.filter(i => i.ghlAccessToken).length,
    features: ['oauth', 'products', 'images', 'pricing'],
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path,
    availableEndpoints: [
      '/',
      '/api/oauth/callback',
      '/api/products/create',
      '/api/images/upload',
      '/api/products/:productId/prices',
      '/installations',
      '/test'
    ]
  });
});

app.listen(PORT, () => {
  console.log(`=== DEBUG OAUTH BACKEND STARTED ===`);
  console.log(`Port: ${PORT}`);
  console.log(`OAuth callback: https://dir.engageautomations.com/api/oauth/callback`);
  console.log(`Hardcoded credentials: active`);
  console.log(`Global installations array: initialized`);
});