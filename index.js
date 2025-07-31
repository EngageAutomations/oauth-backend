const express = require('express');
const cors = require('cors');
const app = express();

// Basic middleware
app.use(cors());
app.use(express.json());

// In-memory storage
const installations = new Map();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '8.5.0-emergency-clean',
    installations: installations.size,
    timestamp: new Date().toISOString()
  });
});

// Basic OAuth callback (minimal for now)
app.get('/oauth/callback', (req, res) => {
  const { code, state } = req.query;
  
  if (!code) {
    return res.status(400).json({ error: 'Authorization code required' });
  }
  
  // For now, just redirect to frontend
  res.redirect(`https://dir.engageautomations.com/welcome?code=${code}&state=${state}`);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Emergency clean OAuth backend running on port ${PORT}`);
  console.log('📍 Version: 8.5.0-emergency-clean');
  console.log('✅ Merge conflicts resolved');
});

// Emergency deployment timestamp: 2025-07-30T20:05:00.000Z