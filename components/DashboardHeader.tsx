import React from 'react';
import { Trader, ClusterStats } from '../types';

interface DashboardHeaderProps {
  isRefreshing: boolean;
  onRefresh: () => void;
  selectedTrader?: Trader;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  currentView: 'traders' | 'scanner' | 'clusters' | 'hypo';
  isScanning?: boolean;
  onToggleScan?: () => void;
  onClearHistory?: () => void;
  onClearClusters?: () => void;
  onTestCluster?: () => void;
  scanStats?: {
    tradesChecked: number;
    lowPriceMatches: number;
    excludedMarkets: number;
    lastScanTime: string;
  };
  clusterStats?: ClusterStats;
  windowStartTime?: string;
  isHeartbeating?: boolean;
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  isRefreshing, onRefresh, selectedTrader, onAnalyze, isAnalyzing, currentView, isScanning, onToggleScan, onClearHistory, onClearClusters, onTestCluster, scanStats, clusterStats, windowStartTime, isHeartbeating
}) => {
  return (
    <header className="px-8 py-6 flex flex-col gap-4 border-b border-slate-800/50">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            {currentView === 'traders' ? (
              selectedTrader ? (
                <>
                  <img
                    src={selectedTrader.profile_image || `https://api.dicebear.com/7.x/identicon/svg?seed=${selectedTrader.address}`}
                    className="w-8 h-8 rounded-full"
                    alt=""
                  />
                  {selectedTrader.username || 'Trader Detail'}
                </>
              ) : 'Recent Activity'
            ) : currentView === 'scanner' ? (
              <>
                <div className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center text-emerald-500 relative">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  {isScanning && (
                    <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 transition-all duration-700 ${isHeartbeating ? 'scale-125 opacity-100' : 'scale-75 opacity-20'}`}></div>
                  )}
                </div>
                Whale Finder Scanner
              </>
            ) : currentView === 'clusters' ? (
              <>
                <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center text-blue-400 relative">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full bg-blue-400 transition-all duration-700 ${isHeartbeating ? 'scale-125 opacity-100' : 'scale-75 opacity-20'}`}></div>
                </div>
                Cluster Detector
              </>
            ) : (
              <>
                <div className="w-8 h-8 bg-indigo-500/20 rounded-lg flex items-center justify-center text-indigo-400">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </div>
                Hypothetical Wallet
              </>
            )}
          </h2>
          {currentView === 'scanner' && (
            <p className="text-sm text-slate-400 mt-1 ml-11">Real-time identification of strategic low-cost entries with high conviction.</p>
          )}
          {currentView === 'clusters' && (
            <p className="text-sm text-slate-400 mt-1 ml-11">Detecting coordinated Sybil clusters — 6+ wallets buying the same low-price market in 120s.</p>
          )}
          {currentView === 'hypo' && (
            <p className="text-sm text-slate-400 mt-1 ml-11">Simulated $100 positions on every whale flagged — 5 min delayed entry, auto exit rules applied.</p>
          )}
          {currentView === 'traders' && !selectedTrader && (
            <p className="text-sm text-slate-400 mt-1">Live feed of trades from all tracked Polymarket accounts.</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {currentView === 'traders' ? (
            <>
              {selectedTrader && (
                <button
                  onClick={onAnalyze}
                  disabled={isAnalyzing}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 text-white text-sm font-semibold rounded-lg transition-all shadow-lg"
                >
                  {isAnalyzing ? 'Analyzing...' : 'AI Insights'}
                </button>
              )}
              <button
                onClick={onRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold rounded-lg border border-slate-700"
              >
                {isRefreshing ? 'Updating...' : 'Refresh Feed'}
              </button>
            </>
          ) : currentView === 'scanner' ? (
            <>
              <button
                onClick={onClearHistory}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold rounded-lg border border-slate-700"
              >
                Clear History
              </button>
              <button
                onClick={onToggleScan}
                className={`flex items-center gap-2 px-4 py-2 ${isScanning ? 'bg-emerald-600' : 'bg-rose-600'} text-white text-sm font-semibold rounded-lg`}
              >
                {isScanning ? 'Monitoring Live...' : 'Resume Scanner'}
              </button>
            </>
          ) : currentView === 'clusters' ? (
            <>
              <button
                onClick={onTestCluster}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 text-sm font-semibold rounded-lg border border-indigo-500/30"
              >
                Test Alert
              </button>
              <button
                onClick={onClearClusters}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold rounded-lg border border-slate-700"
              >
                Clear All
              </button>
            </>
          ) : (
            <div className="text-xs text-slate-500 font-mono">Auto-managed · updates every 30s</div>
          )}
        </div>
      </div>

      {currentView === 'scanner' && scanStats && (
        <div className="flex items-center gap-6 text-[11px] font-mono bg-slate-800/50 rounded-lg px-4 py-2.5 border border-slate-700/50">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-bold uppercase tracking-wider">Engine Status:</span>
            <span className={`font-bold ${isScanning ? 'text-emerald-400' : 'text-rose-400'}`}>{isScanning ? 'ONLINE' : 'PAUSED'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-bold uppercase tracking-wider">Processed:</span>
            <span className="text-white font-bold">{scanStats.tradesChecked.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-bold uppercase tracking-wider">Potentials:</span>
            <span className="text-emerald-400 font-bold">{scanStats.lowPriceMatches}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-slate-500 font-bold uppercase tracking-wider">Latest Poll:</span>
            <span className="text-amber-400 font-bold">{scanStats.lastScanTime || '--:--:--'}</span>
          </div>
        </div>
      )}

      {currentView === 'clusters' && clusterStats && (
        <div className="flex items-center gap-6 text-[11px] font-mono bg-slate-800/50 rounded-lg px-4 py-2.5 border border-slate-700/50">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-bold uppercase tracking-wider">Clusters Found:</span>
            <span className="text-white font-bold">{clusterStats.totalDetected}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-bold uppercase tracking-wider">High Alerts:</span>
            <span className="text-rose-400 font-bold">{clusterStats.highAlertCount}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-slate-500 font-bold uppercase tracking-wider">Latest Poll:</span>
            <span className="text-amber-400 font-bold">{clusterStats.lastScanTime || '--:--:--'}</span>
          </div>
        </div>
      )}
    </header>
  );
};

export default DashboardHeader;
