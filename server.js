const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

let DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const SCAN_INTERVAL = 8000;
const TRADES_LIMIT = 200;

let flaggedWhales = [];
let recentRejects = [];
let seenHashes = new Set();
let stats = {
  tradesChecked: 0,
  lowPriceMatches: 0,
  excludedMarkets: 0,
  lastScanTime: ''
};

let detectedClusters = [];
let clusterNearMisses = [];
let dismissedClusterIds = new Set();
let clusterStats = { totalDetected: 0, highAlertCount: 0, lastScanTime: '' };
const clusterBuffer = new Map(); // conditionId -> trade[]
let clusterSeenHashes = new Set();

const CLUSTER_INTERVAL = 10000;
const CLUSTER_WINDOW_SEC = 120;
const CLUSTER_MIN_WALLETS = 6;
const CLUSTER_PRICE_MIN = 0.02;
const CLUSTER_PRICE_MAX = 0.20;
const CLUSTER_NEW_WALLET_THRESHOLD = 10;
const CLUSTER_NEW_WALLET_MIN_PCT = 40;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

app.get('/api/whales', (req, res) => {
  res.json({ flaggedWhales, recentRejects, stats, webhookUrl: DISCORD_WEBHOOK_URL });
});

app.post('/api/webhook-url', (req, res) => {
  const url = req.body.webhookUrl || "";
  DISCORD_WEBHOOK_URL = url;
  console.log(`Webhook URL ${url ? 'updated' : 'cleared'}`);
  res.json({ success: true, hasWebhook: !!url });
});

app.post('/api/dismiss-whale', (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, error: 'No id provided' });
  flaggedWhales = flaggedWhales.filter(w => w.id !== id);
  res.json({ success: true, remaining: flaggedWhales.length });
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
        content: '@everyone',
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

function computeSignalStrength({ walletCount, newWalletPct, totalVolume, marketLiquidity, timeSpreadSeconds, sharedFundingCount }) {
  // --- Base score ---
  let score = 0;

  // Wallet count: reduced weight (+2 max)
  if (walletCount >= 15) score += 2;
  else if (walletCount >= 6) score += 1 + (walletCount - 6) / 9;

  // Volume vs liquidity: >1%=1pt, >5%=2pts, >10%=3pts
  if (marketLiquidity > 0) {
    const ratio = (totalVolume / marketLiquidity) * 100;
    if (ratio > 10) score += 3;
    else if (ratio > 5) score += 2;
    else if (ratio > 1) score += 1;
  }

  // Time density: harder to fake — +2 if all within 30s, +1 if within 60s
  if (timeSpreadSeconds <= 30) score += 2;
  else if (timeSpreadSeconds <= 60) score += 1;

  // Common funding source: instant 10/10 if 3+ wallets share a funder
  if (sharedFundingCount >= 3) return 10;

  // --- New wallet % as multiplier ---
  // Low fresh %: score × 0.5 (probably just news)
  // Mid fresh %: score × 1.0
  // High fresh %: score × 1.5, floor at 9 (Sybil indicator)
  let multiplier = 1.0;
  if (newWalletPct >= 80) {
    multiplier = 1.5;
    score = Math.max(score * multiplier, 9); // 80%+ fresh always >= 9
    return Math.min(10, Math.round(score));
  } else if (newWalletPct >= 60) {
    multiplier = 1.25;
  } else if (newWalletPct >= 40) {
    multiplier = 1.0;
  } else {
    multiplier = 0.5; // low fresh % = likely organic news pop
  }

  return Math.min(10, Math.max(1, Math.round(score * multiplier)));
}

