import React, { useState } from 'react';
import { Trader, Stats } from '../types';

interface SidebarProps {
  traders: Trader[];
  onAdd: (address: string) => void;
  onRemove: (address: string) => void;
  selectedTrader: string | null;
  onSelect: (address: string | null) => void;
  stats: Stats;
  currentView: 'traders' | 'scanner';
  onViewChange: (view: 'traders' | 'scanner') => void;
  onExport?: () => void;
  onImport?: () => void;
  settings: {
    audioAlerts: boolean;
    browserNotifications: boolean;
    webhookUrl: string;
  };
  onSettingsChange: (settings: any) => void;
  onTestNotification: () => void;
  testStatus?: 'idle' | 'loading' | 'success' | 'error';
  hasGlobalWebhook?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  traders, onAdd, onRemove, selectedTrader, onSelect, stats, currentView, onViewChange, onExport, onImport,
  settings, onSettingsChange, onTestNotification, testStatus = 'idle', hasGlobalWebhook
}) => {
  const [input, setInput] = useState('');

  const truncAddr = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <aside className="w-80 flex-shrink-0 bg-slate-950 border-r border-slate-800 flex flex-col h-full z-10">
      <div className="p-6 flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-emerald-600 rounded-lg flex items-center justify-center text-white font-bold shadow-lg shadow-emerald-500/20">C</div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Crew's Traders</h1>
            <p className="text-xs text-slate-500 uppercase tracking-widest text-[9px]">Polymarket Suite</p>
          </div>
        </div>

        <div className="flex p-1 bg-slate-900 rounded-xl border border-slate-800 mb-8">
          <button onClick={() => onViewChange('traders')} className={`flex-1 py-2 text-xs font-bold rounded-lg ${currentView === 'traders' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500'}`}>Monitor</button>
          <button onClick={() => onViewChange('scanner')} className={`flex-1 py-2 text-xs font-bold rounded-lg ${currentView === 'scanner' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500'}`}>Scanner</button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
          {currentView === 'traders' ? (
            <>
              <form onSubmit={(e) => { e.preventDefault(); if(input) onAdd(input); setInput(''); }} className="mb-6">
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-2">Track New Address</label>
                <div className="flex gap-2">
                  <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="0x..." className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-200" />
                  <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-3 py-2 text-sm font-medium">Add</button>
                </div>
              </form>

              <nav className="flex flex-col gap-1">
                <button onClick={() => onSelect(null)} className={`w-full text-left px-3 py-2.5 rounded-xl text-sm flex items-center gap-3 ${selectedTrader === null ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20' : 'text-slate-400 hover:bg-slate-900'}`}>
                   <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                   All Trades Feed
                </button>
                <div className="mt-4 mb-2 px-3 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-600 uppercase">Tracked Profiles</span>
                </div>
                {traders.map((t) => (
                  <div key={t.address} className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm cursor-pointer border ${selectedTrader === t.address ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/20' : 'text-slate-400 border-transparent hover:bg-slate-900'}`} onClick={() => onSelect(t.address)}>
                    <img src={t.profile_image || `https://api.dicebear.com/7.x/identicon/svg?seed=${t.address}`} className="w-8 h-8 rounded-full bg-slate-800" alt="" />
                    <a href={`https://polymarket.com/profile/${t.address}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="flex-1 min-w-0 truncate font-medium hover:text-indigo-400 hover:underline transition-colors">{t.username || truncAddr(t.address)}</a>
                    <button onClick={(e) => { e.stopPropagation(); onRemove(t.address); }} className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                  </div>
                ))}
              </nav>
            </>
          ) : (
             <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 mb-6">
                <h3 className="text-xs font-bold text-emerald-500 mb-2 uppercase">Scanner Logic</h3>
                <ul className="text-[10px] text-slate-400 space-y-2">
                  <li className="flex justify-between"><span>• Price Range:</span> <span className="text-white">1¢ - 20¢</span></li>
                  <li className="flex justify-between"><span>• Conviction:</span> <span className="text-white">&gt;$2,000</span></li>
                  <li className="flex justify-between"><span>• Diversity:</span> <span className="text-white">&lt;5 Markets</span></li>
                </ul>
             </div>
          )}

          <div className="border-t border-slate-800 pt-6 mt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Phone Alerts (Discord)</h3>
              {hasGlobalWebhook && (
                <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 text-[8px] font-bold border border-indigo-500/20 uppercase tracking-tighter">System Set</span>
              )}
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Audio Ping</span>
                <button 
                  onClick={() => onSettingsChange({...settings, audioAlerts: !settings.audioAlerts})}
                  className={`w-8 h-4 rounded-full transition-all relative ${settings.audioAlerts ? 'bg-emerald-600' : 'bg-slate-800'}`}
                >
                  <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${settings.audioAlerts ? 'left-4.5' : 'left-0.5'}`}></div>
                </button>
              </div>
              <div>
                <label className="block text-[9px] font-bold text-slate-600 uppercase mb-1.5">Webhook URL</label>
                <input 
                  type="text" 
                  value={settings.webhookUrl}
                  onChange={(e) => onSettingsChange({...settings, webhookUrl: e.target.value})}
                  placeholder={hasGlobalWebhook ? "Using master link..." : "https://discord.com/api/webhooks/..."}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-200 placeholder:text-slate-600"
                />
              </div>
              <button 
                onClick={onTestNotification} 
                disabled={testStatus === 'loading'}
                className={`w-full py-2 text-[10px] font-bold rounded border transition-all flex items-center justify-center gap-2 ${
                  testStatus === 'loading' ? 'bg-slate-800 text-slate-500 border-slate-700' :
                  testStatus === 'success' ? 'bg-emerald-600/20 text-emerald-500 border-emerald-500/40' :
                  testStatus === 'error' ? 'bg-rose-600/20 text-rose-500 border-rose-500/40' :
                  'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
              >
                {testStatus === 'loading' ? 'Sending...' : 
                 testStatus === 'success' ? 'Success! Check Discord' : 
                 testStatus === 'error' ? 'Failed - Check URL' : 
                 'Send Test Notification'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 border-t border-slate-800 bg-slate-950/50">
        <div className="flex items-center justify-between text-[10px] text-slate-600 uppercase font-bold">
          <span>{stats.traders} Tracked</span>
          <span>{stats.trades} Trades</span>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;