const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Set up multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// OAuth credentials - DO NOT CHANGE
const oauthConfig = {
  clientId: '68474924a586bce22a6e64f7-mbpkmyu4',
  clientSecret: 'b5a7a120-7df7-4d23-8796-4863cbd08f94',
  redirectUri: 'https://dir.engageautomations.com/api/oauth/callback'
};

// Token storage - DO NOT CHANGE
const installations = new Map();

// CORE OAUTH ENDPOINTS - DO NOT MODIFY
app.get('/', (req, res) => {
  res.json({
    service: 'GoHighLevel OAuth Backend',
    version: '6.0.0-modular-apis',
    installs: installations.size,
    authenticated: installations.size,
    status: 'operational',
    features: ['oauth', 'products', 'images', 'pricing', 'media-upload'],
    debug: 'modular API system - OAuth preserved',
    ts: Date.now()
  });
});

app.get('/debug', (req, res) => {
  res.json({
    oauthConfig: {
      clientId: oauthConfig.clientId,
      redirectUri: oauthConfig.redirectUri,
      hasSecret: true
    }
  });
});

app.get('/api/oauth/callback', async (req, res) => {
  const { code, error } = req.query;
  
  console.log('OAuth callback received:', { code: !!code, error });
  
  if (error) {
    console.log('OAuth error:', error);
    return res.redirect('https://dir.engageautomations.com/?oauth=error&message=' + encodeURIComponent(error));
  }
  
  if (!code) {
    console.log('No code provided');
    return res.redirect('https://dir.engageautomations.com/?oauth=error&message=Missing authorization code');
  }
  
  try {
    console.log('Exchanging code for token');
    
    const tokenResponse = await axios.post('https://services.leadconnectorhq.com/oauth/token', {
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: oauthConfig.redirectUri
    });
    
    console.log('Token response status:', tokenResponse.status);
    
    if (tokenResponse.status === 200) {
      const { access_token, refresh_token, scope } = tokenResponse.data;
      
      const userResponse = await axios.get('https://services.leadconnectorhq.com/oauth/userinfo', {
        headers: { Authorization: 'Bearer ' + access_token }
      });
      
      if (userResponse.status === 200) {
        const userData = userResponse.data;
        
        installations.set(userData.locationId, {
          accessToken: access_token,
          refreshToken: refresh_token,
          scope: scope,
          locationId: userData.locationId,
          userId: userData.id,
          companyName: userData.companyName,
          installationDate: new Date().toISOString()
        });
        
        console.log('Installation saved for location:', userData.locationId);
        
        return res.redirect('https://dir.engageautomations.com/?oauth=success&location=' + userData.locationId);
      }
    }
    
    console.log('Token exchange failed');
    return res.redirect('https://dir.engageautomations.com/?oauth=error&message=Token exchange failed');
    
  } catch (error) {
    console.error('OAuth callback error:', error.message);
    return res.redirect('https://dir.engageautomations.com/?oauth=error&message=' + encodeURIComponent(error.message));
  }
});

app.get('/installations', (req, res) => {
  const list = Array.from(installations.values()).map(install => ({
    ghlLocationId: install.locationId,
    ghlUserId: install.userId,
    ghlLocationName: install.companyName,
    hasToken: !!install.accessToken,
    isActive: true,
    scopes: install.scope,
    installationDate: install.installationDate
  }));
  
  res.json({
    total: installations.size,
    authenticated: installations.size,
    installations: list
  });
});

// HELPER FUNCTION FOR API ENDPOINTS
function getAuthenticatedInstallation() {
  if (installations.size === 0) {
    throw new Error('No active GoHighLevel installation found');
  }
  return Array.from(installations.values())[0];
}

// MODULAR API ENDPOINTS - SAFE TO MODIFY/EXTEND

