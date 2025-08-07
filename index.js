// Conservative OAuth Backend Enhancement
// Version: 12.1.0-conservative-token-management
// Purpose: Eliminate fallback installations and ensure robust token handling

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://dir.engageautomations.com/api/oauth/callback';

// Conservative token management settings
const TOKEN_REFRESH_BUFFER = 60 * 60 * 1000; // 1 hour before expiry (conservative)
const AUTO_REFRESH_INTERVAL = 30 * 60 * 1000; // Check every 30 minutes (conservative)
const STORAGE_FILE = path.join(__dirname, 'oauth-storage-conservative.json');

// In-memory storage with conservative validation
const installations = new Map();
const tokens = new Map();
const locationTokens = new Map();
const refreshStats = new Map();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Conservative logging
function logConservative(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  
  if (data) {
    console.log(logEntry, data);
  } else {
    console.log(logEntry);
  }
}

// Enhanced token validation with strict requirements
async function validateTokenStrict(tokenData) {
  if (!tokenData) {
    throw new Error('Token data is required');
  }
  
  if (!tokenData.access_token || tokenData.access_token === 'pending_oauth_retry' || tokenData.access_token === 'oauth_error') {
    throw new Error('Invalid or placeholder access token');
  }
  
  if (!tokenData.refresh_token || tokenData.refresh_token === 'pending_oauth_retry' || tokenData.refresh_token === 'oauth_error') {
    throw new Error('Invalid or placeholder refresh token');
  }
  
  if (!tokenData.expires_at || tokenData.expires_at <= Date.now()) {
    throw new Error('Token is expired');
  }
  
  return true;
}

// Conservative token refresh with enhanced error handling
async function refreshAccessToken(refreshToken) {
  try {
    logConservative('info', 'Attempting token refresh');
    
    const response = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });

    const data = await response.json();
    
    if (!response.ok || data.error) {
      throw new Error(`Token refresh failed: ${data.error || 'Unknown error'}`);
    }
    
    // Validate the refreshed token
    if (!data.access_token || !data.refresh_token) {
      throw new Error('Incomplete token data received from refresh');
    }
    
    logConservative('success', 'Token refresh successful');
    return data;
  } catch (error) {
    logConservative('error', 'Token refresh failed', error.message);
    throw error;
  }
}

// Conservative OAuth code exchange with strict validation
async function exchangeCodeForLocationToken(code) {
  try {
    logConservative('info', 'Exchanging authorization code for token');
    
    const response = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await response.json();
    
    // Conservative approach: Reject any error responses immediately
    if (!response.ok || data.error) {
      throw new Error(`OAuth exchange failed: ${data.error || data.error_description || 'Unknown error'}`);
    }
    
    // Strict validation of token data
    if (!data.access_token || !data.refresh_token) {
      throw new Error('Incomplete token data received from OAuth exchange');
    }
    
    logConservative('success', 'OAuth code exchange successful');
    return data;
  } catch (error) {
    logConservative('error', 'OAuth code exchange failed', error.message);
    throw error;
  }
}

// Enhanced token validation and refresh with conservative approach
async function validateAndRefreshTokenConservative(installationId) {
  const tokenData = tokens.get(installationId);
  
  if (!tokenData) {
    throw new Error('Installation not found');
  }
  
  // Strict validation
  try {
    await validateTokenStrict(tokenData);
  } catch (validationError) {
    logConservative('error', `Token validation failed for ${installationId}`, validationError.message);
    throw validationError;
  }
  
  const now = Date.now();
  const expiresAt = tokenData.expires_at;
  const timeUntilExpiry = expiresAt - now;
  
  logConservative('info', `Token check for ${installationId}: expires in ${Math.round(timeUntilExpiry / 1000 / 60)} minutes`);
  
  // Conservative refresh: refresh 1 hour before expiry
  if (timeUntilExpiry <= TOKEN_REFRESH_BUFFER) {
    logConservative('info', `Refreshing token for ${installationId} (expires soon)`);
    
    try {
      const refreshedTokens = await refreshAccessToken(tokenData.refresh_token);
      
      // Update stored tokens with strict validation
      const updatedTokenData = {
        ...tokenData,
        access_token: refreshedTokens.access_token,
        refresh_token: refreshedTokens.refresh_token || tokenData.refresh_token,
        expires_in: refreshedTokens.expires_in,
        expires_at: Date.now() + (refreshedTokens.expires_in * 1000),
        last_refreshed: new Date().toISOString(),
        refresh_method: 'conservative_auto'
      };
      
      // Validate the updated token
      await validateTokenStrict(updatedTokenData);
      
      tokens.set(installationId, updatedTokenData);
      
      // Update refresh statistics
      const stats = refreshStats.get(installationId) || { count: 0, last_refresh: null };
      stats.count++;
      stats.last_refresh = new Date().toISOString();
      refreshStats.set(installationId, stats);
      
      logConservative('success', `Token refreshed for ${installationId}`, { refresh_count: stats.count });
      
      // Save to persistent storage
      savePersistedDataConservative();
      
      return updatedTokenData;
    } catch (error) {
      logConservative('error', `Token refresh failed for ${installationId}`, error.message);
      throw error;
    }
  }
  
  return tokenData;
}

