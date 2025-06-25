const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// OAuth credentials that were working
const oauthConfig = {
  clientId: '68474924a586bce22a6e64f7-mbpkmyu4',
  clientSecret: 'b5a7a120-7df7-4d23-8796-4863cbd08f94',
  redirectUri: 'https://dir.engageautomations.com/api/oauth/callback'
};

// Simple token storage
const installations = new Map();

app.get('/', (req, res) => {
  res.json({
    service: 'GoHighLevel OAuth Backend',
    version: '5.5.0-simple-restore',
    installs: installations.size,
    authenticated: installations.size,
    status: 'operational',
    debug: 'restored simple working version',
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
      const { access_token, refresh_token } = tokenResponse.data;
      
      const userResponse = await axios.get('https://services.leadconnectorhq.com/oauth/userinfo', {
        headers: { Authorization: 'Bearer ' + access_token }
      });
      
      if (userResponse.status === 200) {
        const userData = userResponse.data;
        
        installations.set(userData.locationId, {
          accessToken: access_token,
          refreshToken: refresh_token,
          locationId: userData.locationId,
          userId: userData.id,
          companyName: userData.companyName
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
    isActive: true
  }));
  
  res.json({
    total: installations.size,
    authenticated: installations.size,
    installations: list
  });
});

app.post('/api/products/create', async (req, res) => {
  try {
    if (installations.size === 0) {
      return res.status(401).json({
        success: false,
        error: 'No active GoHighLevel installation found'
      });
    }
    
    const installation = Array.from(installations.values())[0];
    
    const response = await axios.post('https://services.leadconnectorhq.com/products/', {
      name: req.body.name,
      description: req.body.description,
      type: req.body.type || 'DIGITAL',
      currency: req.body.currency || 'USD'
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
    console.error('Product creation error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log('OAuth Backend v5.5.0-simple-restore running on port', PORT);
});