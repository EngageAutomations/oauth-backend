const createApp = require('./src/app');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Embedded OAuth Credentials - Direct fix for Railway env issues
const OAUTH_CONFIG = {
  CLIENT_ID: '68474924a586bce22a6e64f7-mbpkmyu4',
  CLIENT_SECRET: 'b5a7a120-7df7-4d23-8796-4863cbd08f94',
  REDIRECT_URI: 'https://dir.engageautomations.com/api/oauth/callback'
};

async function initializeOAuthCredentials() {
  // Set environment variables directly
  process.env.CLIENT_ID = OAUTH_CONFIG.CLIENT_ID;
  process.env.CLIENT_SECRET = OAUTH_CONFIG.CLIENT_SECRET;
  
  console.log('OAuth credentials embedded:', {
    CLIENT_ID: process.env.CLIENT_ID ? '[CONFIGURED]' : '[MISSING]',
    CLIENT_SECRET: process.env.CLIENT_SECRET ? '[CONFIGURED]' : '[MISSING]',
    source: 'embedded-direct'
  });
}

async function startServer() {
  // Initialize OAuth credentials first
  await initializeOAuthCredentials();
  
  console.log('Config check:', {
    CLIENT_ID: process.env.CLIENT_ID ? '[set]' : '[MISSING - REQUIRED]',
    CLIENT_SECRET: process.env.CLIENT_SECRET ? '[set]' : '[MISSING - REQUIRED]',
    REDIRECT: '/api/oauth/callback',
    PORT
  });

  if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET) {
    console.error('');
    console.error('⚠️  CRITICAL: OAuth credentials missing after embedding!');
    console.error('   This should not happen with embedded credentials');
    console.error('   OAuth flow will fail without these credentials');
    console.error('');
  }

  const app = createApp();

  app.listen(PORT, HOST, () => {
    console.log(`🚀 GHL proxy (credentials-fixed) listening on ${HOST}:${PORT}`);
    console.log('📍 Routes registered:');
    console.log('   - OAuth: /api/oauth/callback, /api/oauth/status');
    console.log('   - Media: /api/ghl/locations/:locationId/media');
    console.log('   - Products: /api/ghl/locations/:locationId/products');
    console.log('   - Legacy: /api/ghl/products/create (deprecated)');
    console.log('   - Health: /, /health');
    console.log('');
    console.log('✅ Ready for OAuth installation flow');
    console.log('🔇 OAuth credentials: embedded-direct');
  });
}

startServer();