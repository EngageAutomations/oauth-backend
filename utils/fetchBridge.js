// utils/fetchBridge.js
const axios = require("axios");
const URL = process.env.BRIDGE_URL;

async function withRetry(fn, n = 3) {
  for (let i = 1; i <= n; i++) {
    try { return await fn(); }
    catch (e) { if (i === n) throw e; await new Promise(r => setTimeout(r, 1000*i)); }
  }
}

module.exports = async function getCreds() {
  if (!URL) throw new Error("BRIDGE_URL not set");
  
  return await withRetry(async () => {
    const { data } = await axios.get(URL, { timeout: 4000 });
    if (!data.clientId || !data.clientSecret) {
      throw new Error("Bridge returned empty creds");
    }
    console.log('[BRIDGE] Credentials fetched successfully');
    return data; // { clientId, clientSecret, ... }
  });
};