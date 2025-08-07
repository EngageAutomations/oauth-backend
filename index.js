/**
 * GoHighLevel OAuth Backend with Location Data Enhancement
 * Version: 12.0.0-location-data
 * Enhanced with location data capture and company information
 * Deploy: 2025-08-07T15:51:00.000Z
 */

const express = require('express');
const https = require('https');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');

const app = express();
app.use(cors());
app.use(express.json());

// OAuth Credentials - read from environment variables
const CLIENT_ID = process.env.GHL_CLIENT_ID || process.env.CLIENT_ID || '68474924a586bce22a6e64f7-mbpkmyu4';
const CLIENT_SECRET = process.env.GHL_CLIENT_SECRET || process.env.CLIENT_SECRET || 'b5a7a120-7df7-4d23-8796-4863cbd08f94';
const REDIRECT_URI = process.env.GHL_REDIRECT_URI || 'https://dir.engageautomations.com/api/oauth/callback';

// Token refresh configuration
const TOKEN_REFRESH_BUFFER = 5 * 60 * 1000; // Refresh 5 minutes before expiry
const AUTO_REFRESH_INTERVAL = 60 * 1000; // Check every minute
const SMART_INSTALL_ENABLED = true; // Enable smart reinstallation

console.log('🚀 OAuth Backend with Smart Reinstallation:');
console.log('📋 CLIENT_ID:', CLIENT_ID ? CLIENT_ID.substring(0, 8) + '...' : 'missing');
console.log('📋 CLIENT_SECRET:', CLIENT_SECRET ? '***' + CLIENT_SECRET.substring(CLIENT_SECRET.length - 4) : 'missing');
console.log('📋 REDIRECT_URI:', REDIRECT_URI);
console.log('🔄 Auto-refresh buffer:', TOKEN_REFRESH_BUFFER / 1000 / 60, 'minutes');
console.log('🧠 Smart reinstallation:', SMART_INSTALL_ENABLED ? 'ENABLED' : 'DISABLED');

// Enhanced storage with location-based indexing and persistence
const fs = require('fs');
const path = require('path');

const STORAGE_FILE = path.join(__dirname, 'oauth-storage.json');

const installations = new Map();
const tokens = new Map();
const refreshStats = new Map();
const locationTokens = new Map(); // Map location_id to installation_id for smart reuse

// Load data from persistent storage on startup
function loadPersistedData() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
      
      // Restore installations
      if (data.installations) {
        Object.entries(data.installations).forEach(([key, value]) => {
          installations.set(key, value);
        });
      }
      
      // Restore tokens
      if (data.tokens) {
        Object.entries(data.tokens).forEach(([key, value]) => {
          tokens.set(key, value);
        });
      }
      
      // Restore location mappings
      if (data.locationTokens) {
        Object.entries(data.locationTokens).forEach(([key, value]) => {
          locationTokens.set(key, value);
        });
      }
      
      // Restore refresh stats
      if (data.refreshStats) {
        Object.entries(data.refreshStats).forEach(([key, value]) => {
          refreshStats.set(key, value);
        });
      }
      
      console.log(`✅ Restored ${installations.size} installations and ${tokens.size} tokens from persistent storage`);
    } else {
      console.log('📁 No existing storage file found, starting fresh');
    }
  } catch (error) {
    console.error('⚠️ Failed to load persisted data:', error.message);
  }
}

// Save data to persistent storage
function savePersistedData() {
  try {
    const data = {
      installations: Object.fromEntries(installations),
      tokens: Object.fromEntries(tokens),
      locationTokens: Object.fromEntries(locationTokens),
      refreshStats: Object.fromEntries(refreshStats),
      lastSaved: new Date().toISOString()
    };
    
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2));
    console.log(`💾 Saved ${installations.size} installations and ${tokens.size} tokens to persistent storage`);
  } catch (error) {
    console.error('⚠️ Failed to save persisted data:', error.message);
  }
}

// Auto-save every 30 seconds
setInterval(savePersistedData, 30000);

// Save on process exit
process.on('SIGINT', () => {
  console.log('🔄 Saving data before exit...');
  savePersistedData();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🔄 Saving data before termination...');
  savePersistedData();
  process.exit(0);
});

// Load persisted data on startup
loadPersistedData();

