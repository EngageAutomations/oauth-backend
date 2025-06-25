const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let installations = [];

app.get('/', (req, res) => {
  res.json({
    service: "GoHighLevel OAuth Backend",
    version: "3.1.0-stable",
    installs: installations.length,
    status: "operational",
    bridge_system: "active",
    ts: Date.now()
  });
});

app.get('/api/oauth/callback', (req, res) => {
  const { code, error } = req.query;
  
  if (error) {
    return res.redirect(`https://dir.engageautomations.com/?oauth=error&message=${encodeURIComponent(error)}`);
  }
  
  if (!code) {
    return res.redirect('https://dir.engageautomations.com/?oauth=error&message=Missing%20authorization%20code');
  }

  // Store basic installation data
  const installation = {
    id: installations.length + 1,
    authCode: code,
    timestamp: Date.now(),
    created: new Date().toISOString(),
    status: 'pending_token_exchange'
  };
  
  installations.push(installation);
  
  console.log('OAuth callback processed:', installation.id);
  
  return res.redirect(`https://dir.engageautomations.com/?oauth=success&installation_id=${installation.id}&code=${code}`);
});

app.get('/installations', (req, res) => {
  res.json({
    total: installations.length,
    installations: installations.map(install => ({
      id: install.id,
      status: install.status,
      created: install.created
    }))
  });
});

app.get('/test', (req, res) => {
  res.json({ 
    message: 'OAuth backend operational',
    installations: installations.length,
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path
  });
});

app.listen(PORT, () => {
  console.log(`OAuth backend running on port ${PORT}`);
});