// Conservative data persistence
function savePersistedDataConservative() {
  try {
    const data = {
      installations: Object.fromEntries(installations),
      tokens: Object.fromEntries(tokens),
      locationTokens: Object.fromEntries(locationTokens),
      refreshStats: Object.fromEntries(refreshStats),
      lastSaved: new Date().toISOString(),
      version: '12.1.0-conservative-token-management'
    };
    
    // Create backup before saving
    if (fs.existsSync(STORAGE_FILE)) {
      const backupFile = `${STORAGE_FILE}.backup.${Date.now()}`;
      fs.copyFileSync(STORAGE_FILE, backupFile);
    }
    
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2));
    logConservative('info', `Saved ${installations.size} installations and ${tokens.size} tokens to storage`);
  } catch (error) {
    logConservative('error', 'Failed to save persisted data', error.message);
  }
}

// Load persisted data with validation
function loadPersistedDataConservative() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
      
      // Load and validate each token
      let validTokenCount = 0;
      let invalidTokenCount = 0;
      
      if (data.installations) {
        for (const [id, installation] of Object.entries(data.installations)) {
          installations.set(id, installation);
        }
      }
      
      if (data.tokens) {
        for (const [id, tokenData] of Object.entries(data.tokens)) {
          try {
            // Only load valid tokens
            if (tokenData.access_token !== 'pending_oauth_retry' && 
                tokenData.access_token !== 'oauth_error' &&
                tokenData.refresh_token !== 'pending_oauth_retry' &&
                tokenData.refresh_token !== 'oauth_error') {
              tokens.set(id, tokenData);
              validTokenCount++;
            } else {
              invalidTokenCount++;
              logConservative('warn', `Skipped loading invalid token for ${id}`);
            }
          } catch (error) {
            invalidTokenCount++;
            logConservative('warn', `Failed to validate token for ${id}`, error.message);
          }
        }
      }
      
      if (data.locationTokens) {
        for (const [locationId, installationId] of Object.entries(data.locationTokens)) {
          // Only map if the installation has a valid token
          if (tokens.has(installationId)) {
            locationTokens.set(locationId, installationId);
          }
        }
      }
      
      if (data.refreshStats) {
        for (const [id, stats] of Object.entries(data.refreshStats)) {
          refreshStats.set(id, stats);
        }
      }
      
      logConservative('success', `Loaded persisted data: ${validTokenCount} valid tokens, ${invalidTokenCount} invalid tokens skipped`);
    }
  } catch (error) {
    logConservative('error', 'Failed to load persisted data', error.message);
  }
}