async function sendClusterAlert(cluster) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    const color = cluster.signalStrength >= 7 ? 0x10b981 : cluster.signalStrength >= 4 ? 0xf59e0b : 0xf43f5e;
    const vol24hrPct = cluster.marketVolume24hr > 0 ? ((cluster.totalVolume / cluster.marketVolume24hr) * 100).toFixed(1) : 'N/A';
    const polyLink = cluster.marketSlug ? `https://polymarket.com/event/${cluster.marketSlug}` : 'https://polymarket.com';
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: cluster.isHighAlert ? '@everyone' : '',
        embeds: [{
          title: `🔵 Cluster Detected${cluster.isHighAlert ? ' — 🚨 HIGH ALERT' : ''}`,
          color,
          fields: [
            { name: 'Market', value: cluster.marketTitle || 'Unknown', inline: false },
            { name: 'Signal Strength', value: `${cluster.signalStrength}/10`, inline: true },
            { name: 'Wallets', value: `${cluster.walletCount}`, inline: true },
            { name: 'New Wallets %', value: `${cluster.newWalletPct.toFixed(0)}%`, inline: true },
            { name: 'Cluster Vol', value: `$${cluster.totalVolume.toFixed(2)}`, inline: true },
            { name: 'vs 24hr Vol %', value: `${vol24hrPct}%`, inline: true },
            { name: 'Time Spread', value: `${cluster.timeSpreadSeconds}s`, inline: true },
            ...(cluster.sharedFundingSource ? [{
              name: `⚠️ Shared Funder (${cluster.sharedFundingCount} wallets)`,
              value: `\`${cluster.sharedFundingSource.slice(0, 10)}...${cluster.sharedFundingSource.slice(-6)}\``,
              inline: false
            }] : []),
            { name: 'Polymarket', value: `[View Market](${polyLink})`, inline: false },
          ],
          footer: { text: 'Polymarket Cluster Scanner' },
          timestamp: new Date().toISOString()
        }]
      })
    });
  } catch (e) {
    console.error('Discord cluster webhook error:', e.message);
  }
}