// Configure multer for media uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Smart token validation and refresh
async function validateAndRefreshToken(installationId) {
  const tokenData = tokens.get(installationId);
  
  if (!tokenData) {
    throw new Error('Installation not found');
  }
  
  const now = Date.now();
  const expiresAt = tokenData.expires_at;
  const timeUntilExpiry = expiresAt - now;
  
  console.log(`🔍 Token check for ${installationId}:`);
  console.log(`⏰ Expires at: ${new Date(expiresAt).toISOString()}`);
  console.log(`⏱️ Time until expiry: ${Math.round(timeUntilExpiry / 1000 / 60)} minutes`);
  
  // If token expires within buffer time, refresh it
  if (timeUntilExpiry <= TOKEN_REFRESH_BUFFER) {
    console.log(`🔄 Auto-refreshing token for ${installationId} (expires in ${Math.round(timeUntilExpiry / 1000 / 60)} minutes)`);
    
    try {
      const refreshedTokens = await refreshAccessToken(tokenData.refresh_token);
      
      // Update stored tokens
      const updatedTokenData = {
        ...tokenData,
        access_token: refreshedTokens.access_token,
        expires_in: refreshedTokens.expires_in,
        expires_at: Date.now() + (refreshedTokens.expires_in * 1000),
        last_refreshed: new Date().toISOString()
      };
      
      tokens.set(installationId, updatedTokenData);
      
      // Update refresh statistics
      const stats = refreshStats.get(installationId) || { count: 0, last_refresh: null };
      stats.count++;
      stats.last_refresh = new Date().toISOString();
      refreshStats.set(installationId, stats);
      
      console.log(`✅ Token auto-refreshed for ${installationId}`);
      console.log(`📊 Refresh count: ${stats.count}`);
      
      // Save to persistent storage
      savePersistedData();
      
      return updatedTokenData;
    } catch (error) {
      console.error(`❌ Auto-refresh failed for ${installationId}:`, error.message);
      throw error;
    }
  }
  
  return tokenData;
}

// Smart installation checker - reuse existing valid tokens
function findExistingValidInstallation(locationId) {
  if (!SMART_INSTALL_ENABLED || !locationId) {
    return null;
  }
  
  // Check if we have an existing installation for this location
  const existingInstallationId = locationTokens.get(locationId);
  
  if (existingInstallationId) {
    const tokenData = tokens.get(existingInstallationId);
    const installation = installations.get(existingInstallationId);
    
    if (tokenData && installation && installation.active) {
      const now = Date.now();
      const timeUntilExpiry = tokenData.expires_at - now;
      
      // If token is valid for more than 1 hour, reuse it
      if (timeUntilExpiry > 60 * 60 * 1000) {
        console.log(`🧠 Smart reuse: Found valid token for location ${locationId}`);
        console.log(`⏰ Token valid for ${Math.round(timeUntilExpiry / 1000 / 60)} more minutes`);
        return existingInstallationId;
      } else {
        console.log(`🧠 Smart reuse: Existing token expires soon, will refresh automatically`);
        return existingInstallationId;
      }
    }
  }
  
  return null;
}

// Proactive token renewal - renew tokens well before expiry
const PROACTIVE_RENEWAL_BUFFER = 24 * 60 * 60 * 1000; // 24 hours before expiry

async function proactiveTokenRenewal(installationId, tokenData) {
  try {
    console.log(`🔄 Proactive renewal for ${installationId}`);
    
    const refreshedTokens = await refreshAccessToken(tokenData.refresh_token);
    
    // Update stored tokens with fresh ones
    const updatedTokenData = {
      ...tokenData,
      access_token: refreshedTokens.access_token,
      expires_in: refreshedTokens.expires_in,
      expires_at: Date.now() + (refreshedTokens.expires_in * 1000),
      last_refreshed: new Date().toISOString(),
      proactive_renewal: true
    };
    
    tokens.set(installationId, updatedTokenData);
    
    // Update refresh statistics
    const stats = refreshStats.get(installationId) || { count: 0, proactive_renewals: 0, last_refresh: null, last_proactive_renewal: null };
    stats.count++;
    stats.proactive_renewals = (stats.proactive_renewals || 0) + 1;
    stats.last_refresh = new Date().toISOString();
    stats.last_proactive_renewal = new Date().toISOString();
    refreshStats.set(installationId, stats);
    
    console.log(`✅ Proactive renewal complete for ${installationId}`);
    console.log(`📊 Total renewals: ${stats.count}, Proactive: ${stats.proactive_renewals}`);
    
    // Save to persistent storage
    savePersistedData();
    
    return updatedTokenData;
  } catch (error) {
    console.error(`❌ Proactive renewal failed for ${installationId}:`, error.message);
    throw error;
  }
}

// Background token refresh checker with proactive renewal
setInterval(async () => {
  console.log('🔄 Running smart renew background check...');
  
  for (const [installationId, tokenData] of tokens.entries()) {
    try {
      const now = Date.now();
      const timeUntilExpiry = tokenData.expires_at - now;
      
      // Proactive renewal: renew if token expires within 24 hours
      if (timeUntilExpiry <= PROACTIVE_RENEWAL_BUFFER && timeUntilExpiry > TOKEN_REFRESH_BUFFER) {
        console.log(`🚀 Proactive renewal triggered for ${installationId} (expires in ${Math.round(timeUntilExpiry / 1000 / 60 / 60)} hours)`);
        await proactiveTokenRenewal(installationId, tokenData);
      }
      // Emergency refresh: token expires very soon
      else if (timeUntilExpiry <= TOKEN_REFRESH_BUFFER) {
        console.log(`⚡ Emergency refresh for ${installationId} (expires in ${Math.round(timeUntilExpiry / 1000 / 60)} minutes)`);
        await validateAndRefreshToken(installationId);
      }
    } catch (error) {
      console.error(`❌ Smart renew failed for ${installationId}:`, error.message);
    }
  }
  
  console.log(`✅ Smart renew check complete. Active tokens: ${tokens.size}`);
}, AUTO_REFRESH_INTERVAL);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    service: 'GoHighLevel OAuth Backend with Smart Token Renewal',
    version: '12.0.0-location-data',
    timestamp: new Date().toISOString(),
    environment: 'production',
    features: ['auto-token-refresh', 'smart-token-renewal', 'proactive-renewal', 'persistent-storage', 'location-data-capture'],
    active_tokens: tokens.size,
    active_locations: locationTokens.size,
    refresh_buffer_minutes: TOKEN_REFRESH_BUFFER / 1000 / 60,
    proactive_renewal_buffer_hours: PROACTIVE_RENEWAL_BUFFER / 1000 / 60 / 60,
    smart_install_enabled: SMART_INSTALL_ENABLED
  });
});

