const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch');

// Deployment timestamp: 2025-06-24T23:04:39.273Z
// Version: 2.0.0-complete-force-deploy

const app = express();
const PORT = process.env.PORT || 3000;

// OAuth credentials
const CLIENT_ID = '68474924a586bce22a6e64f7-mbpkmyu4';
const CLIENT_SECRET = 'b5a7a120-7df7-4d23-8796-4863cbd08f94';
const REDIRECT_URI = 'https://dir.engageautomations.com/oauth/callback';

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max file size
    files: 10 // Maximum 10 files
  }
});

// Middleware
app.use(cors({
  origin: ['https://listings.engageautomations.com', 'http://localhost:3000', 'http://localhost:5000'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'ghl-product-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
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
    'products.readonly', 'products.write',
    'medias.readonly', 'medias.write'
  ]
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const installation = {
      id: `install_${Date.now()}`,
      ghlUserId: profile.id,
      ghlUserEmail: profile.emails?.[0]?.value,
      ghlUserName: profile.displayName,
      ghlAccessToken: accessToken,
      ghlRefreshToken: refreshToken,
      ghlLocationId: profile.locationId,
      ghlLocationName: profile.locationName,
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
    console.log('Location ID:', installation.ghlLocationId);
    
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
  
  // Add locationId to endpoint if not present
  const separator = endpoint.includes('?') ? '&' : '?';
  const fullEndpoint = endpoint.includes('locationId') 
    ? endpoint 
    : `${endpoint}${separator}locationId=${locationId}`;
  
  const response = await fetch(`https://services.leadconnectorhq.com${fullEndpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': options.isFormData ? undefined : 'application/json',
      'Version': '2021-07-28',
      ...options.headers
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GHL API Error: ${response.status} - ${errorText}`);
  }
  
  return response.json();
}

// Root endpoint with comprehensive API info
app.get('/', (req, res) => {
  res.json({
    service: 'GoHighLevel Product API',
    version: '2.0.0-complete-deployed',
    installs: installations.size,
    authenticated: tokensByLocationId.size,
    deployedAt: '2025-06-24T23:04:39.273Z',
    features: {
      products: 'Create, read, update, delete products',
      images: 'Multi-image upload and management',
      media: 'GoHighLevel media library integration'
    },
    endpoints: {
      oauth: {
        'GET /oauth/start': 'Initiate OAuth flow',
        'GET /oauth/callback': 'OAuth callback handler'
      },
      products: {
        'GET /products': 'List all products',
        'POST /products': 'Create product with images',
        'GET /products/:id': 'Get specific product',
        'PUT /products/:id': 'Update product',
        'DELETE /products/:id': 'Delete product'
      },
      media: {
        'POST /upload-images': 'Upload multiple images to GHL media library',
        'GET /media': 'List media files'
      }
    },
    ts: Date.now()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    ok: true, 
    service: 'ghl-products-complete',
    version: '2.0.0-complete-deployed',
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
  res.redirect('https://listings.engageautomations.com/?installation=error');
});

// Upload images to GoHighLevel media library
app.post('/upload-images', upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }
    
    console.log(`Uploading ${req.files.length} images to GoHighLevel`);
    
    const uploadedImages = [];
    
    for (const file of req.files) {
      try {
        const formData = new FormData();
        formData.append('file', file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype
        });
        
        const tokenData = Array.from(tokensByLocationId.values())[0];
        if (!tokenData) {
          throw new Error('No OAuth installation found');
        }
        
        const uploadResponse = await fetch(`https://services.leadconnectorhq.com/medias/upload-file?locationId=${tokenData.locationId}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tokenData.accessToken}`,
            'Version': '2021-07-28'
          },
          body: formData
        });
        
        if (uploadResponse.ok) {
          const uploadResult = await uploadResponse.json();
          uploadedImages.push({
            id: uploadResult.id,
            name: uploadResult.name,
            url: uploadResult.url,
            originalName: file.originalname
          });
          console.log(`Image uploaded: ${uploadResult.name}`);
        } else {
          const error = await uploadResponse.text();
          console.error(`Failed to upload ${file.originalname}:`, error);
        }
      } catch (fileError) {
        console.error(`Error uploading ${file.originalname}:`, fileError);
      }
    }
    
    res.json({
      success: true,
      uploadedImages,
      total: uploadedImages.length,
      message: `Successfully uploaded ${uploadedImages.length} images`
    });
    
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List all products
app.get('/products', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    
    const products = await makeGHLRequest(`/products?limit=${limit}&offset=${offset}`);
    
    res.json({
      success: true,
      products: products.products || [],
      total: products.total || 0,
      limit,
      offset
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create product with images
app.post('/products', async (req, res) => {
  try {
    const productData = {
      name: req.body.name,
      description: req.body.description || '',
      type: req.body.type || 'DIGITAL',
      price: Math.round((req.body.price || 0) * 100), // Convert to cents
      currency: req.body.currency || 'USD',
      sku: req.body.sku || null,
      status: req.body.status || 'ACTIVE'
    };
    
    // Add image URLs if provided
    if (req.body.imageUrls && req.body.imageUrls.length > 0) {
      productData.medias = req.body.imageUrls.map(url => ({ url, type: 'image' }));
    }
    
    console.log('Creating product:', productData);
    
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
    console.error('Product creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get specific product
app.get('/products/:id', async (req, res) => {
  try {
    const product = await makeGHLRequest(`/products/${req.params.id}`);
    res.json({
      success: true,
      product
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update product
app.put('/products/:id', async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (updateData.price) {
      updateData.price = Math.round(updateData.price * 100);
    }
    
    const product = await makeGHLRequest(`/products/${req.params.id}`, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    });
    
    res.json({
      success: true,
      product,
      message: 'Product updated successfully'
    });
  } catch (error) {
    console.error('Product update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete product
app.delete('/products/:id', async (req, res) => {
  try {
    await makeGHLRequest(`/products/${req.params.id}`, {
      method: 'DELETE'
    });
    
    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Product deletion error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List media files
app.get('/media', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    
    const media = await makeGHLRequest(`/medias?limit=${limit}&offset=${offset}`);
    
    res.json({
      success: true,
      media: media.medias || [],
      total: media.total || 0
    });
  } catch (error) {
    console.error('Error fetching media:', error);
    res.status(500).json({ error: error.message });
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
  console.log('Version: 2.0.0-complete-deployed');
  console.log('Features: Product CRUD, Multi-image upload, Media management');
  console.log('OAuth installations:', tokensByLocationId.size);
});