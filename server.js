const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
const PORT = process.env.PORT || 3000;

// OAuth credentials
const CLIENT_ID = '68474924a586bce22a6e64f7-mbpkmyu4';
const CLIENT_SECRET = 'b5a7a120-7df7-4d23-8796-4863cbd08f94';
const REDIRECT_URI = 'https://dir.engageautomations.com/oauth/callback';

// Middleware
app.use(cors({
  origin: ['https://listings.engageautomations.com', 'http://localhost:3000', 'http://localhost:5000'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'ghl-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// OAuth installation storage
const installations = new Map();
const tokensByLocationId = new Map();

// Passport OAuth strategy
passport.use(new GoogleStrategy({
  clientID: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  callbackURL: REDIRECT_URI,
  scope: [
    'contacts.readonly', 'contacts.write',
    'locations.readonly', 'locations.write',
    'products.readonly', 'products.write'
  ]
}, async (accessToken, refreshToken, profile, done) => {
  try {
    console.log('OAuth callback received');
    
    const installation = {
      id: `install_${Date.now()}`,
      ghlUserId: profile.id,
      ghlUserEmail: profile.emails?.[0]?.value,
      ghlUserName: profile.displayName,
      ghlAccessToken: accessToken,
      ghlRefreshToken: refreshToken,
      ghlLocationId: profile.locationId || 'default-location',
      installationDate: new Date().toISOString(),
      isActive: true
    };
    
    installations.set(installation.id, installation);
    tokensByLocationId.set(installation.ghlLocationId, {
      accessToken,
      refreshToken,
      locationId: installation.ghlLocationId,
      installationId: installation.id
    });
    
    console.log('OAuth installation completed:', installation.id);
    
    return done(null, installation);
  } catch (error) {
    console.error('OAuth strategy error:', error);
    return done(error, null);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const installation = installations.get(id);
  done(null, installation);
});

// Helper function for GoHighLevel API requests
async function makeGHLRequest(endpoint, options = {}) {
  const tokenData = Array.from(tokensByLocationId.values())[0];
  if (!tokenData) {
    throw new Error('No OAuth installation found');
  }
  
  const { accessToken, locationId } = tokenData;
  
  // Ensure locationId is in the endpoint
  const separator = endpoint.includes('?') ? '&' : '?';
  const fullEndpoint = endpoint.includes('locationId') 
    ? endpoint 
    : `${endpoint}${separator}locationId=${locationId}`;
  
  console.log('Making GHL request to:', fullEndpoint);
  
  const fetch = require('node-fetch');
  const response = await fetch(`https://services.leadconnectorhq.com${fullEndpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
      ...options.headers
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('GHL API Error:', response.status, errorText);
    throw new Error(`GHL API Error: ${response.status} - ${errorText}`);
  }
  
  return response.json();
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'GoHighLevel Product API',
    version: '2.1.0-stable',
    installs: installations.size,
    authenticated: tokensByLocationId.size,
    status: 'operational',
    features: ['product-creation', 'product-listing', 'oauth-integration'],
    ts: Date.now()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    ok: true, 
    service: 'ghl-products-stable',
    version: '2.1.0-stable',
    installations: installations.size,
    authenticated: tokensByLocationId.size,
    ts: Date.now() 
  });
});

// OAuth routes
app.get('/oauth/start', passport.authenticate('google'));

app.get('/oauth/callback', 
  passport.authenticate('google', { failureRedirect: '/oauth/error' }),
  (req, res) => {
    console.log('OAuth callback successful');
    res.redirect('https://listings.engageautomations.com/?installation=success');
  }
);

app.get('/oauth/error', (req, res) => {
  console.log('OAuth error occurred');
  res.redirect('https://listings.engageautomations.com/?installation=error');
});

// List all products
app.get('/products', async (req, res) => {
  try {
    console.log('Fetching products from GoHighLevel...');
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const products = await makeGHLRequest(`/products?limit=${limit}&offset=${offset}`);
    
    console.log(`Found ${products.products?.length || 0} products`);
    
    res.json({
      success: true,
      products: products.products || [],
      total: products.total || 0,
      limit,
      offset
    });
  } catch (error) {
    console.error('Error fetching products:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message,
      products: [],
      total: 0
    });
  }
});

// Create product
app.post('/products', async (req, res) => {
  try {
    console.log('Creating product in GoHighLevel...');
    console.log('Product data:', req.body);
    
    const productData = {
      name: req.body.name || 'New Product',
      description: req.body.description || '',
      type: req.body.type || 'DIGITAL',
      price: Math.round((req.body.price || 0) * 100), // Convert to cents
      currency: req.body.currency || 'USD'
    };
    
    if (req.body.sku) {
      productData.sku = req.body.sku;
    }
    
    console.log('Formatted product data:', productData);
    
    const product = await makeGHLRequest('/products', {
      method: 'POST',
      body: JSON.stringify(productData)
    });
    
    console.log('Product created successfully:', product.id);
    
    res.status(201).json({
      success: true,
      product,
      message: 'Product created successfully in GoHighLevel'
    });
  } catch (error) {
    console.error('Product creation error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get specific product
app.get('/products/:id', async (req, res) => {
  try {
    console.log(`Fetching product ${req.params.id} from GoHighLevel...`);
    
    const product = await makeGHLRequest(`/products/${req.params.id}`);
    
    res.json({
      success: true,
      product
    });
  } catch (error) {
    console.error('Error fetching product:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Update product
app.put('/products/:id', async (req, res) => {
  try {
    console.log(`Updating product ${req.params.id} in GoHighLevel...`);
    
    const updateData = { ...req.body };
    if (updateData.price) {
      updateData.price = Math.round(updateData.price * 100);
    }
    
    const product = await makeGHLRequest(`/products/${req.params.id}`, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    });
    
    console.log('Product updated successfully');
    
    res.json({
      success: true,
      product,
      message: 'Product updated successfully'
    });
  } catch (error) {
    console.error('Product update error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Delete product
app.delete('/products/:id', async (req, res) => {
  try {
    console.log(`Deleting product ${req.params.id} from GoHighLevel...`);
    
    await makeGHLRequest(`/products/${req.params.id}`, {
      method: 'DELETE'
    });
    
    console.log('Product deleted successfully');
    
    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Product deletion error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Installation status
app.get('/installations', (req, res) => {
  const installList = Array.from(installations.values());
  res.json({
    total: installations.size,
    installations: installList,
    authenticated: tokensByLocationId.size
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`GoHighLevel Product API Server running on port ${PORT}`);
  console.log('Version: 2.1.0-stable');
  console.log('OAuth installations:', tokensByLocationId.size);
  console.log('Server started successfully');
});