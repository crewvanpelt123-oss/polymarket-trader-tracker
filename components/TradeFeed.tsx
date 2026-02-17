import React from 'react';
import { Trade } from '../types';

interface TradeFeedProps {
  trades: Trade[];
}

const TradeFeed: React.FC<TradeFeedProps> = ({ trades }) => {
  const truncAddr = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-3">
      {trades.map((t) => {
        const isBuy = t.side === 'BUY';
        return (
          <div key={t.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors group">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <img 
                  src={t.profile_image || `https://api.dicebear.com/7.x/identicon/svg?seed=${t.trader_address}`}
                  className="w-10 h-10 rounded-lg border border-slate-700 bg-slate-800"
                  alt=""
                />
                <div>
                  <div className="font-semibold text-slate-200 group-hover:text-white transition-colors">
                    {t.username || truncAddr(t.trader_address)}
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-1">
                    {formatTime(t.trade_timestamp)}
                    <span className="text-slate-700">•</span>
                    {t.transaction_hash && (
                      <a 
                        href={`https://polygonscan.com/tx/${t.transaction_hash}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="hover:text-indigo-400 hover:underline inline-flex items-center gap-0.5"
                      >
                        View Tx
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <div className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase ${
                isBuy ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
              }`}>
                {t.side}
              </div>
            </div>

            <div className="mb-4">
              <h4 className="text-sm font-medium text-slate-300 leading-snug line-clamp-2">
                {t.market_title}
              </h4>
            </div>

            <div className="grid grid-cols-3 gap-4 py-3 border-t border-slate-800/50">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-600 font-bold mb-1">Price</div>
                <div className="text-sm font-mono text-slate-300">{(t.price * 100).toFixed(1)}&cent;</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-600 font-bold mb-1">Size</div>
                <div className="text-sm font-mono text-slate-300">${t.size.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-600 font-bold mb-1">Total Value</div>
                <div className="text-sm font-mono text-slate-300">${(t.size * t.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default TradeFeed;