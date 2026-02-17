import React from 'react';
import { FlaggedUser } from '../types';

interface ScannerFeedProps {
  flaggedUsers: FlaggedUser[];
  scanStats?: {
    tradesChecked: number;
    lowPriceMatches: number;
    excludedMarkets: number;
    lastScanTime: string;
  };
  windowStartTime?: string;
  onTrack?: (address: string, username?: string) => void;
  isAlreadyTracked?: (address: string) => boolean;
}

const ScannerFeed: React.FC<ScannerFeedProps> = ({ 
  flaggedUsers, scanStats, windowStartTime, onTrack, isAlreadyTracked 
}) => {
  const truncAddr = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="w-full">
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/30">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/50">
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px]">User / Time</th>
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Market Activity</th>
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Portfolio Stats</th>
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px] text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {flaggedUsers.map((user) => {
              const tracked = isAlreadyTracked?.(user.address);
              return (
                <tr key={user.id} className="hover:bg-slate-800/30 transition-colors group">
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="font-semibold text-slate-200">{user.username || truncAddr(user.address)}</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">{formatTime(user.timestamp)}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-slate-300 font-medium line-clamp-1 max-w-xs">{user.market_title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono">{(user.buy_price * 100).toFixed(0)}c BUY</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="text-[10px] text-slate-600 font-bold uppercase tracking-tight">PNL</div>
                        <div className={`text-xs ${user.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          ${user.pnl.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-600 font-bold uppercase tracking-tight">Max Val</div>
                        <div className="text-xs text-indigo-400 font-bold">${user.max_pos_value.toLocaleString()}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <button 
                      onClick={() => onTrack?.(user.address, user.username)}
                      disabled={tracked}
                      className={`px-3 py-1 text-[10px] font-bold rounded ${tracked ? 'bg-slate-700 text-slate-400' : 'bg-indigo-600 text-white'}`}
                    >
                      {tracked ? 'Tracked' : 'Track Trader'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ScannerFeed;