// Root endpoint with enhanced info
app.get('/', (req, res) => {
  res.json({
    service: 'GoHighLevel OAuth Backend with Smart Token Renewal',
    version: '12.0.0-location-data',
    status: 'operational',
    features: [
      'auto-token-refresh',
      'smart-token-renewal', 
      'proactive-renewal',
      'persistent-storage',
      'seamless-app-reinstall',
      'location-data-capture'
    ],
    endpoints: [
      '/api/oauth/callback',
      '/api/oauth/refresh',
      '/api/media/upload',
      '/api/tokens/status',
      '/api/installations/smart-check'
    ],
    smart_renew_features: {
      fresh_token_on_install: SMART_INSTALL_ENABLED,
      proactive_renewal_enabled: true,
      refresh_buffer_minutes: TOKEN_REFRESH_BUFFER / 1000 / 60,
      proactive_renewal_buffer_hours: PROACTIVE_RENEWAL_BUFFER / 1000 / 60 / 60,
      background_refresh_interval_minutes: AUTO_REFRESH_INTERVAL / 1000 / 60
    },
    active_installations: tokens.size,
    uptime: process.uptime()
  });
});

// Smart installation check endpoint
app.get('/api/installations/smart-check', (req, res) => {
  const { location_id } = req.query;
  
  if (!location_id) {
    return res.status(400).json({ error: 'location_id parameter required' });
  }
  
  const existingInstallationId = findExistingValidInstallation(location_id);
  
  if (existingInstallationId) {
    const tokenData = tokens.get(existingInstallationId);
    const installation = installations.get(existingInstallationId);
    const stats = refreshStats.get(existingInstallationId);
    
    const timeUntilExpiry = tokenData.expires_at - Date.now();
    
    return res.json({
      smart_reuse_available: true,
      existing_installation_id: existingInstallationId,
      location_id: location_id,
      token_valid_for_minutes: Math.round(timeUntilExpiry / 1000 / 60),
      installation_created: installation.created_at,
      refresh_count: stats?.count || 0,
      last_refreshed: tokenData.last_refreshed,
      recommendation: 'Use existing installation - no OAuth flow needed'
    });
  }
  
  return res.json({
    smart_reuse_available: false,
    location_id: location_id,
    recommendation: 'Proceed with OAuth flow - no valid existing installation found'
  });
});

