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
  pos_count: number;
  pnl: number;
  max_pos_value: number;
  timestamp: string;
}