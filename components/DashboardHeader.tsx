import React from 'react';
import { Trader } from '../types';

interface DashboardHeaderProps {
  isRefreshing: boolean;
  onRefresh: () => void;
  selectedTrader?: Trader;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  currentView: 'traders' | 'scanner';
  isScanning?: boolean;
  onToggleScan?: () => void;
  scanStats?: {
    tradesChecked: number;
    lowPriceMatches: number;
    excludedMarkets: number;
    lastScanTime: string;
  };
  windowStartTime?: string;
  isHeartbeating?: boolean;
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({ 
  isRefreshing, onRefresh, selectedTrader, onAnalyze, isAnalyzing, currentView, isScanning, onToggleScan, scanStats, windowStartTime, isHeartbeating 
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
            ) : (
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
            )}
          </h2>
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
          ) : (
            <button 
              onClick={onToggleScan}
              className={`flex items-center gap-2 px-4 py-2 ${isScanning ? 'bg-emerald-600' : 'bg-rose-600'} text-white text-sm font-semibold rounded-lg`}
            >
              {isScanning ? 'Monitoring Live...' : 'Resume Scanner'}
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;