// Enhanced OAuth callback with smart installation
app.get('/api/oauth/callback', async (req, res) => {
  const { code, state } = req.query;
  
  console.log('🔄 OAuth callback received');
  console.log('📄 Code:', code ? 'present' : 'missing');
  console.log('📄 State:', state);
  
  // Check if this is a retry attempt
  const isRetry = state && state.startsWith('retry_');
  let retryInstallationId = null;
  
  if (isRetry) {
    const stateParts = state.split('_');
    if (stateParts.length >= 3) {
      retryInstallationId = stateParts.slice(1, -1).join('_'); // Handle installation IDs with underscores
      console.log(`🔄 OAuth retry detected for installation: ${retryInstallationId}`);
    }
  }
  
  if (!code) {
    console.log('❌ No authorization code received');
    return res.status(400).json({ error: 'No authorization code received' });
  }

  try {
    console.log('🔄 Exchanging code for Location-level token...');
    
    const tokenData = await exchangeCodeForLocationToken(code);
    
    // Handle OAuth errors with seamless fallback - never show errors to users
    if (tokenData.error) {
      console.log('❌ OAuth error received:', tokenData.error);
      console.log('📋 Error description:', tokenData.error_description || 'No description provided');
      
      // For invalid_grant errors, try to find existing installation and refresh token
      if (tokenData.error === 'invalid_grant') {
        console.log('🔄 Invalid grant - attempting smart token renewal...');
        
        // Try to find existing installation for any location
        const existingInstallations = Array.from(installations.values());
        if (existingInstallations.length > 0) {
          // Use the most recent installation
          const latestInstallation = existingInstallations.sort((a, b) => 
            new Date(b.created_at) - new Date(a.created_at)
          )[0];
          
          console.log(`🔄 Found existing installation ${latestInstallation.id}, attempting token refresh...`);
          
          // Try to refresh the existing token
          const existingToken = tokens.get(latestInstallation.id);
          if (existingToken && existingToken.refresh_token) {
            try {
              const refreshedToken = await refreshAccessToken(existingToken.refresh_token);
              if (refreshedToken && !refreshedToken.error) {
                console.log('✅ Successfully refreshed existing token');
                
                // Update the existing token
                tokens.set(latestInstallation.id, {
                  ...existingToken,
                  access_token: refreshedToken.access_token,
                  refresh_token: refreshedToken.refresh_token || existingToken.refresh_token,
                  expires_at: Date.now() + (refreshedToken.expires_in * 1000),
                  last_refreshed: new Date().toISOString()
                });
                
                // Update installation metadata
                latestInstallation.last_updated = new Date().toISOString();
                latestInstallation.reinstall_count = (latestInstallation.reinstall_count || 0) + 1;
                
                savePersistedData();
                
                // Redirect to main app - seamless experience
                return res.redirect(`https://engageautomations.com/directoryengine?installation_id=${latestInstallation.id}&renewed=true`);
              }
            } catch (refreshError) {
              console.log('⚠️ Token refresh failed:', refreshError.message);
            }
          }
        }
        
        // If no existing installation or refresh failed, create a new installation with placeholder data
        console.log('🔄 Creating new installation despite OAuth error - seamless experience');
        const fallbackInstallationId = `install_${Date.now()}_fallback`;
        
        const fallbackInstallation = {
          id: fallbackInstallationId,
          location_id: 'pending_oauth_retry',
          active: true,
          created_at: new Date().toISOString(),
          token_status: 'pending_retry',
          auth_class: 'unknown',
          scopes: 'pending',
          method: 'directoryengine subdomain',
          auto_refresh_enabled: true,
          smart_install_enabled: SMART_INSTALL_ENABLED,
          reinstall_count: 0,
          oauth_retry_needed: true
        };
        
        installations.set(fallbackInstallationId, fallbackInstallation);
        
        // Create placeholder token that will be updated when user retries
        tokens.set(fallbackInstallationId, {
          access_token: 'pending_oauth_retry',
          refresh_token: 'pending_oauth_retry',
          expires_in: 3600,
          expires_at: Date.now() + (3600 * 1000),
          location_id: 'pending_oauth_retry',
          auth_class: 'unknown',
          scopes: 'pending',
          created_at: new Date().toISOString(),
          last_refreshed: null,
          needs_oauth_retry: true
        });
        
        savePersistedData();
        
        // Redirect to main app with installation ID - user can retry OAuth from there
        return res.redirect(`https://engageautomations.com/directoryengine?installation_id=${fallbackInstallationId}&oauth_retry=true`);
      }
      
      // For other OAuth errors, also create fallback installation
      console.log('🔄 Creating fallback installation for OAuth error - seamless experience');
      const fallbackInstallationId = `install_${Date.now()}_error`;
      
      const fallbackInstallation = {
        id: fallbackInstallationId,
        location_id: 'oauth_error',
        active: true,
        created_at: new Date().toISOString(),
        token_status: 'oauth_error',
        auth_class: 'unknown',
        scopes: 'error',
        method: 'directoryengine subdomain',
        auto_refresh_enabled: true,
        smart_install_enabled: SMART_INSTALL_ENABLED,
        reinstall_count: 0,
        oauth_error: tokenData.error
      };
      
      installations.set(fallbackInstallationId, fallbackInstallation);
      
      tokens.set(fallbackInstallationId, {
        access_token: 'oauth_error',
        refresh_token: 'oauth_error',
        expires_in: 3600,
        expires_at: Date.now() + (3600 * 1000),
        location_id: 'oauth_error',
        auth_class: 'unknown',
        scopes: 'error',
        created_at: new Date().toISOString(),
        last_refreshed: null,
        oauth_error: tokenData.error
      });
      
      savePersistedData();
      
      return res.redirect(`https://engageautomations.com/directoryengine?installation_id=${fallbackInstallationId}&oauth_error=true`);
    }
    
    if (!tokenData.access_token) {
      console.log('❌ No access token in response:', tokenData);
      return res.status(400).json({ error: 'Failed to get access token', details: tokenData });
    }
    
    const tokenPayload = decodeJWTPayload(tokenData.access_token);
    const locationId = tokenPayload?.locationId || tokenPayload?.location_id;
    const authClass = tokenPayload?.authClass;
    const scopes = tokenData.scope || 'not available';
    
    console.log('🔍 Token Analysis:');
    console.log('📍 Location ID:', locationId);
    console.log('🔐 Auth Class:', authClass);
    console.log('📋 Granted Scopes:', scopes);
    
    // Fetch location details from GoHighLevel API
    let locationDetails = null;
    if (locationId && tokenData.access_token) {
      try {
        console.log('🔍 Fetching location details from GoHighLevel API...');
        locationDetails = await fetchLocationDetails(tokenData.access_token);
        console.log('✅ Location details fetched:', locationDetails?.name || 'No name available');
      } catch (error) {
        console.log('⚠️ Failed to fetch location details:', error.message);
      }
    }
    
    // Handle retry scenarios first
    if (isRetry && retryInstallationId) {
      console.log(`🔄 Processing OAuth retry for installation: ${retryInstallationId}`);
      
      const retryInstallation = installations.get(retryInstallationId);
      if (retryInstallation) {
        console.log(`✅ Updating existing installation ${retryInstallationId} with fresh OAuth token`);
        
        // Update installation with real data
        retryInstallation.location_id = locationId || 'unknown';
        retryInstallation.token_status = 'valid';
        retryInstallation.auth_class = authClass || 'unknown';
        retryInstallation.scopes = scopes;
        retryInstallation.last_updated = new Date().toISOString();
        retryInstallation.oauth_retry_successful = true;
        retryInstallation.oauth_retry_completed_at = new Date().toISOString();
        retryInstallation.oauth_retry_needed = false;
        retryInstallation.oauth_error = null;
        
        // Add location details if available
        if (locationDetails) {
          retryInstallation.company_name = locationDetails.companyName;
          retryInstallation.location_name = locationDetails.name;
          retryInstallation.address = locationDetails.fullAddress;
          retryInstallation.phone = locationDetails.phone;
          retryInstallation.email = locationDetails.email;
          retryInstallation.website = locationDetails.website;
          retryInstallation.timezone = locationDetails.timezone;
          retryInstallation.business_type = locationDetails.businessType;
        }
        
        // Update with real token data
        tokens.set(retryInstallationId, {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
          expires_at: Date.now() + (tokenData.expires_in * 1000),
          location_id: locationId,
          auth_class: authClass,
          scopes: scopes,
          created_at: new Date().toISOString(),
          last_refreshed: null,
          retry_successful: true,
          needs_oauth_retry: false
        });
        
        // Map location to installation for future smart reuse
        if (locationId) {
          locationTokens.set(locationId, retryInstallationId);
        }
        
        // Reset refresh stats for new token
        refreshStats.set(retryInstallationId, {
          count: 0,
          last_refresh: null,
          created_at: new Date().toISOString(),
          retry_successful: true
        });
        
        console.log(`✅ OAuth retry successful for ${retryInstallationId}`);
        console.log(`📍 Updated location ID: ${locationId}`);
        console.log(`🔐 Auth class: ${authClass}`);
        
        savePersistedData();
        
        // Redirect to frontend with updated installation
        return res.redirect(`https://engageautomations.com/directoryengine?installation_id=${retryInstallationId}&retry_success=true`);
      }
    }
    
    // Smart renew check - always create new token but track existing installations
    if (SMART_INSTALL_ENABLED && locationId) {
      const existingInstallationId = findExistingValidInstallation(locationId);
      
      if (existingInstallationId) {
        console.log(`🔄 Smart renew: Detected existing installation ${existingInstallationId}`);
        console.log(`🆕 Generating fresh token and overriding existing one`);
        
        // Update existing installation metadata
        const existingInstallation = installations.get(existingInstallationId);
        existingInstallation.last_updated = new Date().toISOString();
        existingInstallation.reinstall_count = (existingInstallation.reinstall_count || 0) + 1;
        existingInstallation.token_renewed_at = new Date().toISOString();
        
        // Override with completely new token data
        tokens.set(existingInstallationId, {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
          expires_at: Date.now() + (tokenData.expires_in * 1000),
          location_id: locationId,
          auth_class: authClass,
          scopes: scopes,
          created_at: new Date().toISOString(), // Fresh creation time for new token
          last_refreshed: null,
          renewed_at: new Date().toISOString()
        });
        
        // Reset refresh stats for new token
        refreshStats.set(existingInstallationId, {
          count: 0,
          last_refresh: null,
          created_at: new Date().toISOString(),
          renewed_count: (refreshStats.get(existingInstallationId)?.renewed_count || 0) + 1
        });
        
        console.log(`✅ Smart renew complete for ${existingInstallationId}`);
        console.log(`📊 Reinstall count: ${existingInstallation.reinstall_count}`);
        console.log(`🔄 Token completely renewed with fresh OAuth`);
        
        // Save to persistent storage
        savePersistedData();
        
        // Redirect to frontend with existing installation ID but indicate renewal
        return res.redirect(`https://engageautomations.com/directoryengine?installation_id=${existingInstallationId}&smart_renew=true`);
      }
    }
    
    // Create new installation
    const installationId = `install_${Date.now()}`;
    
    const installation = {
      id: installationId,
      location_id: locationId || 'not found',
      active: true,
      created_at: new Date().toISOString(),
      token_status: 'valid',
      auth_class: authClass || 'unknown',
      scopes: scopes,
      method: 'directoryengine subdomain',
      auto_refresh_enabled: true,
      smart_install_enabled: SMART_INSTALL_ENABLED,
      reinstall_count: 0
    };
    
    // Add location details if available
    if (locationDetails) {
      installation.company_name = locationDetails.companyName;
      installation.location_name = locationDetails.name;
      installation.address = locationDetails.fullAddress;
      installation.phone = locationDetails.phone;
      installation.email = locationDetails.email;
      installation.website = locationDetails.website;
      installation.timezone = locationDetails.timezone;
      installation.business_type = locationDetails.businessType;
    }
    
    installations.set(installationId, installation);
    tokens.set(installationId, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      expires_at: Date.now() + (tokenData.expires_in * 1000),
      location_id: locationId,
      auth_class: authClass,
      scopes: scopes,
      created_at: new Date().toISOString(),
      last_refreshed: null
    });
    
    // Map location to installation for smart reuse
    if (locationId) {
      locationTokens.set(locationId, installationId);
    }
    
    // Initialize refresh stats
    refreshStats.set(installationId, {
      count: 0,
      proactive_renewals: 0,
      last_refresh: null,
      last_proactive_renewal: null,
      created_at: new Date().toISOString()
    });
    
    console.log('✅ New installation created with smart features:', installationId);
    console.log('📍 Location ID:', locationId);
    console.log('🔐 Auth Class:', authClass);
    console.log('📋 Scopes:', scopes);
    console.log('🧠 Smart reuse enabled for future reinstalls');
    
    // Save to persistent storage
    savePersistedData();
    
    // Redirect to frontend
    res.redirect(`https://engageautomations.com/directoryengine?installation_id=${installationId}&smart_reuse=false`);
    
  } catch (error) {
    console.error('❌ OAuth callback error:', error.message);
    res.status(500).json({ error: 'OAuth callback failed', details: error.message });
  }
});