async function sendDiscordAlert(whale) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    const pnlEmoji = whale.pnl >= 0 ? '🟢' : '🔴';
    const priceInCents = (whale.buy_price * 100).toFixed(0);
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '@everyone',
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

      const CRYPTO_KEYWORDS = ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'solana', 'sol', 'doge', 'dogecoin', 'xrp', 'ripple', 'bnb', 'cardano', 'ada', 'altcoin', 'defi', 'nft', 'token', 'coin', 'blockchain', 'web3'];
      const isCryptoMarket = CRYPTO_KEYWORDS.some(kw => title.toLowerCase().includes(kw));

      if (isCryptoMarket) {
        stats.excludedMarkets++;
        continue;
      }

      if (t.side === 'BUY' && price <= 0.20) {
        stats.lowPriceMatches++;
        const userAddress = t.proxyWallet || t.user;
        if (!userAddress) continue;

        try {
          const portRes = await fetch(`https://data-api.polymarket.com/positions?user=${userAddress}`);
          if (!portRes.ok) continue;
          const positions = await portRes.json();

          const pnlValue = positions.reduce((sum, p) => sum + parseFloat(p.cashPnl || 0), 0);
          const maxPosValue = positions.reduce((max, p) => {
            const val = parseFloat(p.currentValue || 0);
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
          } else {
            const failReasons = [];
            if (positions.length >= 6) failReasons.push(`Too many positions (${positions.length})`);
            if (pnlValue >= 30000) failReasons.push(`PNL too high ($${pnlValue.toLocaleString()})`);
            if (pnlValue <= -30000) failReasons.push(`PNL too low ($${pnlValue.toLocaleString()})`);
            if (maxPosValue <= 2000) failReasons.push(`Max position too small ($${maxPosValue.toFixed(2)})`);
            recentRejects = [{
              address: userAddress,
              username: t.name || t.pseudonym || userAddress.slice(0, 10) + '...',
              market_title: title,
              buy_price: price,
              pos_count: positions.length,
              pnl: pnlValue,
              max_pos_value: maxPosValue,
              failReasons,
              timestamp: new Date().toISOString()
            }, ...recentRejects].slice(0, 3);
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

async function runClusterScanner() {
  try {
    const CRYPTO_KEYWORDS = ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'solana', 'sol', 'doge', 'dogecoin', 'xrp', 'ripple', 'bnb', 'cardano', 'ada', 'altcoin', 'defi', 'nft', 'token', 'coin', 'blockchain', 'web3'];
    const res = await fetch(`https://data-api.polymarket.com/trades?limit=200`);
    if (!res.ok) return;
    const recentTrades = await res.json();

    const nowSec = Math.floor(Date.now() / 1000);

    for (const t of recentTrades) {
      const hash = t.transactionHash || `${t.user}-${t.timestamp}`;
      if (clusterSeenHashes.has(hash)) continue;
      clusterSeenHashes.add(hash);
      if (clusterSeenHashes.size > 2000) clusterSeenHashes.clear();

      if (t.side !== 'BUY') continue;
      const price = parseFloat(t.price || 0);
      if (price < CLUSTER_PRICE_MIN || price > CLUSTER_PRICE_MAX) continue;
      const title = t.title || '';
      if (CRYPTO_KEYWORDS.some(kw => title.toLowerCase().includes(kw))) continue;

      const conditionId = t.conditionId;
      if (!conditionId) continue;

      if (!clusterBuffer.has(conditionId)) clusterBuffer.set(conditionId, []);
      clusterBuffer.get(conditionId).push({
        user: t.proxyWallet || t.user,
        username: t.name || t.pseudonym || '',
        price,
        size: parseFloat(t.size || 0),
        timestamp: t.timestamp || nowSec,
        transactionHash: hash,
        title,
        slug: t.slug,
      });
    }

    // Purge entries older than CLUSTER_WINDOW_SEC
    for (const [condId, trades] of clusterBuffer.entries()) {
      const fresh = trades.filter(tr => (nowSec - tr.timestamp) <= CLUSTER_WINDOW_SEC);
      if (fresh.length === 0) clusterBuffer.delete(condId);
      else clusterBuffer.set(condId, fresh);
    }

    // Evaluate each conditionId for cluster
    for (const [conditionId, trades] of clusterBuffer.entries()) {
      // Deduplicate by wallet
      const walletMap = new Map();
      for (const tr of trades) {
        if (!tr.user) continue;
        if (!walletMap.has(tr.user)) walletMap.set(tr.user, tr);
      }
      if (walletMap.size < CLUSTER_MIN_WALLETS) {
        if (walletMap.size >= 3) {
          // Near-miss: close to threshold but not enough wallets
          clusterNearMisses = [{
            conditionId,
            marketTitle: trades[0]?.title || conditionId,
            marketSlug: trades[0]?.slug || '',
            walletCount: walletMap.size,
            newWalletPct: 0,
            totalVolume: Array.from(walletMap.values()).reduce((sum, tr) => sum + tr.size, 0),
            timeSpreadSeconds: Math.max(...trades.map(tr => tr.timestamp)) - Math.min(...trades.map(tr => tr.timestamp)),
            failReasons: [`Only ${walletMap.size} wallets (need ${CLUSTER_MIN_WALLETS})`],
            timestamp: new Date().toISOString(),
          }, ...clusterNearMisses].slice(0, 5);
        }
        continue;
      }

      const firstTradeTs = Math.min(...trades.map(tr => tr.timestamp));
      const clusterId = `${conditionId}-${firstTradeTs}`;

      if (dismissedClusterIds.has(clusterId)) continue;
      if (detectedClusters.some(c => c.id === clusterId)) continue;

      // Check newness of each wallet (same pattern as whale scanner)
      const walletNewness = await Promise.all(
        Array.from(walletMap.keys()).map(async (addr) => {
          try {
            const r = await fetch(`https://data-api.polymarket.com/positions?user=${addr}`);
            if (!r.ok) return { addr, isNew: false };
            const positions = await r.json();
            return { addr, isNew: positions.length < 3 };
          } catch {
            return { addr, isNew: false };
          }
        })
      );

      const newWalletCount = walletNewness.filter(w => w.isNew).length;
      const newWalletPct = (newWalletCount / walletMap.size) * 100;
      if (newWalletPct < CLUSTER_NEW_WALLET_MIN_PCT) {
        clusterNearMisses = [{
          conditionId,
          marketTitle: trades[0]?.title || conditionId,
          marketSlug: trades[0]?.slug || '',
          walletCount: walletMap.size,
          newWalletPct,
          totalVolume: Array.from(walletMap.values()).reduce((sum, tr) => sum + tr.size, 0),
          timeSpreadSeconds: Math.max(...trades.map(tr => tr.timestamp)) - Math.min(...trades.map(tr => tr.timestamp)),
          failReasons: [`New wallet % too low (${newWalletPct.toFixed(0)}% < ${CLUSTER_NEW_WALLET_MIN_PCT}%)`],
          timestamp: new Date().toISOString(),
        }, ...clusterNearMisses].slice(0, 5);
        continue;
      }

      const newnessMap = new Map(walletNewness.map(w => [w.addr, w.isNew]));

      // Check common funding source — first inbound transfer on each wallet via activity feed
      const fundingResults = await Promise.all(
        Array.from(walletMap.keys()).map(async (addr) => {
          try {
            const r = await fetch(`https://data-api.polymarket.com/activity?user=${addr}&limit=50`);
            if (!r.ok) return { addr, funder: null };
            const activity = await r.json();
            // Find the earliest USDC deposit — sender is the funding source
            const deposits = (Array.isArray(activity) ? activity : [])
              .filter(a => a.type === 'DEPOSIT' || a.type === 'TRANSFER_IN')
              .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            const funder = deposits.length > 0 ? (deposits[0].from || deposits[0].sender || null) : null;
            return { addr, funder };
          } catch {
            return { addr, funder: null };
          }
        })
      );

      // Count how many wallets share the same funder
      const funderCounts = new Map();
      for (const { funder } of fundingResults) {
        if (!funder) continue;
        funderCounts.set(funder, (funderCounts.get(funder) || 0) + 1);
      }
      let sharedFundingSource = null;
      let sharedFundingCount = 0;
      for (const [funder, count] of funderCounts.entries()) {
        if (count > sharedFundingCount) {
          sharedFundingCount = count;
          sharedFundingSource = funder;
        }
      }
      const fundingMap = new Map(fundingResults.map(f => [f.addr, f.funder]));

      // Fetch market data
      let marketLiquidity = 0;
      let marketVolume24hr = 0;
      let marketTitle = trades[0]?.title || '';
      let marketSlug = trades[0]?.slug || '';
      try {
        const mRes = await fetch(`https://gamma-api.polymarket.com/markets?conditionId=${conditionId}`);
        if (mRes.ok) {
          const mData = await mRes.json();
          const market = Array.isArray(mData) ? mData[0] : mData;
          if (market) {
            marketLiquidity = parseFloat(market.liquidityNum || market.liquidity || 0);
            marketVolume24hr = parseFloat(market.volume24hr || 0);
            marketTitle = market.question || marketTitle;
            marketSlug = market.slug || marketSlug;
          }
        }
      } catch {}

      const lastTradeTs = Math.max(...trades.map(tr => tr.timestamp));
      const timeSpreadSeconds = lastTradeTs - firstTradeTs;
      const totalVolume = Array.from(walletMap.values()).reduce((sum, tr) => sum + tr.size, 0);
      const walletCount = walletMap.size;
      const signalStrength = computeSignalStrength({ walletCount, newWalletPct, totalVolume, marketLiquidity, timeSpreadSeconds, sharedFundingCount });
      const isHighAlert = signalStrength >= 9 || (marketVolume24hr > 0 && (totalVolume / marketVolume24hr) > 0.10);

      const wallets = Array.from(walletMap.entries()).map(([addr, tr]) => ({
        address: addr,
        username: tr.username,
        price: tr.price,
        size: tr.size,
        timestamp: tr.timestamp,
        transactionHash: tr.transactionHash,
        isNewWallet: newnessMap.get(addr) || false,
        fundingSource: fundingMap.get(addr) || undefined,
      }));

      const cluster = {
        id: clusterId,
        conditionId,
        marketTitle,
        marketSlug,
        wallets,
        walletCount,
        newWalletCount,
        newWalletPct,
        totalVolume,
        timeSpreadSeconds,
        firstTradeTs,
        lastTradeTs,
        marketLiquidity,
        marketVolume24hr,
        signalStrength,
        isHighAlert,
        sharedFundingSource: sharedFundingSource || undefined,
        sharedFundingCount: sharedFundingCount || undefined,
        detectedAt: new Date().toISOString(),
      };

      detectedClusters = [cluster, ...detectedClusters].slice(0, 100);
      clusterStats.totalDetected++;
      if (isHighAlert) clusterStats.highAlertCount++;
      await sendClusterAlert(cluster);
    }

    clusterStats.lastScanTime = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
  } catch (err) {
    console.error('Cluster Scanner Loop Error:', err);
  }
}

setInterval(runClusterScanner, CLUSTER_INTERVAL);
runClusterScanner();

app.get('/api/clusters', (req, res) => {
  res.json({ detectedClusters, clusterNearMisses, clusterStats });
});

app.post('/api/test-cluster', async (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const sharedFunder = '0xBinanceHot000000000000000000000000000001';
  const testCluster = {
    id: `test-cluster-${now}`,
    conditionId: 'test-condition-abc123',
    marketTitle: 'Will this coordinated Sybil attack be detected? (TEST)',
    marketSlug: '',
    wallets: [
      { address: '0xaaa111', username: 'FreshWallet_A', price: 0.07, size: 45.00, timestamp: now - 15, transactionHash: 'hash1', isNewWallet: true,  fundingSource: sharedFunder },
      { address: '0xbbb222', username: 'FreshWallet_B', price: 0.07, size: 52.00, timestamp: now - 12, transactionHash: 'hash2', isNewWallet: true,  fundingSource: sharedFunder },
      { address: '0xccc333', username: 'FreshWallet_C', price: 0.08, size: 38.00, timestamp: now - 10, transactionHash: 'hash3', isNewWallet: true,  fundingSource: sharedFunder },
      { address: '0xddd444', username: 'FreshWallet_D', price: 0.07, size: 61.00, timestamp: now - 8,  transactionHash: 'hash4', isNewWallet: true,  fundingSource: '0xOtherSource0000000000000000000000000002' },
      { address: '0xeee555', username: 'OldWallet_E',   price: 0.08, size: 29.00, timestamp: now - 5,  transactionHash: 'hash5', isNewWallet: false, fundingSource: null },
      { address: '0xfff666', username: 'FreshWallet_F', price: 0.07, size: 55.00, timestamp: now - 2,  transactionHash: 'hash6', isNewWallet: true,  fundingSource: sharedFunder },
    ],
    walletCount: 6,
    newWalletCount: 5,
    newWalletPct: 83.3,
    totalVolume: 280.00,
    timeSpreadSeconds: 13,
    firstTradeTs: now - 15,
    lastTradeTs: now - 2,
    marketLiquidity: 1800,
    marketVolume24hr: 2200,
    signalStrength: 10,
    isHighAlert: true,
    sharedFundingSource: sharedFunder,
    sharedFundingCount: 4,
    detectedAt: new Date().toISOString(),
  };
  detectedClusters = [testCluster, ...detectedClusters].slice(0, 100);
  clusterStats.totalDetected++;
  clusterStats.highAlertCount++;
  await sendClusterAlert(testCluster);
  res.json({ success: true, cluster: testCluster });
});

app.post('/api/dismiss-cluster', (req, res) => {
  const { id } = req.body;
  dismissedClusterIds.add(id);
  detectedClusters = detectedClusters.filter(c => c.id !== id);
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running 24/7 on port ${PORT}`);
});
