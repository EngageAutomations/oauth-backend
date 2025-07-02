const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    message: 'Single backend deployment successful'
  });
});

// Test installation endpoint
app.get('/installations', (req, res) => {
  res.json({
    installations: [
      {
        id: 'install_1751436979939',
        status: 'active',
        locationId: 'SGtYHkPbOl2WJV08GOpg',
        createdAt: new Date().toISOString()
      }
    ]
  });
});

// Test token access endpoint
app.get('/api/token-access/:id', (req, res) => {
  res.json({
    access_token: 'test_token_for_debugging',
    installation_id: req.params.id,
    status: 'active'
  });
});

// Basic product creation test
app.post('/api/products/create', (req, res) => {
  console.log('Product creation request:', req.body);
  res.json({
    success: true,
    message: 'Single backend deployment working',
    productId: 'test_product_' + Date.now()
  });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Single backend server running on port ${port}`);
  console.log('Deployment timestamp:', new Date().toISOString());
});

module.exports = app;