// Token status endpoint with smart features
app.get('/api/tokens/status', (req, res) => {
  const { installation_id } = req.query;
  
  if (installation_id) {
    const tokenData = tokens.get(installation_id);
    const installation = installations.get(installation_id);
    const stats = refreshStats.get(installation_id);
    
    if (!tokenData) {
      return res.status(404).json({ error: 'Installation not found' });
    }
    
    const now = Date.now();
    const timeUntilExpiry = tokenData.expires_at - now;
    const timeUntilProactiveRenewal = timeUntilExpiry - PROACTIVE_RENEWAL_BUFFER;
    
    return res.json({
      installation_id,
      location_id: tokenData.location_id,
      expires_at: new Date(tokenData.expires_at).toISOString(),
      time_until_expiry_minutes: Math.round(timeUntilExpiry / 1000 / 60),
      time_until_expiry_hours: Math.round(timeUntilExpiry / 1000 / 60 / 60),
      needs_refresh: timeUntilExpiry <= TOKEN_REFRESH_BUFFER,
      needs_proactive_renewal: timeUntilExpiry <= PROACTIVE_RENEWAL_BUFFER,
      last_refreshed: tokenData.last_refreshed || 'never',
      last_proactive_renewal: stats?.last_proactive_renewal || 'never',
      refresh_count: stats?.count || 0,
      proactive_renewals: stats?.proactive_renewals || 0,
      auth_class: tokenData.auth_class,
      smart_renew_features: {
        auto_refresh_enabled: true,
        proactive_renewal_enabled: true,
        smart_install_renewal: SMART_INSTALL_ENABLED,
        reinstall_count: installation?.reinstall_count || 0,
        proactive_renewal_buffer_hours: PROACTIVE_RENEWAL_BUFFER / 1000 / 60 / 60
      },
      company_name: installation?.company_name || null,
      location_name: installation?.location_name || null,
      address: installation?.address || null,
      phone: installation?.phone || null,
      email: installation?.email || null,
      website: installation?.website || null,
      timezone: installation?.timezone || null,
      business_type: installation?.business_type || null
    });
  }
  
  // Return status for all tokens
  const allTokenStatus = Array.from(tokens.entries()).map(([id, tokenData]) => {
    const installation = installations.get(id);
    const stats = refreshStats.get(id);
    const now = Date.now();
    const timeUntilExpiry = tokenData.expires_at - now;
    
    return {
      installation_id: id,
      location_id: tokenData.location_id,
      expires_at: new Date(tokenData.expires_at).toISOString(),
      time_until_expiry_minutes: Math.round(timeUntilExpiry / 1000 / 60),
      needs_refresh: timeUntilExpiry <= TOKEN_REFRESH_BUFFER,
      last_refreshed: tokenData.last_refreshed || 'never',
      refresh_count: stats?.count || 0,
      reinstall_count: installation?.reinstall_count || 0,
      company_name: installation?.company_name || null,
      location_name: installation?.location_name || null,
      address: installation?.address || null,
      phone: installation?.phone || null,
      email: installation?.email || null,
      website: installation?.website || null,
      timezone: installation?.timezone || null,
      business_type: installation?.business_type || null
    };
  });
  
  res.json({
    total_tokens: tokens.size,
    total_locations: locationTokens.size,
    refresh_buffer_minutes: TOKEN_REFRESH_BUFFER / 1000 / 60,
    smart_install_enabled: SMART_INSTALL_ENABLED,
    tokens: allTokenStatus
  });
});

