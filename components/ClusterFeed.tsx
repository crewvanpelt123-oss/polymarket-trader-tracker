import React, { useState } from 'react';
import { Cluster, ClusterStats } from '../types';

interface ClusterFeedProps {
  clusters: Cluster[];
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
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-bold ${color}`}>
      Signal {score}/10
    </span>
  );
}

function HighAlertBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-rose-500/60 bg-rose-500/10 text-rose-400 text-[11px] font-bold animate-pulse">
      🚨 HIGH ALERT
    </span>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 min-w-[72px]">
      <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
      <span className="text-[13px] font-bold text-white mt-0.5">{value}</span>
    </div>
  );
}

function ClusterCard({
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
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

  const polyLink = cluster.marketSlug
    ? `https://polymarket.com/event/${cluster.marketSlug}`
    : 'https://polymarket.com';

  return (
    <div className={`rounded-xl border ${cluster.isHighAlert ? 'border-rose-500/30 bg-rose-500/5' : 'border-slate-700/50 bg-slate-800/30'} p-4 mb-3`}>
      {/* Header row */}
      <div className="flex items-start gap-3 mb-3">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
          <SignalBadge score={cluster.signalStrength} />
          {cluster.isHighAlert && <HighAlertBadge />}
          <span className="text-[11px] text-slate-500 font-mono">{detectedTime}</span>
          <a
            href={polyLink}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-slate-200 hover:text-indigo-300 underline decoration-slate-600 hover:decoration-indigo-400 truncate max-w-xs transition-colors"
          >
            {cluster.marketTitle || cluster.conditionId}
          </a>
        </div>
        <button
          onClick={() => onDismiss(cluster.id)}
          className="flex-shrink-0 p-1.5 text-slate-600 hover:text-slate-300 hover:bg-slate-700 rounded-lg transition-all"
          title="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Stat pills row */}
      <div className="flex flex-wrap gap-2 mb-3">
        <StatPill label="Wallets" value={`${cluster.walletCount}`} />
        <StatPill label="New Wallets" value={`${cluster.newWalletPct.toFixed(0)}%`} />
        <StatPill label="Time Spread" value={timeStr} />
        <StatPill label="Cluster Vol" value={`$${cluster.totalVolume.toFixed(0)}`} />
        <StatPill label="vs 24h" value={vol24hrPct} />
      </div>

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="text-[11px] font-bold text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {expanded ? 'Hide' : 'Show'} {cluster.wallets.length} Wallets
      </button>

      {/* Wallet table */}
      {expanded && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-slate-500 uppercase text-[9px] tracking-wider border-b border-slate-700/50">
                <th className="text-left pb-2 pr-3">Wallet</th>
                <th className="text-right pb-2 pr-3">Entry Price</th>
                <th className="text-right pb-2 pr-3">Size</th>
                <th className="text-left pb-2 pr-3">Type</th>
                <th className="text-left pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {cluster.wallets.map((w) => (
                <tr key={w.address} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="py-1.5 pr-3">
                    <a
                      href={`https://polymarket.com/profile/${w.address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 underline decoration-indigo-800 hover:decoration-indigo-400 font-mono transition-colors"
                    >
                      {w.username || `${w.address.slice(0, 6)}…${w.address.slice(-4)}`}
                    </a>
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono text-amber-300">
                    {(w.price * 100).toFixed(0)}¢
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono text-slate-200">
                    ${w.size.toFixed(2)}
                  </td>
                  <td className="py-1.5 pr-3">
                    {w.isNewWallet ? (
                      <span className="px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[9px] font-bold uppercase">
                        New Wallet
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-slate-700/50 border border-slate-600/30 text-slate-400 text-[9px] font-bold uppercase">
                        Established
                      </span>
                    )}
                  </td>
                  <td className="py-1.5">
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const ClusterFeed: React.FC<ClusterFeedProps> = ({
  clusters,
  clusterStats,
  onDismiss,
  onTrack,
  isAlreadyTracked,
}) => {
  if (clusters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-slate-500">
        <div className="w-10 h-10 border-2 border-slate-600 border-t-emerald-500 rounded-full animate-spin" />
        <p className="text-sm font-medium">Watching for 6+ wallets entering the same low-price market within 2 minutes…</p>
        <p className="text-[11px] text-slate-600">Price range: 2¢ – 20¢ · Window: 120s · Min wallets: 6 · New wallet threshold: 40%</p>
      </div>
    );
  }

  return (
    <div className="pt-4">
      {clusters.map(cluster => (
        <ClusterCard
          key={cluster.id}
          cluster={cluster}
          onDismiss={onDismiss}
          onTrack={onTrack}
          isAlreadyTracked={isAlreadyTracked}
        />
      ))}
    </div>
  );
};

export default ClusterFeed;
