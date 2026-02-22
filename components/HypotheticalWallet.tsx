import React from 'react';
import { HypotheticalPosition } from '../types';

interface HypotheticalWalletProps {
  positions: HypotheticalPosition[];
  onClose: (id: string) => void;
  onClearClosed: () => void;
}

function exitLabel(reason?: string) {
  switch (reason) {
    case 'stop_loss':    return { text: 'Stop Loss –35%', color: 'text-rose-400 bg-rose-500/10 border-rose-500/30' };
    case '2x_moonshot': return { text: '2× Moonshot', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
    case 'time_exit':   return { text: '24hr Exit', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
    case 'stale_exit':  return { text: 'Stale (6hr flat)', color: 'text-orange-400 bg-orange-500/10 border-orange-500/30' };
    case 'manual':      return { text: 'Manual', color: 'text-slate-400 bg-slate-700/50 border-slate-600/30' };
    default:            return { text: 'Closed', color: 'text-slate-400 bg-slate-700/50 border-slate-600/30' };
  }
}

const HypotheticalWallet: React.FC<HypotheticalWalletProps> = ({ positions, onClose, onClearClosed }) => {
  const truncAddr = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const formatTime = (ts: string) =>
    new Date(ts).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York',
    });

  const formatDate = (ts: string) =>
    new Date(ts).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', timeZone: 'America/New_York',
    });

  const openPositions   = positions.filter(p => p.status === 'open' || p.status === 'pending');
  const closedPositions = positions.filter(p => p.status === 'closed');

  const totalPnl = closedPositions.reduce((sum, p) => sum + (p.pnl || 0), 0);
  const wins     = closedPositions.filter(p => (p.pnl || 0) > 0).length;
  const hitRate  = closedPositions.length > 0 ? ((wins / closedPositions.length) * 100).toFixed(0) : '—';

  const renderRow = (pos: HypotheticalPosition) => {
    const isOpen    = pos.status === 'open';
    const isPending = pos.status === 'pending';
    const isClosed  = pos.status === 'closed';

    const currentReturn = isOpen
      ? (pos.current_price - pos.entry_price) * (pos.shares_remaining ?? pos.shares) + (pos.realized_pnl ?? 0)
      : isClosed ? (pos.pnl || 0) : 0;

    const currentReturnPct = pos.entry_price > 0
      ? ((( isClosed ? (pos.exit_price || pos.entry_price) : pos.current_price) - pos.entry_price) / pos.entry_price) * 100
      : 0;

    // peak_price_6hr is 0 if no price was recorded within the 6hr window
    const hasPeak = pos.peak_price_6hr > 0;
    const peakReturn    = hasPeak ? (pos.peak_price_6hr - pos.entry_price) * pos.shares : null;
    const peakReturnPct = hasPeak && pos.entry_price > 0 ? ((pos.peak_price_6hr - pos.entry_price) / pos.entry_price) * 100 : null;

    const polyLink = pos.market_slug
      ? `https://polymarket.com/event/${pos.market_slug}`
      : `https://polymarket.com/profile/${pos.address}`;

    const label = exitLabel(pos.exit_reason);

    return (
      <tr key={pos.id} className={`transition-colors group ${isClosed ? 'opacity-60' : 'hover:bg-slate-800/30'}`}>
        {/* User / Time */}
        <td className="px-4 py-4 whitespace-nowrap">
          <a
            href={`https://polymarket.com/profile/${pos.address}`}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-slate-200 hover:text-indigo-400 transition-colors underline decoration-slate-700 hover:decoration-indigo-400"
          >
            {pos.username || truncAddr(pos.address)}
          </a>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            {isPending ? (
              <span className="text-amber-400">Entering at {formatTime(pos.entry_time)}</span>
            ) : (
              <>{formatDate(pos.entry_time)} · {formatTime(pos.entry_time)}</>
            )}
          </div>
        </td>

        {/* Market */}
        <td className="px-4 py-4">
          <a
            href={polyLink}
            target="_blank"
            rel="noreferrer"
            className="text-slate-300 font-medium hover:text-indigo-400 transition-colors underline decoration-slate-700 hover:decoration-indigo-400 line-clamp-2 max-w-xs block"
          >
            {pos.market_title}
          </a>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono">
              {pos.outcome} · {(pos.entry_price * 100).toFixed(0)}¢ entry
            </span>
            <span className="text-[10px] text-slate-600 font-mono">
              whale @ {(pos.whale_price * 100).toFixed(0)}¢
            </span>
          </div>
        </td>

        {/* Return */}
        <td className="px-4 py-4 whitespace-nowrap">
          {isPending ? (
            <span className="text-[10px] text-amber-400 font-bold uppercase">Pending Entry</span>
          ) : (
            <div className="flex items-center gap-4">
              <div>
                <div className="text-[10px] text-slate-600 font-bold uppercase tracking-tight">Return</div>
                <div className={`text-sm font-bold ${currentReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {currentReturn >= 0 ? '+' : ''}${currentReturn.toFixed(2)}
                </div>
                <div className={`text-[10px] font-mono ${currentReturnPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {currentReturnPct >= 0 ? '+' : ''}{currentReturnPct.toFixed(1)}%
                </div>
                {isOpen && (
                  <div className="flex gap-1 mt-1">
                    <span className={`text-[8px] font-bold px-1 py-0.5 rounded border ${pos.tier1_done ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' : 'text-slate-600 bg-slate-800 border-slate-700'}`}>T1</span>
                    <span className={`text-[8px] font-bold px-1 py-0.5 rounded border ${pos.tier2_done ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' : 'text-slate-600 bg-slate-800 border-slate-700'}`}>T2</span>
                    <span className={`text-[8px] font-bold px-1 py-0.5 rounded border ${(pos.tier1_done && pos.tier2_done) ? 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30' : 'text-slate-600 bg-slate-800 border-slate-700'}`}>T3</span>
                  </div>
                )}
                {isClosed && (
                  <div className="mt-1 space-y-0.5">
                    {pos.exit_time && (
                      <div className="text-[9px] text-slate-500 font-mono">
                        Sold {formatTime(pos.exit_time)}
                      </div>
                    )}
                    {pos.exit_reason && (
                      <div className={`text-[9px] font-bold px-1.5 py-0.5 rounded border w-fit ${exitLabel(pos.exit_reason).color}`}>
                        {exitLabel(pos.exit_reason).text}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] text-slate-600 font-bold uppercase tracking-tight">Now</div>
                <div className="text-xs text-slate-300 font-mono">
                  {(( isClosed ? (pos.exit_price || pos.current_price) : pos.current_price) * 100).toFixed(0)}¢
                </div>
              </div>
            </div>
          )}
        </td>

        {/* Peak 6hr */}
        <td className="px-4 py-4 whitespace-nowrap">
          {isPending || !hasPeak ? (
            <span className="text-slate-700 text-[10px]">—</span>
          ) : (
            <div>
              <div className="text-[10px] text-slate-600 font-bold uppercase tracking-tight">6hr Peak</div>
              <div className={`text-sm font-bold ${peakReturn! >= 0 ? 'text-indigo-400' : 'text-slate-400'}`}>
                {peakReturn! >= 0 ? '+' : ''}${peakReturn!.toFixed(2)}
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                {peakReturnPct! >= 0 ? '+' : ''}{peakReturnPct!.toFixed(1)}% · {(pos.peak_price_6hr * 100).toFixed(0)}¢
              </div>
            </div>
          )}
        </td>

        {/* Status / Actions */}
        <td className="px-4 py-4 text-right">
          <div className="flex items-center justify-end gap-2">
            {isClosed ? (
              <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${label.color}`}>
                {label.text}
              </span>
            ) : isOpen ? (
              <>
                <span className="px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold">
                  Open
                </span>
                <button
                  onClick={() => onClose(pos.id)}
                  className="px-2 py-1 text-[10px] font-bold rounded bg-slate-800 hover:bg-rose-600/20 text-slate-500 hover:text-rose-400 transition-colors border border-slate-700 hover:border-rose-500/30"
                  title="Close position"
                >
                  Close
                </button>
              </>
            ) : (
              <span className="px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px] font-bold animate-pulse">
                Pending
              </span>
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="w-full">
      {/* Parameters card */}
      <div className="mb-4 bg-slate-800/40 rounded-xl border border-slate-700/50 px-5 py-4">
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Strategy Parameters</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[11px] mb-3">
          <div><span className="text-slate-500">Entry Delay</span><div className="text-white font-bold mt-0.5">5 minutes</div></div>
          <div><span className="text-slate-500">Bet Size</span><div className="text-white font-bold mt-0.5">$100 / position</div></div>
          <div><span className="text-slate-500">Stop Loss</span><div className="text-rose-400 font-bold mt-0.5">–35%</div></div>
          <div><span className="text-slate-500">Force Close</span><div className="text-amber-400 font-bold mt-0.5">24 hours</div></div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-[11px] border-t border-slate-700/40 pt-3">
          <div><span className="text-slate-500">Tier 1</span><div className="text-emerald-400 font-bold mt-0.5">+30% → sell 25%</div></div>
          <div><span className="text-slate-500">Tier 2</span><div className="text-emerald-400 font-bold mt-0.5">+75% → sell 50%</div></div>
          <div><span className="text-slate-500">Tier 3</span><div className="text-emerald-400 font-bold mt-0.5">2× → sell 25%</div></div>
        </div>
        <div className="text-[10px] text-slate-600 mt-2">Stale close: force exit if price moves less than 2% in any 6-hour window.</div>
      </div>

      {/* Stats row */}
      {closedPositions.length > 0 && (
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 bg-slate-800/50 rounded-lg border border-slate-700/50 p-4">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Realized P&L</div>
            <div className={`text-2xl font-bold mt-1 ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
            </div>
          </div>
          <div className="flex-1 bg-slate-800/50 rounded-lg border border-slate-700/50 p-4">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Hit Rate</div>
            <div className="text-2xl font-bold text-white mt-1">{hitRate}%</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{wins} / {closedPositions.length} wins</div>
          </div>
          <div className="flex-1 bg-slate-800/50 rounded-lg border border-slate-700/50 p-4">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Open Positions</div>
            <div className="text-2xl font-bold text-blue-400 mt-1">{openPositions.length}</div>
          </div>
        </div>
      )}

      {/* Main table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/30">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/50">
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px]">User / Entry Time</th>
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Market</th>
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Return</th>
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px]">6hr Peak</th>
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px] text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {positions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-2 border-slate-700 border-t-indigo-500 rounded-full animate-spin" />
                    <div className="text-slate-400 font-medium">Waiting for whale signals...</div>
                    <div className="text-xs text-slate-600">Positions are automatically opened 5 minutes after a whale is flagged.</div>
                  </div>
                </td>
              </tr>
            )}
            {/* Open / pending first */}
            {openPositions.map(renderRow)}
            {/* Closed below with separator */}
            {closedPositions.length > 0 && openPositions.length > 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-2 bg-slate-900/60">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Closed Positions</span>
                    <button
                      onClick={onClearClosed}
                      className="text-[9px] font-bold text-slate-600 hover:text-rose-400 uppercase tracking-wider transition-colors"
                    >
                      Clear All
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {closedPositions.map(renderRow)}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default HypotheticalWallet;
