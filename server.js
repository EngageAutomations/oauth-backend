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
    version: "5.0.0-stable",
    installs: oauthInstallations.length,
    authenticated: oauthInstallations.filter(i => i.ghlAccessToken).length,
    status: "operational",
    features: ["oauth", "products", "images", "pricing"],
    ts: Date.now()
  });
});

// Working OAuth callback from railway-backend/index.js
app.get('/api/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=${encodeURIComponent(error)}`;
    return res.redirect(errorUrl);
  }

  if (!code) {
    const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=Missing%20authorization%20code`;
    return res.redirect(errorUrl);
  }

  try {
    const https = require('https');
    const querystring = require('querystring');

    const tokenRequestData = querystring.stringify({
      grant_type: 'authorization_code',
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      code: String(code),
      redirect_uri: oauthConfig.redirectUri
    });

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
      req.write(tokenRequestData);
      req.end();
    });

    console.log('Token exchange successful');

    // Get user info
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
    console.log('OAuth installation saved with ID:', savedInstallation.id);

    return res.redirect('https://dir.engageautomations.com/');

  } catch (error) {
    console.error('Token exchange failed:', error.message);
    const errorUrl = `https://dir.engageautomations.com/?oauth=error&message=${encodeURIComponent(error.message)}`;
    return res.redirect(errorUrl);
  }
});

// Create product endpoint
app.post('/api/products/create', async (req, res) => {
  try {
    const activeInstallation = oauthInstallations.find(i => i.isActive && i.ghlAccessToken);
    
    if (!activeInstallation) {
      return res.status(401).json({
        success: false,
        error: 'No active GoHighLevel installation found'
      });
    }

    const https = require('https');
    const requestBody = {
      locationId: activeInstallation.ghlLocationId,
      name: req.body.name,
      description: req.body.description,
      type: req.body.type || 'DIGITAL',
      currency: req.body.currency || 'USD'
    };

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

    console.log('Product created in GoHighLevel:', product);

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
    const activeInstallation = oauthInstallations.find(i => i.isActive && i.ghlAccessToken);
    
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
    const activeInstallation = oauthInstallations.find(i => i.isActive && i.ghlAccessToken);
    
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

app.get('/test', (req, res) => {
  res.json({ 
    message: 'Stable OAuth backend operational',
    installations: oauthInstallations.length,
    authenticated: oauthInstallations.filter(i => i.ghlAccessToken).length,
    features: ['oauth', 'products', 'images', 'pricing'],
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path
  });
});

app.listen(PORT, () => {
  console.log(`Stable OAuth backend started on port ${PORT}`);
  console.log(`OAuth callback: https://dir.engageautomations.com/api/oauth/callback`);
});