// Conservative OAuth callback - NO FALLBACKS
app.get('/api/oauth/callback', async (req, res) => {
  const { code, state } = req.query;
  
  logConservative('info', 'OAuth callback received', { hasCode: !!code, state });
  
  // Conservative approach: Require authorization code
  if (!code) {
    logConservative('error', 'OAuth callback failed: No authorization code');
    return res.status(400).json({ 
      error: 'OAuth Failed', 
      message: 'No authorization code received. Please try the installation process again.',
      retry_url: 'https://marketplace.gohighlevel.com/apps/directory-engine'
    });
  }

  try {
    // Conservative token exchange - will throw on any error
    const tokenData = await exchangeCodeForLocationToken(code);
    
    // Strict validation of received token
    await validateTokenStrict(tokenData);
    
    // Decode token payload
    const tokenPayload = decodeJWTPayload(tokenData.access_token);
    const locationId = tokenPayload?.locationId || tokenPayload?.location_id;
    const authClass = tokenPayload?.authClass;
    const scopes = tokenData.scope || 'not available';
    
    if (!locationId) {
      throw new Error('No location ID found in token');
    }
    
    logConservative('info', 'Token validated successfully', { locationId, authClass, scopes });
    
    // Check for existing installation for this location
    const existingInstallationId = locationTokens.get(locationId);
    
    if (existingInstallationId && installations.has(existingInstallationId)) {
      // REINSTALLATION: Replace existing token completely
      logConservative('info', `Reinstallation detected for location ${locationId}, replacing token`);
      
      const existingInstallation = installations.get(existingInstallationId);
      
      // Update installation metadata
      existingInstallation.last_updated = new Date().toISOString();
      existingInstallation.reinstall_count = (existingInstallation.reinstall_count || 0) + 1;
      existingInstallation.token_replaced_at = new Date().toISOString();
      
      // COMPLETELY REPLACE the token (no merging)
      const newTokenData = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
        expires_at: Date.now() + (tokenData.expires_in * 1000),
        location_id: locationId,
        auth_class: authClass,
        scopes: scopes,
        created_at: new Date().toISOString(),
        last_refreshed: null,
        installation_type: 'reinstall_replacement'
      };
      
      tokens.set(existingInstallationId, newTokenData);
      
      // Reset refresh stats for new token
      refreshStats.set(existingInstallationId, {
        count: 0,
        last_refresh: null,
        created_at: new Date().toISOString(),
        reinstall_count: existingInstallation.reinstall_count
      });
      
      logConservative('success', `Token replaced for installation ${existingInstallationId}`);
      
      savePersistedDataConservative();
      
      return res.redirect(`https://engageautomations.com/directoryengine?installation_id=${existingInstallationId}&token_replaced=true`);
    } else {
      // NEW INSTALLATION: Create fresh installation with immediate token
      const installationId = `install_${Date.now()}`;
      
      const installation = {
        id: installationId,
        location_id: locationId,
        active: true,
        created_at: new Date().toISOString(),
        token_status: 'valid',
        auth_class: authClass || 'unknown',
        scopes: scopes,
        method: 'conservative_oauth',
        reinstall_count: 0,
        installation_type: 'new_install'
      };
      
      const newTokenData = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
        expires_at: Date.now() + (tokenData.expires_in * 1000),
        location_id: locationId,
        auth_class: authClass,
        scopes: scopes,
        created_at: new Date().toISOString(),
        last_refreshed: null,
        installation_type: 'new_install'
      };
      
      installations.set(installationId, installation);
      tokens.set(installationId, newTokenData);
      locationTokens.set(locationId, installationId);
      
      // Initialize refresh stats
      refreshStats.set(installationId, {
        count: 0,
        last_refresh: null,
        created_at: new Date().toISOString()
      });
      
      logConservative('success', `New installation created: ${installationId}`, { locationId, authClass });
      
      savePersistedDataConservative();
      
      return res.redirect(`https://engageautomations.com/directoryengine?installation_id=${installationId}&new_install=true`);
    }
    
  } catch (error) {
    // Conservative error handling: NO FALLBACKS, clear error messages
    logConservative('error', 'OAuth callback failed', error.message);
    
    return res.status(400).json({ 
      error: 'OAuth Installation Failed', 
      message: `Installation failed: ${error.message}. Please try installing the app again.`,
      retry_url: 'https://marketplace.gohighlevel.com/apps/directory-engine',
      timestamp: new Date().toISOString()
    });
  }
});

