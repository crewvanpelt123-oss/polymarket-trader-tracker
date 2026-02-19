import React, { useState } from 'react';
import { Cluster, ClusterStats } from '../types';

interface ClusterNearMiss {
  conditionId: string;
  marketTitle: string;
  marketSlug: string;
  walletCount: number;
  newWalletPct: number;
  totalVolume: number;
  timeSpreadSeconds: number;
  failReasons: string[];
  timestamp: string;
}

interface ClusterFeedProps {
  clusters: Cluster[];
  clusterNearMisses?: ClusterNearMiss[];
  clusterStats: ClusterStats;
  onDismiss: (id: string) => void;
  onTrack: (address: string, username?: string) => void;
  isAlreadyTracked: (address: string) => boolean;
}

function SignalBadge({ score }: { score: number }) {
  const color =
    score >= 7 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' :
    score >= 4 ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' :
    'bg-rose-500/20 text-rose-400 border-rose-500/40';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold ${color}`}>
      Signal {score}/10
    </span>
  );
}

function HighAlertBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-rose-500/60 bg-rose-500/10 text-rose-400 text-[10px] font-bold animate-pulse">
      🚨 HIGH ALERT
    </span>
  );
}

function SharedFunderBadge({ count, address }: { count: number; address: string }) {
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-orange-500/60 bg-orange-500/10 text-orange-400 text-[10px] font-bold">
      ⚠️ Shared Funder ({count}) · {short}
    </span>
  );
}

function ClusterRow({
  cluster,
  onDismiss,
  onTrack,
  isAlreadyTracked,
}: {
  cluster: Cluster;
  onDismiss: (id: string) => void;
  onTrack: (address: string, username?: string) => void;
  isAlreadyTracked: (address: string) => boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const vol24hrPct =
    cluster.marketVolume24hr > 0
      ? ((cluster.totalVolume / cluster.marketVolume24hr) * 100).toFixed(1) + '%'
      : 'N/A';

  const timeStr =
    cluster.timeSpreadSeconds < 60
      ? `${cluster.timeSpreadSeconds}s`
      : `${Math.floor(cluster.timeSpreadSeconds / 60)}m ${cluster.timeSpreadSeconds % 60}s`;

  const detectedTime = new Date(cluster.detectedAt).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York',
  });

  const polyLink = cluster.marketSlug
    ? `https://polymarket.com/event/${cluster.marketSlug}`
    : 'https://polymarket.com';

  const rowBg = cluster.isHighAlert
    ? 'hover:bg-rose-500/5 border-l-2 border-l-rose-500/50'
    : 'hover:bg-slate-800/30';

  return (
    <>
      <tr className={`transition-colors group ${rowBg}`}>
        {/* Market / Time */}
        <td className="px-4 py-4">
          <a
            href={polyLink}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-slate-200 hover:text-indigo-400 transition-colors underline decoration-slate-700 hover:decoration-indigo-400 line-clamp-2 max-w-xs block"
          >
            {cluster.marketTitle || cluster.conditionId}
          </a>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">{detectedTime}</div>
        </td>

        {/* Cluster Stats */}
        <td className="px-4 py-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono font-bold">
              {cluster.walletCount} wallets
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 font-mono">
              {timeStr} spread
            </span>
          </div>
          <div className="text-xs text-slate-400 mt-1 font-mono">
            ${cluster.totalVolume.toFixed(0)} vol · {vol24hrPct} of 24h
          </div>
        </td>

        {/* Wallet Breakdown */}
        <td className="px-4 py-4 whitespace-nowrap">
          <div className="flex items-center gap-4">
            <div>
              <div className="text-[10px] text-slate-600 font-bold uppercase tracking-tight">New Wallets</div>
              <div className={`text-xs font-bold ${cluster.newWalletPct >= 60 ? 'text-rose-400' : 'text-amber-400'}`}>
                {cluster.newWalletPct.toFixed(0)}%
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-600 font-bold uppercase tracking-tight">Liquidity</div>
              <div className="text-xs text-indigo-400 font-bold">
                ${cluster.marketLiquidity > 0 ? cluster.marketLiquidity.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
              </div>
            </div>
          </div>
        </td>

        {/* Signal */}
        <td className="px-4 py-4">
          <div className="flex flex-wrap gap-1">
            <SignalBadge score={cluster.signalStrength} />
            {cluster.isHighAlert && <HighAlertBadge />}
            {cluster.sharedFundingSource && cluster.sharedFundingCount && (
              <SharedFunderBadge count={cluster.sharedFundingCount} address={cluster.sharedFundingSource} />
            )}
          </div>
        </td>

        {/* Actions */}
        <td className="px-4 py-4 text-right">
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setExpanded(e => !e)}
              className="px-3 py-1 text-[10px] font-bold rounded bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 border border-indigo-500/30 transition-all"
            >
              {expanded ? 'Hide' : `${cluster.wallets.length} Wallets`}
            </button>
            <button
              onClick={() => onDismiss(cluster.id)}
              className="px-2 py-1 text-[10px] font-bold rounded bg-slate-800 hover:bg-rose-600/20 text-slate-500 hover:text-rose-400 transition-colors border border-slate-700 hover:border-rose-500/30"
              title="Dismiss"
            >
              &times;
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded wallet table */}
      {expanded && (
        <tr>
          <td colSpan={5} className="px-4 pb-4 bg-slate-900/40">
            <div className="overflow-x-auto rounded-lg border border-slate-700/40">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-500 uppercase text-[9px] tracking-wider border-b border-slate-700/50 bg-slate-800/40">
                    <th className="text-left px-3 py-2">Wallet</th>
                    <th className="text-right px-3 py-2">Entry</th>
                    <th className="text-right px-3 py-2">Size</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-left px-3 py-2">Funder</th>
                    <th className="text-left px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {cluster.wallets.map((w) => {
                    const isSharedFunder = !!cluster.sharedFundingSource && w.fundingSource === cluster.sharedFundingSource;
                    return (
                      <tr key={w.address} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                        <td className="px-3 py-1.5">
                          <a
                            href={`https://polymarket.com/profile/${w.address}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-400 hover:text-indigo-300 underline decoration-indigo-800 hover:decoration-indigo-400 font-mono transition-colors"
                          >
                            {w.username || `${w.address.slice(0, 6)}…${w.address.slice(-4)}`}
                          </a>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-amber-300">
                          {(w.price * 100).toFixed(0)}¢
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-200">
                          ${w.size.toFixed(2)}
                        </td>
                        <td className="px-3 py-1.5">
                          {w.isNewWallet ? (
                            <span className="px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[9px] font-bold uppercase">New</span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-slate-700/50 border border-slate-600/30 text-slate-400 text-[9px] font-bold uppercase">Est.</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {w.fundingSource ? (
                            <span className={`font-mono text-[10px] ${isSharedFunder ? 'text-orange-400 font-bold' : 'text-slate-500'}`}>
                              {isSharedFunder && '⚠️ '}{w.fundingSource.slice(0, 6)}…{w.fundingSource.slice(-4)}
                            </span>
                          ) : (
                            <span className="text-slate-700 text-[10px]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <button
                            onClick={() => onTrack(w.address, w.username)}
                            disabled={isAlreadyTracked(w.address)}
                            className={`px-2 py-1 rounded text-[9px] font-bold uppercase border transition-all ${
                              isAlreadyTracked(w.address)
                                ? 'bg-slate-800/50 text-slate-600 border-slate-700/30 cursor-default'
                                : 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30 hover:bg-indigo-600/40'
                            }`}
                          >
                            {isAlreadyTracked(w.address) ? 'Tracked' : 'Track'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const ClusterFeed: React.FC<ClusterFeedProps> = ({
  clusters,
  clusterNearMisses = [],
  clusterStats,
  onDismiss,
  onTrack,
  isAlreadyTracked,
}) => {
  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' });
  };

  return (
    <div className="w-full">
      {/* Main table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/30">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/50">
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Market / Time</th>
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Cluster Stats</th>
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Wallet Breakdown</th>
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Signal</th>
              <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-wider text-[10px] text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {clusters.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
                    <div>
                      <div className="text-lg font-bold text-slate-300">Watching for 6+ wallets entering the same low-price market within 2 minutes...</div>
                      <div className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                        Price range: 2¢ – 20¢ · Window: 120s · Min wallets: 6 · New wallet threshold: 40%
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            )}
            {clusters.map(cluster => (
              <ClusterRow
                key={cluster.id}
                cluster={cluster}
                onDismiss={onDismiss}
                onTrack={onTrack}
                isAlreadyTracked={isAlreadyTracked}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Stats cards */}
      {clusterStats && (
        <div className="flex items-center gap-4 mt-4">
          <div className="flex-1 bg-slate-800/50 rounded-lg border border-slate-700/50 p-4">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Total Detected</div>
            <div className="text-xs text-slate-400 mt-0.5">{clusterStats.lastScanTime || '--:--:--'}</div>
            <div className="text-2xl font-bold text-white mt-1">{clusterStats.totalDetected.toLocaleString()}</div>
          </div>
          <div className="flex-1 bg-slate-800/50 rounded-lg border border-slate-700/50 p-4">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Active Clusters</div>
            <div className="text-2xl font-bold text-blue-400 mt-2">{clusters.length}</div>
          </div>
          <div className="flex-1 bg-slate-800/50 rounded-lg border border-slate-700/50 p-4">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">High Alerts</div>
            <div className="text-2xl font-bold text-rose-400 mt-2">{clusterStats.highAlertCount}</div>
          </div>
        </div>
      )}

      {/* Near-misses */}
      {clusterNearMisses.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Recent Near-Misses</h3>
          <div className="space-y-2">
            {clusterNearMisses.map((miss, i) => {
              const polyLink = miss.marketSlug
                ? `https://polymarket.com/event/${miss.marketSlug}`
                : 'https://polymarket.com';
              const timeStr =
                miss.timeSpreadSeconds < 60
                  ? `${miss.timeSpreadSeconds}s`
                  : `${Math.floor(miss.timeSpreadSeconds / 60)}m ${miss.timeSpreadSeconds % 60}s`;
              return (
                <div key={i} className="bg-slate-800/30 rounded-lg border border-slate-800 px-4 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <a
                        href={polyLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-semibold text-slate-300 truncate hover:text-indigo-400 transition-colors underline decoration-slate-700 hover:decoration-indigo-400"
                      >
                        {miss.marketTitle || miss.conditionId}
                      </a>
                      <span className="text-[10px] text-slate-600 font-mono shrink-0">{formatTime(miss.timestamp)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] shrink-0">
                    <div className="text-center">
                      <div className="text-slate-600 font-bold uppercase">Wallets</div>
                      <div className="text-slate-400">{miss.walletCount}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-slate-600 font-bold uppercase">New %</div>
                      <div className="text-slate-400">{miss.newWalletPct.toFixed(0)}%</div>
                    </div>
                    <div className="text-center">
                      <div className="text-slate-600 font-bold uppercase">Vol</div>
                      <div className="text-indigo-400">${miss.totalVolume.toFixed(0)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-slate-600 font-bold uppercase">Spread</div>
                      <div className="text-slate-400">{timeStr}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 shrink-0 max-w-[200px]">
                    {miss.failReasons.map((reason: string, j: number) => (
                      <span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 font-medium">
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ClusterFeed;