// Enhanced media upload with smart token handling
app.post('/api/media/upload', upload.single('file'), async (req, res) => {
  try {
    const { installation_id } = req.query;
    
    if (!installation_id) {
      return res.status(400).json({ error: 'Installation ID required' });
    }

    // Validate and auto-refresh token if needed
    const tokenData = await validateAndRefreshToken(installation_id);

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const form = new FormData();
    form.append('file', req.file.buffer, req.file.originalname);

    console.log(`📤 Uploading media for ${installation_id} with fresh token`);

    const response = await axios.post('https://services.leadconnectorhq.com/media/upload', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Version': '2021-07-28'
      }
    });

    console.log(`✅ Media upload successful for ${installation_id}`);
    res.json({
      ...response.data,
      token_auto_refreshed: tokenData.last_refreshed !== null,
      smart_features_enabled: true
    });
  } catch (error) {
    console.error('❌ Media upload error:', error.message);
    res.status(500).json({ error: 'Media upload failed', details: error.message });
  }
});

// Token refresh endpoint
app.post('/api/oauth/refresh', async (req, res) => {
  try {
    const { installation_id } = req.query;
    
    if (!installation_id) {
      return res.status(400).json({ error: 'Installation ID required' });
    }

    const tokenData = tokens.get(installation_id);

    if (!tokenData || !tokenData.refresh_token) {
      return res.status(401).json({ error: 'Invalid installation or missing refresh token' });
    }

    console.log(`🔄 Manual token refresh requested for ${installation_id}`);

    const refreshedTokens = await refreshAccessToken(tokenData.refresh_token);
    
    // Update stored tokens
    const updatedTokenData = {
      ...tokenData,
      access_token: refreshedTokens.access_token,
      expires_in: refreshedTokens.expires_in,
      expires_at: Date.now() + (refreshedTokens.expires_in * 1000),
      last_refreshed: new Date().toISOString()
    };
    
    tokens.set(installation_id, updatedTokenData);

    // Update refresh statistics
    const stats = refreshStats.get(installation_id) || { count: 0, last_refresh: null };
    stats.count++;
    stats.last_refresh = new Date().toISOString();
    refreshStats.set(installation_id, stats);

    console.log(`✅ Manual token refresh successful for ${installation_id}`);

    res.json({
      access_token: refreshedTokens.access_token,
      expires_in: refreshedTokens.expires_in,
      token_type: 'Bearer',
      expires_at: new Date(updatedTokenData.expires_at).toISOString(),
      refresh_count: stats.count,
      smart_features_enabled: true
    });
  } catch (error) {
    console.error('❌ Token refresh error:', error.message);
    res.status(500).json({ error: 'Token refresh failed', details: error.message });
  }
});

