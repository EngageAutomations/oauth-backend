const express = require('express');
const app = express();
const PORT = process.env.PORT || 5000;

app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'OAuth Callback Proxy' });
});

app.get('/api/oauth/callback', async (req, res) => {
  console.log('=== OAUTH CALLBACK RECEIVED ===');
  console.log('Query params:', req.query);

  const queryParams = new URLSearchParams(req.query).toString();
  const replitOAuthUrl = `https://dir.engageautomations.com/api/oauth/callback?${queryParams}`;
  
  console.log('Forwarding to Replit:', replitOAuthUrl);
  res.redirect(replitOAuthUrl);
});

app.listen(PORT, () => {
  console.log(`✅ OAuth Proxy listening on port ${PORT}`);
});
