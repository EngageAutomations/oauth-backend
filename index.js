const express = require('express');
const app = express();
const PORT = process.env.PORT || 5000;

app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'OAuth Proxy' });
});

app.get('/api/oauth/callback', (req, res) => {
  console.log('OAuth callback received:', req.query);
  
  const queryParams = new URLSearchParams(req.query).toString();
  const replitUrl = `https://dir.engageautomations.com/api/oauth/callback?${queryParams}`;
  
  console.log('Redirecting to:', replitUrl);
  res.redirect(replitUrl);
});

app.listen(PORT, () => {
  console.log(`Proxy listening on port ${PORT}`);
});