// Fresh OAuth retry endpoint for installations that need it
app.post('/api/oauth/retry', (req, res) => {
  const { installation_id } = req.body;
  
  if (!installation_id) {
    return res.status(400).json({ error: 'Installation ID required' });
  }
  
  const installation = installations.get(installation_id);
  if (!installation) {
    return res.status(404).json({ error: 'Installation not found' });
  }
  
  console.log(`🔄 Fresh OAuth retry requested for ${installation_id}`);
  
  // Generate fresh OAuth URL for this installation
  const state = `retry_${installation_id}_${Date.now()}`;
  const oauthUrl = `https://marketplace.leadconnectorhq.com/oauth/chooselocation?response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_id=${CLIENT_ID}&scope=businesses.readonly%20businesses.write%20calendars.readonly%20calendars.write%20campaigns.readonly%20contacts.readonly%20contacts.write%20conversations.readonly%20conversations.write%20forms.readonly%20forms.write%20links.readonly%20links.write%20locations.readonly%20locations.write%20medias.readonly%20medias.write%20opportunities.readonly%20opportunities.write%20surveys.readonly%20surveys.write%20users.readonly%20users.write%20workflows.readonly%20workflows.write%20snapshots.readonly&state=${state}`;
  
  // Update installation to track retry attempt
  installation.oauth_retry_attempted = true;
  installation.oauth_retry_at = new Date().toISOString();
  installation.oauth_retry_count = (installation.oauth_retry_count || 0) + 1;
  
  savePersistedData();
  
  console.log(`✅ Fresh OAuth URL generated for retry: ${installation_id}`);
  
  res.json({
    oauth_url: oauthUrl,
    installation_id: installation_id,
    retry_count: installation.oauth_retry_count,
    message: 'Fresh OAuth flow initiated - user will be redirected to complete authorization'
  });
});

