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
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' });
  };

  const getFlagReason = (user: FlaggedUser) => {
    const reasons: string[] = [];
    if (user.buy_price <= 0.10) reasons.push('Very low entry');
    else if (user.buy_price <= 0.20) reasons.push('Low entry price');
    if (user.pos_count < 3) reasons.push('Highly concentrated');
    else if (user.pos_count < 6) reasons.push('Concentrated');
    if (user.max_pos_value > 5000) reasons.push('High conviction');
    else if (user.max_pos_value > 2000) reasons.push('Strong conviction');
    return reasons.length > 0 ? reasons : ['Whale signal'];
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
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Flag Reason</th>
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px] text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {flaggedUsers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                      <div className="w-12 h-12 border-4 border-slate-700 border-t-emerald-500 rounded-full animate-spin"></div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-slate-300">Scanning Firehose...</div>
                      <div className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                        Currently processing 100 recent trades per poll. Stats reset every 60 seconds to show current market velocity.
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            )}
            {flaggedUsers.map((user) => {
              const tracked = isAlreadyTracked?.(user.address);
              const reasons = getFlagReason(user);
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
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-1">
                      {reasons.map((reason, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium">
                          {reason}
                        </span>
                      ))}
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

      {scanStats && (
        <div className="flex items-center gap-4 mt-4">
          <div className="flex-1 bg-slate-800/50 rounded-lg border border-slate-700/50 p-4">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Processed Since</div>
            <div className="text-xs text-slate-400 mt-0.5">{scanStats.lastScanTime || windowStartTime || '--:--:-- PM'}</div>
            <div className="text-2xl font-bold text-white mt-1">{scanStats.tradesChecked.toLocaleString()}</div>
          </div>
          <div className="flex-1 bg-slate-800/50 rounded-lg border border-slate-700/50 p-4">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Potentials</div>
            <div className="text-2xl font-bold text-emerald-400 mt-2">{flaggedUsers.length}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScannerFeed;
