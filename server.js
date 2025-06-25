const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let installations = [];

app.get('/', (req, res) => {
  res.json({
    service: "OAuth Backend",
    version: "3.0.0",
    status: "running",
    installations: installations.length
  });
});

app.get('/api/oauth/callback', (req, res) => {
  const { code, error } = req.query;
  
  if (error) {
    return res.redirect(`https://dir.engageautomations.com/?oauth=error&message=${error}`);
  }
  
  if (code) {
    installations.push({ id: Date.now(), code, created: new Date() });
    return res.redirect(`https://dir.engageautomations.com/?oauth=success&code=${code}`);
  }
  
  res.redirect('https://dir.engageautomations.com/?oauth=error&message=no_code');
});

app.get('/test', (req, res) => {
  res.json({ status: 'ok', count: installations.length });
});

app.listen(PORT, () => console.log(`Port ${PORT}`));