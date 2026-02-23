const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

// Fetch with a timeout — prevents hung requests from stalling the server
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// Run at most `concurrency` async tasks at a time
async function pLimit(tasks, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS hypo_positions (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL
    )
  `);
  console.log('DB ready');
}

async function savePositions() {
  try {
    await db.query('DELETE FROM hypo_positions');
    if (hypoPositions.length === 0) return;
    const values = hypoPositions.map((p, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
    const params = hypoPositions.flatMap(p => [p.id, JSON.stringify(p)]);
    await db.query(`INSERT INTO hypo_positions (id, data) VALUES ${values}`, params);
  } catch (e) {
    console.error('Failed to save positions:', e.message);
  }
}

async function loadPositions() {
  try {
    const res = await db.query('SELECT data FROM hypo_positions ORDER BY data->>\'entry_time\' DESC');
    return res.rows.map(r => r.data);
  } catch (e) {
    console.error('Failed to load positions:', e.message);
    return [];
  }
}

const app = express();
const PORT = process.env.PORT || 8080;

let DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const SCAN_INTERVAL = 8000;
const TRADES_LIMIT = 200;

let flaggedWhales = [];
let recentRejects = [];
// Use a Map keyed by hash → insertion order index so we can evict the
// oldest 200 entries instead of wiping everything at once.
let seenHashes = new Map();
let seenHashesCounter = 0;
let stats = {
  tradesChecked: 0,
  lowPriceMatches: 0,
  excludedMarkets: 0,
  lastScanTime: ''
};

// ── HYPOTHETICAL WALLET ──────────────────────────────────────────────────────
let hypoPositions = [];
const HYPO_BET_SIZE = 100;                        // fixed $100 per position
const HYPO_ENTRY_DELAY_MS = 5 * 60 * 1000;        // 5 minutes after whale flagged
const HYPO_STOP_LOSS = 0.65;                       // exit if price drops to 65% of entry (–35%)
const HYPO_TIER1_TARGET = 1.30;                    // sell 25% of original at +30%
const HYPO_TIER2_TARGET = 1.75;                    // sell 50% of original at +75%
const HYPO_TIER3_TARGET = 2.0;                     // sell remaining 25% at 2x
const HYPO_FORCE_CLOSE_MS = 24 * 60 * 60 * 1000;  // force close after 24 hours
const HYPO_STALE_WINDOW_MS = 6 * 60 * 60 * 1000;  // stale check window: 6 hours
const HYPO_STALE_THRESHOLD = 0.02;                 // stale if price moves < 2% in 6hr

function makeHypoId() {
  return `hypo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Seed the 3 manual positions from the image
(function seedManualPositions() {
  const now = Date.now();
  const seed = [
    {
      address: '0xc61e2b6ff7a0d34a518f45b60954d05f34de244c',
      username: '0xC61E2B...244C',
      // Whale bought shares of "No change" market — betting rates stay unchanged = YES side
      market_title: 'No change in Bank of Japan\'s interest rates after March 2026 meeting',
      market_slug: '',
      conditionId: '',
      outcome: 'YES',
      whale_price: 0.20,
      whale_time: '2026-02-20T19:51:02.000Z',
    },
    {
      address: '0x0a59efd30de508bd0e7e197d4975f7ab49e107dd',
      username: '0x0A59eF...07dd',
      market_title: 'Will the next Prime Minister of Hungary be Klara Dobrev?',
      market_slug: '',
      conditionId: '',
      outcome: 'YES',
      whale_price: 0.01, // shown as 0c — use 1c floor so shares/price math works
      whale_time: '2026-02-20T07:02:33.000Z',
    },
    {
      address: '0xdbedc5ab35d896d3226c6ea5e1708dfc631f10f7',
      username: 'bobi13',
      market_title: 'Will Trump nominate Judy Shelton as the next Fed Chair?',
      market_slug: '',
      conditionId: '',
      outcome: 'YES',
      whale_price: 0.04,
      whale_time: '2026-02-19T21:35:26.000Z',
    },
  ];

  for (const s of seed) {
    const whaleTs = new Date(s.whale_time).getTime();
    const entryTs = whaleTs + HYPO_ENTRY_DELAY_MS;
    const entryPrice = s.whale_price > 0 ? s.whale_price : 0.01;
    const shares = HYPO_BET_SIZE / entryPrice;
    const isOpen = now >= entryTs;
    hypoPositions.push({
      id: makeHypoId(),
      address: s.address,
      username: s.username,
      market_title: s.market_title,
      market_slug: s.market_slug,
      conditionId: s.conditionId,
      outcome: s.outcome,
      entry_price: entryPrice,
      whale_price: s.whale_price,
      entry_time: new Date(entryTs).toISOString(),
      whale_time: s.whale_time,
      current_price: entryPrice,
      peak_price_6hr: 0,
      shares,
      shares_remaining: shares,
      tier1_done: false,
      tier2_done: false,
      realized_pnl: 0,
      price_history: [{ price: entryPrice, time: new Date(entryTs).toISOString() }],
      status: isOpen ? 'open' : 'pending',
      last_updated: new Date().toISOString(),
    });
  }
})();

// Enqueue a whale as a hypothetical position (called from runScanner)
function enqueueHypoPosition(whale) {
  // Don't duplicate — one position per whale id
  if (hypoPositions.some(p => p.id === `hypo-${whale.id}`)) return;
  const entryPrice = whale.buy_price > 0 ? whale.buy_price : 0.01;
  const shares = HYPO_BET_SIZE / entryPrice;
  const entryTime = new Date(new Date(whale.timestamp).getTime() + HYPO_ENTRY_DELAY_MS).toISOString();
  hypoPositions.unshift({
    id: `hypo-${whale.id}`,
    address: whale.address,
    username: whale.username || whale.address.slice(0, 10) + '...',
    market_title: whale.market_title,
    market_slug: whale.market_slug || '',
    conditionId: whale.conditionId || '',
    outcome: whale.outcome || 'YES',
    entry_price: entryPrice,
    whale_price: whale.buy_price,
    entry_time: entryTime,
    whale_time: whale.timestamp,
    current_price: entryPrice,
    peak_price_6hr: 0,
    shares,
    shares_remaining: shares,
    tier1_done: false,
    tier2_done: false,
    realized_pnl: 0,
    price_history: [{ price: entryPrice, time: entryTime }],
    status: 'pending',
    last_updated: new Date().toISOString(),
  });
  hypoPositions = hypoPositions.slice(0, 200);
  savePositions();
}

// Backfill historical 6hr peak for positions that are already past the window.
// Fetches all trades on that market from the firehose between entry and entry+6hr,
// finds the highest price traded in that window, and sets peak_price_6hr.
async function backfillPeak(pos) {
  const entryTs = new Date(pos.entry_time).getTime();
  const windowEnd = entryTs + 6 * 60 * 60 * 1000;
  const entryTsSec = Math.floor(entryTs / 1000);
  const windowEndSec = Math.floor(windowEnd / 1000);

  // First resolve conditionId if missing by checking the whale's own trades
  if (!pos.conditionId) {
    try {
      const r = await fetchWithTimeout(`https://data-api.polymarket.com/trades?user=${pos.address}&limit=100`);
      if (r.ok) {
        const trades = await r.json();
        const match = trades.find(tr =>
          (tr.title || '').toLowerCase().includes(pos.market_title.toLowerCase().slice(0, 20)) ||
          pos.market_title.toLowerCase().includes((tr.title || '').toLowerCase().slice(0, 20))
        );
        if (match) {
          if (match.conditionId) pos.conditionId = match.conditionId;
          if (match.slug) pos.market_slug = match.slug;
        }
      }
    } catch {}
  }

  if (!pos.conditionId) return; // can't backfill without conditionId

  // Fetch historical trades for this market around the entry window
  // The API supports taker/maker trades filtered by conditionId
  try {
    let highestPrice = 0;
    let offset = 0;
    const limit = 500;
    // Page through trades until we've passed the entry window start
    while (true) {
      const r = await fetchWithTimeout(
        `https://data-api.polymarket.com/trades?conditionId=${pos.conditionId}&limit=${limit}&offset=${offset}`
      );
      if (!r.ok) break;
      const trades = await r.json();
      if (!trades || trades.length === 0) break;

      for (const tr of trades) {
        const ts = tr.timestamp || 0;
        if (ts < entryTsSec) break; // trades are newest-first; stop once we're before entry
        if (ts > windowEndSec) continue; // skip trades after the 6hr window
        // Only count the outcome the whale bet on
        if ((tr.outcome || '').toUpperCase() !== pos.outcome.toUpperCase()) continue;
        const p = parseFloat(tr.price || 0);
        if (p > highestPrice) highestPrice = p;
      }

      // If the oldest trade in this page is already before entry, we're done
      const oldest = trades[trades.length - 1];
      if (!oldest || (oldest.timestamp || 0) < entryTsSec) break;
      offset += limit;
      if (offset > 5000) break; // safety cap
    }

    if (highestPrice > 0) {
      pos.peak_price_6hr = highestPrice;
      console.log(`Backfilled peak for ${pos.username} — ${pos.market_title.slice(0, 40)}: ${(highestPrice * 100).toFixed(0)}¢`);
    }
  } catch (e) {
    console.error('Backfill error:', e.message);
  }
}

async function backfillAllMissingPeaks() {
  const now = Date.now();
  for (const pos of hypoPositions) {
    if (pos.peak_price_6hr > 0) continue; // already has peak data
    const entryTs = new Date(pos.entry_time).getTime();
    const ageMs = now - entryTs;
    if (ageMs < 6 * 60 * 60 * 1000) continue; // still within window, live poller handles it
    await backfillPeak(pos);
  }
}

// Run backfill once on startup after a short delay to let seeds initialize
setTimeout(backfillAllMissingPeaks, 5000);

// Price updater — polls Polymarket for each open/pending position
async function updateHypoPositions() {
  const now = Date.now();
  for (const pos of hypoPositions) {
    if (pos.status === 'closed') continue;

    // Activate pending positions once the 5-min delay has passed
    if (pos.status === 'pending' && now >= new Date(pos.entry_time).getTime()) {
      pos.status = 'open';
    }
    if (pos.status !== 'open') continue;

    const entryTs = new Date(pos.entry_time).getTime();
    const ageMs = now - entryTs;

    // Try to fetch current price from Polymarket
    try {
      if (pos.conditionId) {
        // Primary: gamma API with conditionId
        const r = await fetchWithTimeout(`https://gamma-api.polymarket.com/markets?conditionId=${pos.conditionId}`);
        if (r.ok) {
          const data = await r.json();
          const market = Array.isArray(data) ? data[0] : data;
          if (market) {
            // outcomePrices is ["yesPrice","noPrice"]
            const prices = market.outcomePrices
              ? (typeof market.outcomePrices === 'string' ? JSON.parse(market.outcomePrices) : market.outcomePrices)
              : null;
            const rawPrice = prices
              ? parseFloat(pos.outcome === 'NO' ? prices[1] : prices[0])
              : 0;
            if (rawPrice > 0) pos.current_price = rawPrice;
            if (!pos.market_slug && market.slug) pos.market_slug = market.slug;
          }
        }
      } else {
        // Fallback: look at the whale's recent trades on this market title to infer price movement
        const r = await fetchWithTimeout(`https://data-api.polymarket.com/trades?user=${pos.address}&limit=50`);
        if (r.ok) {
          const trades = await r.json();
          // Find the most recent trade on the same market
          const match = trades.find(tr =>
            (tr.title || '').toLowerCase().includes(pos.market_title.toLowerCase().slice(0, 20)) ||
            pos.market_title.toLowerCase().includes((tr.title || '').toLowerCase().slice(0, 20))
          );
          if (match) {
            // Grab conditionId and slug for future polls
            if (match.conditionId) pos.conditionId = match.conditionId;
            if (match.slug) pos.market_slug = match.slug;
            const rawPrice = parseFloat(match.price || 0);
            if (rawPrice > 0) pos.current_price = rawPrice;
          }
        }
      }
    } catch {}

    // Update 6hr peak — only within 6 hours of entry, matching max hold time
    if (ageMs <= 6 * 60 * 60 * 1000 && pos.current_price > pos.peak_price_6hr) {
      pos.peak_price_6hr = pos.current_price;
    }

    pos.last_updated = new Date().toISOString();

    // Track price history for stale detection (keep last 24hrs of snapshots)
    if (!pos.price_history) pos.price_history = [];
    pos.price_history.push({ price: pos.current_price, time: new Date().toISOString() });
    if (pos.price_history.length > 200) pos.price_history = pos.price_history.slice(-200);

    // Ensure new fields exist on old positions loaded from DB
    if (pos.shares_remaining === undefined) pos.shares_remaining = pos.shares;
    if (pos.tier1_done === undefined) pos.tier1_done = false;
    if (pos.tier2_done === undefined) pos.tier2_done = false;
    if (pos.realized_pnl === undefined) pos.realized_pnl = 0;

    // ── Exit rules ──────────────────────────────────────────────────────────
    const ratio = pos.current_price / pos.entry_price;

    // Stop loss: –35% — full close
    if (ratio <= HYPO_STOP_LOSS) {
      closeHypoPosition(pos, pos.current_price, 'stop_loss');
      continue;
    }

    // Tier 1: sell 25% of original shares at +30%
    if (!pos.tier1_done && ratio >= HYPO_TIER1_TARGET) {
      const tier1Shares = pos.shares * 0.25;
      pos.realized_pnl += (pos.current_price - pos.entry_price) * tier1Shares;
      pos.shares_remaining -= tier1Shares;
      pos.tier1_done = true;
      console.log(`Tier 1 exit for ${pos.username} @ ${(pos.current_price * 100).toFixed(0)}¢`);
      savePositions();
    }

    // Tier 2: sell 50% of original shares at +75%
    if (!pos.tier2_done && ratio >= HYPO_TIER2_TARGET) {
      const tier2Shares = pos.shares * 0.50;
      pos.realized_pnl += (pos.current_price - pos.entry_price) * tier2Shares;
      pos.shares_remaining -= tier2Shares;
      pos.tier2_done = true;
      console.log(`Tier 2 exit for ${pos.username} @ ${(pos.current_price * 100).toFixed(0)}¢`);
      savePositions();
    }

    // Tier 3: close remaining 25% at 2x
    if (pos.tier1_done && pos.tier2_done && ratio >= HYPO_TIER3_TARGET) {
      closeHypoPosition(pos, pos.current_price, '2x_moonshot');
      continue;
    }

    // Force close after 24 hours
    if (ageMs >= HYPO_FORCE_CLOSE_MS) {
      closeHypoPosition(pos, pos.current_price, 'time_exit');
      continue;
    }

    // Stale close: price hasn't moved >2% in 6 hours
    // Only applies once the position is at least 6 hours old.
    if (pos.price_history.length >= 2 && ageMs >= HYPO_STALE_WINDOW_MS) {
      const staleWindowStart = Date.now() - HYPO_STALE_WINDOW_MS;
      // Find the newest snapshot that is at or before the 6hr window start
      const oldSnapshot = [...pos.price_history].reverse().find(h => new Date(h.time).getTime() <= staleWindowStart);
      if (oldSnapshot) {
        const drift = Math.abs(pos.current_price - oldSnapshot.price) / oldSnapshot.price;
        if (drift < HYPO_STALE_THRESHOLD) {
          closeHypoPosition(pos, pos.current_price, 'stale_exit');
          continue;
        }
      }
    }
  }
}

function closeHypoPosition(pos, exitPrice, reason) {
  // Add final realized PnL from remaining shares
  const finalPnl = (exitPrice - pos.entry_price) * (pos.shares_remaining !== undefined ? pos.shares_remaining : pos.shares);
  pos.status = 'closed';
  pos.exit_price = exitPrice;
  pos.exit_time = new Date().toISOString();
  pos.exit_reason = reason;
  pos.pnl = (pos.realized_pnl || 0) + finalPnl;
  savePositions();
}

setInterval(updateHypoPositions, 30000);
updateHypoPositions();
// ─────────────────────────────────────────────────────────────────────────────

let detectedClusters = [];
let clusterNearMisses = [];
let dismissedClusterIds = new Set();
let clusterStats = { totalDetected: 0, highAlertCount: 0, lastScanTime: '' };
const clusterBuffer = new Map(); // conditionId -> trade[]
// Same sliding-window Map approach — evicts oldest 200 when cap hit
let clusterSeenHashes = new Map();
let clusterSeenHashesCounter = 0;

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
    const res = await fetchWithTimeout(`https://data-api.polymarket.com/trades?limit=${TRADES_LIMIT}`);
    if (!res.ok) return;
    const recentTrades = await res.json();

    for (const t of recentTrades) {
      const hash = t.transactionHash || `${t.user}-${t.timestamp}`;
      if (seenHashes.has(hash)) continue;
      seenHashes.set(hash, seenHashesCounter++);
      // Evict the oldest 200 entries once we exceed 2000, never wipe all at once
      if (seenHashes.size > 2000) {
        const cutoff = seenHashesCounter - 2000;
        for (const [h, idx] of seenHashes) {
          if (idx < cutoff) seenHashes.delete(h);
          else break;
        }
      }

      const price = parseFloat(t.price || 0);
      const tradeSize = parseFloat(t.size || t.usdcSize || 0);
      const tradeUsdcSpent = price * tradeSize;
      const title = t.title || "";

      const CRYPTO_KEYWORDS = ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'solana', 'sol', 'doge', 'dogecoin', 'xrp', 'ripple', 'bnb', 'cardano', 'ada', 'altcoin', 'defi', 'nft', 'token', 'coin', 'blockchain', 'web3'];
      const isCryptoMarket = CRYPTO_KEYWORDS.some(kw => title.toLowerCase().includes(kw));

      if (isCryptoMarket) {
        stats.excludedMarkets++;
        continue;
      }

      stats.tradesChecked++;

      if (t.side === 'BUY' && price <= 0.20) {
        const userAddress = t.proxyWallet || t.user;
        if (!userAddress) continue;

        try {
          const portRes = await fetchWithTimeout(`https://data-api.polymarket.com/positions?user=${userAddress}`);
          if (!portRes.ok) continue;
          const positions = await portRes.json();

          const pnlValue = positions.reduce((sum, p) => sum + parseFloat(p.cashPnl || 0), 0);
          const maxPosValue = positions.reduce((max, p) => {
            const val = parseFloat(p.currentValue || 0);
            return val > max ? val : max;
          }, 0);

          // Flag if any single position is worth >= $2,000
          const hasLargePosition = maxPosValue >= 2000;

          if (hasLargePosition && pnlValue < 30000 && pnlValue > -30000) {
            stats.lowPriceMatches++;
            const whale = {
              id: hash,
              address: userAddress,
              username: t.name || t.pseudonym || 'Fresh Whale',
              market_title: title,
              buy_price: price,
              trade_usdc: tradeUsdcSpent,
              pos_count: positions.length,
              pnl: pnlValue,
              max_pos_value: maxPosValue,
              timestamp: new Date().toISOString(),
              conditionId: t.conditionId || '',
              market_slug: t.slug || '',
              outcome: t.outcome || 'YES',
            };
            flaggedWhales = [whale, ...flaggedWhales].slice(0, 100);
            enqueueHypoPosition(whale);
            await sendDiscordAlert(whale);
          } else {
            const failReasons = [];
            if (!hasLargePosition) failReasons.push(`Max position too small ($${maxPosValue.toFixed(0)})`);
            if (pnlValue >= 30000) failReasons.push(`PNL too high ($${pnlValue.toLocaleString()})`);
            if (pnlValue <= -30000) failReasons.push(`PNL too low ($${pnlValue.toLocaleString()})`);
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
    const res = await fetchWithTimeout(`https://data-api.polymarket.com/trades?limit=200`);
    if (!res.ok) return;
    const recentTrades = await res.json();

    const nowSec = Math.floor(Date.now() / 1000);

    for (const t of recentTrades) {
      const hash = t.transactionHash || `${t.user}-${t.timestamp}`;
      if (clusterSeenHashes.has(hash)) continue;
      clusterSeenHashes.set(hash, clusterSeenHashesCounter++);
      // Evict oldest 200 entries once we exceed 4000, never wipe all at once
      if (clusterSeenHashes.size > 4000) {
        const cutoff = clusterSeenHashesCounter - 4000;
        for (const [h, idx] of clusterSeenHashes) {
          if (idx < cutoff) clusterSeenHashes.delete(h);
          else break;
        }
      }

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

      // Run newness check and funding source check with limited concurrency (4 at a time)
      // to avoid hammering the API and exhausting server connections.
      const walletAddrs = Array.from(walletMap.keys());

      const walletNewness = await pLimit(
        walletAddrs.map(addr => async () => {
          try {
            const r = await fetchWithTimeout(`https://data-api.polymarket.com/positions?user=${addr}`);
            if (!r.ok) return { addr, isNew: false };
            const positions = await r.json();
            return { addr, isNew: positions.length < 3 };
          } catch {
            return { addr, isNew: false };
          }
        }),
        4
      );

      const fundingResults = await pLimit(
        walletAddrs.map(addr => async () => {
          try {
            const r = await fetchWithTimeout(`https://data-api.polymarket.com/activity?user=${addr}&limit=50`);
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
        }),
        4
      );

      const newWalletCount = walletNewness.filter(w => w.isNew).length;
      const newWalletPct = (newWalletCount / walletMap.size) * 100;
      const newnessMap = new Map(walletNewness.map(w => [w.addr, w.isNew]));

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

      // Apply the new-wallet % gate ONLY if the shared funder signal is weak.
      // 3+ wallets sharing a funder is definitive coordination regardless of wallet age.
      if (newWalletPct < CLUSTER_NEW_WALLET_MIN_PCT && sharedFundingCount < 3) {
        clusterNearMisses = [{
          conditionId,
          marketTitle: trades[0]?.title || conditionId,
          marketSlug: trades[0]?.slug || '',
          walletCount: walletMap.size,
          newWalletPct,
          totalVolume: Array.from(walletMap.values()).reduce((sum, tr) => sum + tr.size, 0),
          timeSpreadSeconds: Math.max(...trades.map(tr => tr.timestamp)) - Math.min(...trades.map(tr => tr.timestamp)),
          failReasons: [`New wallet % too low (${newWalletPct.toFixed(0)}% < ${CLUSTER_NEW_WALLET_MIN_PCT}%) · no shared funder`],
          timestamp: new Date().toISOString(),
        }, ...clusterNearMisses].slice(0, 5);
        continue;
      }

      // Fetch market data
      let marketLiquidity = 0;
      let marketVolume24hr = 0;
      let marketTitle = trades[0]?.title || '';
      let marketSlug = trades[0]?.slug || '';
      try {
        const mRes = await fetchWithTimeout(`https://gamma-api.polymarket.com/markets?conditionId=${conditionId}`);
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

app.get('/api/hypo-positions', (req, res) => {
  res.json({ positions: hypoPositions });
});

app.post('/api/hypo-close', (req, res) => {
  const { id } = req.body;
  const pos = hypoPositions.find(p => p.id === id);
  if (!pos || pos.status === 'closed') return res.json({ success: false });
  closeHypoPosition(pos, pos.current_price, 'manual'); // savePositions called inside
  res.json({ success: true });
});

app.post('/api/hypo-clear', (req, res) => {
  hypoPositions = hypoPositions.filter(p => p.status !== 'closed');
  savePositions();
  res.json({ success: true });
});

// ── FADE ARB SCANNER ─────────────────────────────────────────────────────────
app.get('/api/fade-scan', async (req, res) => {
  try {
    const minOutcomes = parseInt(req.query.minOutcomes || '3');
    const minLiquidity = parseFloat(req.query.minLiquidity || '1000');
    const maxBlackSwan = parseFloat(req.query.maxBlackSwan || '0.10');

    // Fetch active events with multiple markets
    const url = `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=200&order=volume24hr&ascending=false`;
    const r = await fetchWithTimeout(url, {}, 15000);
    if (!r.ok) return res.status(502).json({ error: 'Polymarket API error' });
    const events = await r.json();

    const SPORTS_KEYWORDS = [
      'nfl', 'nba', 'nhl', 'mlb', 'nascar', 'mls', 'ufc', 'pga', 'ncaa',
      'super bowl', 'world series', 'stanley cup', 'nba finals', 'march madness',
      'football', 'basketball', 'baseball', 'hockey', 'soccer', 'tennis', 'golf',
      'boxing', 'mma', 'wrestling', 'formula 1', 'f1', 'motogp', 'cricket',
      'rugby', 'afl', 'nrl', 'premier league', 'la liga', 'bundesliga', 'serie a',
      'champions league', 'world cup', 'euros', 'copa america', 'tour de france',
      'wimbledon', 'us open', 'french open', 'australian open', 'grand slam',
      'playoff', 'playoffs', 'championship', 'league', 'tournament', 'match',
      'game 1', 'game 2', 'game 3', 'game 4', 'game 5', 'game 6', 'game 7',
      'quarterback', 'pitcher', 'roster', 'draft pick', 'mvp', 'rookie',
    ];

    const isSportsEvent = (event) => {
      const text = `${event.title || ''} ${event.slug || ''} ${(event.tags || []).map(t => t.label || t.slug || '').join(' ')}`.toLowerCase();
      return SPORTS_KEYWORDS.some(kw => text.includes(kw));
    };

    const opportunities = [];

    for (const event of (Array.isArray(events) ? events : [])) {
      if (isSportsEvent(event)) continue;
      const markets = event.markets || [];
      if (markets.length < minOutcomes) continue;

      const parsed = markets.map(m => {
        let prices = m.outcomePrices;
        if (typeof prices === 'string') { try { prices = JSON.parse(prices); } catch { prices = []; } }
        const yesPrice = parseFloat(prices?.[0] || 0);
        const noPrice = parseFloat(prices?.[1] || 0);
        const liquidity = parseFloat(m.liquidityNum || m.liquidity || 0);
        return {
          name: m.groupItemTitle || m.question || m.slug || 'Unknown',
          conditionId: m.conditionId || '',
          slug: m.slug || '',
          yesPrice,
          noPrice: noPrice > 0 ? noPrice : parseFloat((1 - yesPrice).toFixed(4)),
          liquidity,
          volume24hr: parseFloat(m.volume24hr || 0),
        };
      }).filter(m => m.yesPrice > 0 && m.noPrice > 0 && m.liquidity >= minLiquidity);

      if (parsed.length < minOutcomes) continue;

      // Calculate full basket (no fades)
      const K = parsed.length;
      const cost = parsed.reduce((s, m) => s + m.noPrice, 0);
      const payout = (K - 1) * 1.0;
      const netProfit = payout - cost;
      const roi = cost > 0 ? (netProfit / cost) * 100 : 0;

      // Find best single fade (highest ROI, black swan under threshold)
      let bestFade = null;
      for (let i = 0; i < parsed.length; i++) {
        const included = parsed.filter((_, j) => j !== i);
        const fK = included.length;
        const fCost = included.reduce((s, m) => s + m.noPrice, 0);
        const fPayout = (fK - 1) * 1.0;
        const fNet = fPayout - fCost;
        const fRoi = fCost > 0 ? (fNet / fCost) * 100 : 0;
        const blackSwan = parsed[i].yesPrice;
        if (fRoi > (bestFade?.roi ?? -Infinity) && blackSwan <= maxBlackSwan) {
          bestFade = { fadedName: parsed[i].name, roi: fRoi, cost: fCost, netProfit: fNet, blackSwan };
        }
      }

      opportunities.push({
        eventId: event.id,
        eventTitle: event.title || event.slug,
        eventSlug: event.slug,
        outcomes: parsed,
        fullBasket: { K, cost, payout, netProfit, roi },
        bestFade,
      });
    }

    // Sort by best ROI (using bestFade ROI if available, else full basket)
    opportunities.sort((a, b) => {
      const aRoi = a.bestFade?.roi ?? a.fullBasket.roi;
      const bRoi = b.bestFade?.roi ?? b.fullBasket.roi;
      return bRoi - aRoi;
    });

    res.json({ opportunities: opportunities.slice(0, 50) });
  } catch (e) {
    console.error('Fade scan error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

initDb().then(async () => {
  hypoPositions = await loadPositions();
  console.log(`Loaded ${hypoPositions.length} positions from DB`);
  app.listen(PORT, () => {
    console.log(`Server running 24/7 on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to init DB, starting without persistence:', err.message);
  app.listen(PORT, () => {
    console.log(`Server running 24/7 on port ${PORT}`);
  });
});
