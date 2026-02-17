const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const SCAN_INTERVAL = 8000;
const TRADES_LIMIT = 200;

let flaggedWhales = [];
let seenHashes = new Set();
let stats = {
  tradesChecked: 0,
  lowPriceMatches: 0,
  excludedMarkets: 0,
  lastScanTime: ''
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

app.get('/api/whales', (req, res) => {
  res.json({ flaggedWhales, stats });
});

app.post('/api/test-webhook', async (req, res) => {
  const webhookUrl = req.body.webhookUrl || DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.json({ success: false, error: 'No webhook URL configured' });
  }
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: '🧪 Test Notification',
          description: 'Your Polymarket Whale Scanner is connected and working!',
          color: 0x10b981,
          footer: { text: 'Polymarket Whale Scanner — Test Alert' },
          timestamp: new Date().toISOString()
        }]
      })
    });
    if (response.ok) {
      res.json({ success: true });
    } else {
      res.json({ success: false, error: `Discord returned ${response.status}` });
    }
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

async function sendDiscordAlert(whale) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    const pnlEmoji = whale.pnl >= 0 ? '🟢' : '🔴';
    const priceInCents = (whale.buy_price * 100).toFixed(0);
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: '🐋 Whale Detected',
          color: 0x10b981,
          fields: [
            { name: 'Trader', value: whale.username || whale.address, inline: true },
            { name: 'Entry Price', value: `${priceInCents}¢`, inline: true },
            { name: 'Market', value: whale.market_title || 'Unknown', inline: false },
            { name: `${pnlEmoji} PNL`, value: `$${whale.pnl.toLocaleString()}`, inline: true },
            { name: 'Max Position', value: `$${whale.max_pos_value.toLocaleString()}`, inline: true },
            { name: 'Positions', value: `${whale.pos_count} markets`, inline: true },
          ],
          footer: { text: 'Polymarket Whale Scanner' },
          timestamp: new Date().toISOString()
        }]
      })
    });
  } catch (e) {
    console.error('Discord webhook error:', e.message);
  }
}

async function runScanner() {
  try {
    const res = await fetch(`https://data-api.polymarket.com/trades?limit=${TRADES_LIMIT}`);
    if (!res.ok) return;
    const recentTrades = await res.json();

    for (const t of recentTrades) {
      const hash = t.transactionHash || `${t.user}-${t.timestamp}`;
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);

      if (seenHashes.size > 1000) seenHashes.clear();

      const price = parseFloat(t.price || 0);
      const title = t.title || "";

      if (t.side === 'BUY' && price <= 0.20) {
        stats.lowPriceMatches++;
        const userAddress = t.proxyWallet || t.user;
        if (!userAddress) continue;

        try {
          const portRes = await fetch(`https://data-api.polymarket.com/portfolio?user=${userAddress}`);
          if (!portRes.ok) continue;
          const portData = await portRes.json();

          const positions = portData.positions || [];
          const pnlValue = parseFloat(portData.pnl || 0);
          const maxPosValue = positions.reduce((max, p) => {
            const val = parseFloat(p.size || 0) * parseFloat(p.price || 0);
            return val > max ? val : max;
          }, 0);

          if (positions.length < 6 && pnlValue < 30000 && pnlValue > -30000 && maxPosValue > 2000) {
            const whale = {
              id: hash,
              address: userAddress,
              username: t.name || t.pseudonym || 'Fresh Whale',
              market_title: title,
              buy_price: price,
              pos_count: positions.length,
              pnl: pnlValue,
              max_pos_value: maxPosValue,
              timestamp: new Date().toISOString()
            };
            flaggedWhales = [whale, ...flaggedWhales].slice(0, 100);
            await sendDiscordAlert(whale);
          }
        } catch (e) {}
      }
      stats.tradesChecked++;
    }
    stats.lastScanTime = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
  } catch (err) {
    console.error("Scanner Loop Error:", err);
  }
}

setInterval(runScanner, SCAN_INTERVAL);
runScanner();

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running 24/7 on port ${PORT}`);
});