// Enhanced token status endpoint
app.get('/api/tokens/status', async (req, res) => {
  const { installation_id } = req.query;
  
  if (installation_id) {
    const tokenData = tokens.get(installation_id);
    const installation = installations.get(installation_id);
    const stats = refreshStats.get(installation_id);
    
    if (!tokenData) {
      return res.status(404).json({ error: 'Installation not found' });
    }
    
    try {
      // Validate token and refresh if needed
      const validatedToken = await validateAndRefreshTokenConservative(installation_id);
      
      const now = Date.now();
      const timeUntilExpiry = validatedToken.expires_at - now;
      
      return res.json({
        installation_id,
        location_id: validatedToken.location_id,
        token_status: 'valid',
        expires_at: new Date(validatedToken.expires_at).toISOString(),
        time_until_expiry_minutes: Math.round(timeUntilExpiry / 1000 / 60),
        time_until_expiry_hours: Math.round(timeUntilExpiry / 1000 / 60 / 60),
        needs_refresh: timeUntilExpiry <= TOKEN_REFRESH_BUFFER,
        last_refreshed: validatedToken.last_refreshed || 'never',
        refresh_count: stats?.count || 0,
        auth_class: validatedToken.auth_class,
        scopes: validatedToken.scopes,
        installation_type: validatedToken.installation_type || 'unknown',
        reinstall_count: installation?.reinstall_count || 0,
        conservative_features: {
          no_fallback_installations: true,
          strict_token_validation: true,
          immediate_token_population: true,
          token_replacement_on_reinstall: true,
          conservative_refresh_buffer_minutes: TOKEN_REFRESH_BUFFER / 1000 / 60
        }
      });
    } catch (error) {
      logConservative('error', `Token validation failed for ${installation_id}`, error.message);
      return res.status(400).json({ 
        error: 'Token validation failed', 
        message: error.message,
        installation_id 
      });
    }
  }
  
  // Overall status
  const validTokens = Array.from(tokens.values()).filter(token => {
    try {
      return token.access_token !== 'pending_oauth_retry' && 
             token.access_token !== 'oauth_error' &&
             token.expires_at > Date.now();
    } catch {
      return false;
    }
  });
  
  res.json({
    total_tokens: tokens.size,
    valid_tokens: validTokens.length,
    total_locations: locationTokens.size,
    total_installations: installations.size,
    version: '12.1.0-conservative-token-management',
    conservative_features: {
      no_fallback_installations: true,
      strict_token_validation: true,
      immediate_token_population: true,
      token_replacement_on_reinstall: true
    }
  });
});

// JWT payload decoder
function decodeJWTPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (error) {
    logConservative('error', 'Failed to decode JWT payload', error.message);
    return null;
  }
}

// Background token maintenance (conservative approach)
setInterval(async () => {
  logConservative('info', 'Running conservative token maintenance check');
  
  let refreshedCount = 0;
  let errorCount = 0;
  
  for (const [installationId, tokenData] of tokens.entries()) {
    try {
      const now = Date.now();
      const timeUntilExpiry = tokenData.expires_at - now;
      
      // Conservative refresh: only refresh if within buffer time
      if (timeUntilExpiry <= TOKEN_REFRESH_BUFFER && timeUntilExpiry > 0) {
        await validateAndRefreshTokenConservative(installationId);
        refreshedCount++;
      }
    } catch (error) {
      errorCount++;
      logConservative('error', `Maintenance failed for ${installationId}`, error.message);
    }
  }
  
  logConservative('info', `Token maintenance complete: ${refreshedCount} refreshed, ${errorCount} errors`);
}, AUTO_REFRESH_INTERVAL);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    service: 'GoHighLevel OAuth Backend - Conservative Token Management',
    version: '12.1.0-conservative-token-management',
    timestamp: new Date().toISOString(),
    environment: 'production',
    features: {
      no_fallback_installations: true,
      strict_token_validation: true,
      immediate_token_population: true,
      token_replacement_on_reinstall: true,
      conservative_refresh_buffer_minutes: TOKEN_REFRESH_BUFFER / 1000 / 60,
      auto_refresh_interval_minutes: AUTO_REFRESH_INTERVAL / 1000 / 60
    },
    active_tokens: tokens.size,
    active_locations: locationTokens.size,
    active_installations: installations.size
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'GoHighLevel OAuth Backend - Conservative Token Management',
    version: '12.1.0-conservative-token-management',
    status: 'operational',
    features: [
      'No fallback installations',
      'Strict token validation',
      'Immediate token population',
      'Token replacement on reinstall',
      'Conservative refresh timing'
    ]
  });
});

// Load persisted data on startup
loadPersistedDataConservative();

// Auto-save every 30 seconds
setInterval(savePersistedDataConservative, 30000);

// Graceful shutdown
process.on('SIGINT', () => {
  logConservative('info', 'Saving data before shutdown');
  savePersistedDataConservative();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logConservative('info', 'Saving data before termination');
  savePersistedDataConservative();
  process.exit(0);
});

app.listen(PORT, () => {
  logConservative('success', `Conservative OAuth Backend running on port ${PORT}`);
});

module.exports = app;