// Product Management API
app.post('/api/products/create', async (req, res) => {
  try {
    const installation = getAuthenticatedInstallation();
    
    const response = await axios.post('https://services.leadconnectorhq.com/products/', {
      name: req.body.name,
      description: req.body.description,
      type: req.body.type || 'DIGITAL',
      currency: req.body.currency || 'USD',
      price: req.body.price
    }, {
      headers: {
        Authorization: 'Bearer ' + installation.accessToken,
        Version: '2021-07-28'
      }
    });
    
    console.log('Product created:', response.data.product?.name);
    
    res.json({
      success: true,
      product: response.data.product,
      locationId: installation.locationId
    });
    
  } catch (error) {
    console.error('Product creation error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
});

app.get('/api/products/list', async (req, res) => {
  try {
    const installation = getAuthenticatedInstallation();
    
    const response = await axios.get('https://services.leadconnectorhq.com/products/', {
      headers: {
        Authorization: 'Bearer ' + installation.accessToken,
        Version: '2021-07-28'
      },
      params: {
        limit: req.query.limit || 100,
        offset: req.query.offset || 0
      }
    });
    
    res.json({
      success: true,
      products: response.data.products || [],
      locationId: installation.locationId
    });
    
  } catch (error) {
    console.error('Product list error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
});

// Image/Media Upload API
app.post('/api/images/upload', upload.single('file'), async (req, res) => {
  try {
    const installation = getAuthenticatedInstallation();
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file provided'
      });
    }
    
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });
    
    const response = await axios.post('https://services.leadconnectorhq.com/medias/upload-file', formData, {
      headers: {
        Authorization: 'Bearer ' + installation.accessToken,
        Version: '2021-07-28',
        ...formData.getHeaders()
      }
    });
    
    console.log('Image uploaded:', response.data.url);
    
    res.json({
      success: true,
      url: response.data.url,
      fileId: response.data.id,
      locationId: installation.locationId
    });
    
  } catch (error) {
    console.error('Image upload error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
});

app.get('/api/images/list', async (req, res) => {
  try {
    const installation = getAuthenticatedInstallation();
    
    const response = await axios.get('https://services.leadconnectorhq.com/medias/', {
      headers: {
        Authorization: 'Bearer ' + installation.accessToken,
        Version: '2021-07-28'
      },
      params: {
        limit: req.query.limit || 20,
        offset: req.query.offset || 0
      }
    });
    
    res.json({
      success: true,
      media: response.data.medias || [],
      locationId: installation.locationId
    });
    
  } catch (error) {
    console.error('Media list error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
});

// Product Pricing API
app.post('/api/products/:productId/prices', async (req, res) => {
  try {
    const installation = getAuthenticatedInstallation();
    const { productId } = req.params;
    
    const priceData = {
      name: req.body.name,
      type: req.body.type || 'one_time',
      amount: req.body.amount,
      currency: req.body.currency || 'USD'
    };
    
    if (req.body.type === 'recurring' && req.body.recurring) {
      priceData.recurring = req.body.recurring;
    }
    
    const response = await axios.post(`https://services.leadconnectorhq.com/products/${productId}/price`, priceData, {
      headers: {
        Authorization: 'Bearer ' + installation.accessToken,
        Version: '2021-07-28'
      }
    });
    
    console.log('Price created for product:', productId);
    
    res.json({
      success: true,
      price: response.data.price,
      productId: productId,
      locationId: installation.locationId
    });
    
  } catch (error) {
    console.error('Price creation error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
});

app.get('/api/products/:productId/prices', async (req, res) => {
  try {
    const installation = getAuthenticatedInstallation();
    const { productId } = req.params;
    
    const response = await axios.get(`https://services.leadconnectorhq.com/products/${productId}/price`, {
      headers: {
        Authorization: 'Bearer ' + installation.accessToken,
        Version: '2021-07-28'
      }
    });
    
    res.json({
      success: true,
      prices: response.data.prices || [],
      productId: productId,
      locationId: installation.locationId
    });
    
  } catch (error) {
    console.error('Price list error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log('OAuth Backend v6.0.0-modular-apis running on port', PORT);
  console.log('OAuth preserved, APIs added modularly');
});