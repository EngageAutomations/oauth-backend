// Working Railway OAuth Backend
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let installations = [];

app.get('/', (req, res) => {
  res.json({
    service: "GoHighLevel OAuth Backend",
    version: "2.5.0-working",
    installs: installations.length,
    status: "operational",
    ts: Date.now()
  });
});

app.get('/api/oauth/callback', (req, res) => {
  console.log('OAuth callback:', req.query);
  
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`https://dir.engageautomations.com/?oauth=error&message=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(`https://dir.engageautomations.com/?oauth=error&message=Missing%20code`);
  }

  // For now, just create a test installation
  const installation = {
    id: installations.length + 1,
    code: code,
    timestamp: Date.now()
  };
  installations.push(installation);

  console.log('Test installation created:', installation.id);
  
  return res.redirect(`https://dir.engageautomations.com/?oauth=success&installation_id=${installation.id}`);
});

app.get('/installations', (req, res) => {
  res.json({
    total: installations.length,
    installations: installations
  });
});

app.get('/test', (req, res) => {
  res.json({ 
    message: 'Working',
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
  console.log(`Server running on port ${PORT}`);
});