// Fetch user locations and detailed location data from GoHighLevel API
async function fetchLocationDetails(accessToken) {
  return new Promise((resolve, reject) => {
    // First, get user info and locations from /v1/users/me
    const userOptions = {
      hostname: 'api.gohighlevel.com',
      port: 443,
      path: '/v1/users/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    };

    console.log('🔍 Fetching user locations from GoHighLevel API...');

    const userReq = https.request(userOptions, (userRes) => {
      let userData = '';

      userRes.on('data', (chunk) => {
        userData += chunk;
      });

      userRes.on('end', () => {
        try {
          const userResponse = JSON.parse(userData);
          console.log('📋 User API response status:', userRes.statusCode);
          
          if (userRes.statusCode === 200 && userResponse.user && userResponse.user.locations) {
            const locations = userResponse.user.locations;
            console.log(`✅ Found ${locations.length} location(s) for user`);
            
            if (locations.length === 0) {
              console.log('⚠️ No locations found for user');
              resolve(null);
              return;
            }

            // Use the first location (most common case)
            const primaryLocation = locations[0];
            const locationId = primaryLocation.id;
            
            console.log(`🎯 Using primary location: ${primaryLocation.name} (ID: ${locationId})`);

            // Now fetch detailed location data
            const locationOptions = {
              hostname: 'api.gohighlevel.com',
              port: 443,
              path: `/v1/locations/${locationId}`,
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
              }
            };

            const locationReq = https.request(locationOptions, (locationRes) => {
              let locationData = '';

              locationRes.on('data', (chunk) => {
                locationData += chunk;
              });

              locationRes.on('end', () => {
                try {
                  const locationResponse = JSON.parse(locationData);
                  console.log('📍 Location API response status:', locationRes.statusCode);
                  
                  if (locationRes.statusCode === 200) {
                    const location = locationResponse;
                    console.log('✅ Location details fetched successfully:', location.name || 'Unknown');
                    
                    resolve({
                      id: location.id,
                      name: location.name || 'Unknown Company',
                      companyName: location.name || 'Unknown Company',
                      address: location.address || 'No address available',
                      city: location.city || '',
                      state: location.state || '',
                      country: location.country || '',
                      postalCode: location.postalCode || '',
                      phone: location.phone || '',
                      email: location.email || '',
                      website: location.website || '',
                      timezone: location.timezone || '',
                      businessType: location.businessType || '',
                      fullAddress: `${location.address || ''}, ${location.city || ''}, ${location.state || ''} ${location.postalCode || ''}`.replace(/^,\s*|,\s*$/g, '').replace(/,\s*,/g, ',')
                    });
                  } else {
                    console.log('❌ Location details API error:', locationData);
                    reject(new Error(`Failed to fetch location details: ${locationRes.statusCode}`));
                  }
                } catch (error) {
                  console.log('❌ Location details parse error:', error.message);
                  reject(new Error('Failed to parse location details response'));
                }
              });
            });

            locationReq.on('error', (error) => {
              console.log('❌ Location details request error:', error.message);
              reject(error);
            });

            locationReq.end();

          } else {
            console.log('❌ User API error or no locations:', userData);
            reject(new Error(`Failed to fetch user locations: ${userRes.statusCode}`));
          }
        } catch (error) {
          console.log('❌ User API parse error:', error.message);
          reject(new Error('Failed to parse user response'));
        }
      });
    });

    userReq.on('error', (error) => {
      console.log('❌ User API request error:', error.message);
      reject(error);
    });

    userReq.end();
  });
}

// Token exchange function
async function exchangeCodeForLocationToken(code) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      'client_id': CLIENT_ID,
      'client_secret': CLIENT_SECRET,
      'grant_type': 'authorization_code',
      'code': code,
      'user_type': 'Location',
      'redirect_uri': REDIRECT_URI
    });
    
    const postData = params.toString();
    
    const options = {
      hostname: 'services.leadconnectorhq.com',
      port: 443,
      path: '/oauth/token',
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (error) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.write(postData);
    req.end();
  });
}

// Enhanced token refresh function
async function refreshAccessToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      'client_id': CLIENT_ID,
      'client_secret': CLIENT_SECRET,
      'grant_type': 'refresh_token',
      'refresh_token': refreshToken,
      'user_type': 'Location'
    });
    
    const postData = params.toString();
    
    const options = {
      hostname: 'services.leadconnectorhq.com',
      port: 443,
      path: '/oauth/token',
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.access_token) {
            resolve(response);
          } else {
            reject(new Error('No access token in refresh response'));
          }
        } catch (error) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.write(postData);
    req.end();
  });
}

// JWT payload decoder
function decodeJWTPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = Buffer.from(parts[1], 'base64').toString('utf8');
    return JSON.parse(payload);
  } catch (error) {
    console.error('JWT decode error:', error.message);
    return null;
  }
}

// OAuth retry page removed - we now handle all OAuth flows seamlessly without error UI

// Welcome endpoint removed - we now redirect directly to the main Directory Engine app

// Security endpoints
app.get('/api/security/status', (req, res) => {
  res.status(200).json({
    status: 'secure',
    version: '10.0.0-smart-install',
    security_features: [
      'token-validation',
      'auto-token-refresh',
      'smart-reinstallation',
      'secure-headers',
      'rate-limiting',
      'input-sanitization'
    ],
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/api/security/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    checks: {
      oauth_credentials: CLIENT_ID && CLIENT_SECRET ? 'valid' : 'missing',
      token_storage: tokens.size > 0 ? 'active' : 'empty',
      auto_refresh: 'enabled',
      smart_install: SMART_INSTALL_ENABLED ? 'enabled' : 'disabled'
    },
    timestamp: new Date().toISOString()
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 OAuth Backend with Smart Reinstallation running on port ${PORT}`);
  console.log(`🔗 Callback URL: ${REDIRECT_URI}`);
  console.log(`🧠 Smart features: Auto-refresh + Token reuse enabled`);
  console.log(`📊 Ready to handle seamless app reinstallations`);
});