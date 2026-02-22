export interface Trader {
  address: string;
  username?: string;
  profile_image?: string;
  bio?: string;
  pnl?: number;
  volume?: number;
  markets_traded?: number;
  added_at: string;
}

export interface Trade {
  id: string;
  trader_address: string;
  market: string;
  market_title: string;
  market_slug: string;
  asset_id: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  trade_timestamp: string;
  transaction_hash?: string;
  username?: string;
  profile_image?: string;
}

export interface Stats {
  traders: number;
  trades: number;
}

export interface FlaggedUser {
  id: string;
  address: string;
  username?: string;
  market_title: string;
  buy_price: number;
  trade_usdc: number;
  pos_count: number;
  pnl: number;
  max_pos_value: number;
  timestamp: string;
}

export interface ClusterWallet {
  address: string;
  username: string;
  price: number;
  size: number;
  timestamp: number;        // unix seconds
  transactionHash: string;
  isNewWallet: boolean;     // lifetime trades < 10
  fundingSource?: string;   // first-ever funder address
}

export interface Cluster {
  id: string;               // `${conditionId}-${firstTradeTs}`
  conditionId: string;
  marketTitle: string;
  marketSlug: string;
  wallets: ClusterWallet[];
  walletCount: number;
  newWalletCount: number;
  newWalletPct: number;     // 0–100
  totalVolume: number;
  timeSpreadSeconds: number;
  firstTradeTs: number;
  lastTradeTs: number;
  marketLiquidity: number;
  marketVolume24hr: number;
  signalStrength: number;   // 1–10
  isHighAlert: boolean;     // cluster volume > 10% of volume24hr
  sharedFundingSource?: string;   // funder address shared by 3+ wallets
  sharedFundingCount?: number;    // how many wallets share that source
  detectedAt: string;       // ISO
}

export interface ClusterStats {
  totalDetected: number;
  highAlertCount: number;
  lastScanTime: string;
}

export interface HypotheticalPosition {
  id: string;
  address: string;
  username: string;
  market_title: string;
  market_slug: string;
  conditionId: string;
  outcome: string;               // 'YES' or 'NO'
  entry_price: number;           // price we hypothetically bought at (after 5min delay)
  whale_price: number;           // price whale actually bought at
  entry_time: string;            // ISO — when we entered (whale_time + 5min)
  whale_time: string;            // ISO — when whale was flagged
  current_price: number;
  peak_price_6hr: number;        // highest price in first 6 hours
  shares: number;                // $100 / entry_price  (fixed $100 hypothetical bet)
  shares_remaining?: number;     // shares still held after partial exits
  tier1_done?: boolean;          // 25% sold at +30%
  tier2_done?: boolean;          // 50% sold at +75%
  realized_pnl?: number;         // PnL locked in from tier exits
  price_history?: { price: number; time: string }[];
  status: 'pending' | 'open' | 'closed';
  exit_price?: number;
  exit_time?: string;
  exit_reason?: string;          // 'stop_loss' | '2x_moonshot' | 'time_exit' | 'stale_exit' | 'manual'
  pnl?: number;                  // total realized PnL when closed
  last_updated: string;
}