const express = require('express');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req, res) => {
  res.json({
    service: 'GoHighLevel Modular Backend',
    version: '1.4.1-fixed',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

// OAuth credentials (for Railway integration)
const OAUTH_CONFIG = {
  clientId: '68474924a586bce22a6e64f7-mbpkmyu4',
  clientSecret: 'b5a7a120-7df7-4d23-8796-4863cbd08f94',
  redirectUri: 'https://dir.engageautomations.com/api/oauth/callback'
};

// In-memory storage
let oauthInstallations = [];

// OAuth callback endpoint
app.get('/api/oauth/callback', async (req, res) => {
  const { code, state } = req.query;
  
  if (!code) {
    return res.redirect('https://dir.engageautomations.com/?oauth=error&message=Missing authorization code');
  }
  
  try {
    // Exchange code for tokens
    const tokenResponse = await axios.post('https://services.leadconnectorhq.com/oauth/token', {
      client_id: OAUTH_CONFIG.clientId,
      client_secret: OAUTH_CONFIG.clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: OAUTH_CONFIG.redirectUri
    });
    
    const tokenData = tokenResponse.data;
    
    // Store installation
    const installation = {
      id: Date.now().toString(),
      ghlUserId: tokenData.userDetails?.id || 'unknown',
      locationId: tokenData.locationId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      scope: tokenData.scope,
      installationDate: new Date(),
      lastUsed: new Date()
    };
    
    oauthInstallations.push(installation);
    
    res.redirect('https://dir.engageautomations.com/?oauth=success&installation_id=' + installation.id);
    
  } catch (error) {
    console.error('OAuth callback error:', error.message);
    res.redirect('https://dir.engageautomations.com/?oauth=error&message=Token exchange failed');
  }
});

// Installation status
app.get('/installations', (req, res) => {
  res.json({
    total: oauthInstallations.length,
    installations: oauthInstallations.map(i => ({
      id: i.id,
      locationId: i.locationId,
      installationDate: i.installationDate,
      lastUsed: i.lastUsed
    }))
  });
});

// Product creation API
app.post('/api/ghl/products/create', async (req, res) => {
  try {
    const installation = oauthInstallations[0]; // Use first installation for demo
    if (!installation) {
      return res.status(401).json({ error: 'No OAuth installation found' });
    }
    
    const { name, description, price, productType = 'DIGITAL' } = req.body;
    
    const productData = {
      name,
      description,
      locationId: installation.locationId,
      productType,
      availableInStore: true
    };
    
    if (price && !isNaN(parseFloat(price))) {
      productData.price = parseFloat(price);
    }
    
    const response = await axios.post('https://services.leadconnectorhq.com/products/', productData, {
      headers: {
        'Authorization': `Bearer ${installation.accessToken}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
        'Accept': 'application/json'
      }
    });
    
    res.json({ success: true, product: response.data.product });
    
  } catch (error) {
    console.error('Product creation error:', error.message);
    res.status(400).json({ error: error.response?.data || error.message });
  }
});

// Media upload API
const upload = multer({ dest: '/tmp/' });
app.post('/api/ghl/media/upload', upload.single('file'), async (req, res) => {
  try {
    const installation = oauthInstallations[0];
    if (!installation) {
      return res.status(401).json({ error: 'No OAuth installation found' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const form = new FormData();
    form.append('file', fs.createReadStream(req.file.path));
    form.append('fileName', req.file.originalname);
    form.append('locationId', installation.locationId);
    
    const response = await axios.post('https://services.leadconnectorhq.com/medias/upload-file', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${installation.accessToken}`,
        'Version': '2021-07-28'
      }
    });
    
    // Clean up temp file
    fs.unlink(req.file.path, () => {});
    
    res.json({ success: true, mediaId: response.data.fileId, url: response.data.fileUrl });
    
  } catch (error) {
    console.error('Media upload error:', error.message);
    res.status(400).json({ error: error.response?.data || error.message });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`GoHighLevel Modular Backend running on port ${PORT}`);
});