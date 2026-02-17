import React, { useState, useEffect, useRef } from 'react';
import { Trader, Trade, FlaggedUser } from './types';
import Sidebar from './components/Sidebar';
import TradeFeed from './components/TradeFeed';
import ScannerFeed from './components/ScannerFeed';
import DashboardHeader from './components/DashboardHeader';
import { analyzeTraderStrategy } from './services/gemini';

// --- CONFIGURATION ---
const GLOBAL_WEBHOOK_URL = ""; 
// ---------------------

const STORAGE_KEY = 'poly_tracker_traders';
const TRADES_STORAGE_KEY = 'poly_tracker_trades_cache';
const SETTINGS_STORAGE_KEY = 'poly_tracker_settings';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'traders' | 'scanner'>('traders');
  const [traders, setTraders] = useState<Trader[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [flaggedUsers, setFlaggedUsers] = useState<FlaggedUser[]>([]);
  const [selectedTrader, setSelectedTrader] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isScanning, setIsScanning] = useState(true);
  const [isHeartbeating, setIsHeartbeating] = useState(false);
  const [recentRejects, setRecentRejects] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [settings, setSettings] = useState({
    audioAlerts: true,
    browserNotifications: false,
    webhookUrl: GLOBAL_WEBHOOK_URL
  });

  const [scanStats, setScanStats] = useState({
    tradesChecked: 0,
    lowPriceMatches: 0,
    excludedMarkets: 0,
    lastScanTime: ''
  });

  // FETCH WHALES FROM 24/7 SERVER
  useEffect(() => {
    const syncWithServer = async () => {
      try {
        const res = await fetch('/api/whales');
        if (res.ok) {
          const data = await res.json();
          setFlaggedUsers(data.flaggedWhales);
          setRecentRejects(data.recentRejects || []);
          setScanStats(data.stats);
          setIsHeartbeating(true);
          setTimeout(() => setIsHeartbeating(false), 800);
        }
      } catch (e) {
        console.warn("Could not connect to backend scanner API");
      }
    };

    const interval = setInterval(syncWithServer, 5000);
    syncWithServer();
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const savedTraders = localStorage.getItem(STORAGE_KEY);
    if (savedTraders) setTraders(JSON.parse(savedTraders));
    const savedTrades = localStorage.getItem(TRADES_STORAGE_KEY);
    if (savedTrades) setTrades(JSON.parse(savedTrades));
    const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (savedSettings) setSettings(JSON.parse(savedSettings));
  }, []);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(traders)); }, [traders]);
  useEffect(() => { localStorage.setItem(TRADES_STORAGE_KEY, JSON.stringify(trades)); }, [trades]);
  useEffect(() => { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)); }, [settings]);

  const addTrader = (address: string, optionalUsername?: string) => {
    if (traders.some(t => t.address.toLowerCase() === address.toLowerCase())) return;
    const newTrader: Trader = { address, username: optionalUsername || '', added_at: new Date().toISOString(), pnl: 0, volume: 0, markets_traded: 0 };
    setTraders([newTrader, ...traders]);
    refreshData([newTrader, ...traders]);
    setCurrentView('traders');
    setSelectedTrader(address);
  };

  const removeTrader = (address: string) => {
    setTraders(traders.filter(t => t.address !== address));
    setTrades(trades.filter(t => t.trader_address !== address));
    if (selectedTrader === address) setSelectedTrader(null);
  };

  const refreshData = async (currentTraders = traders) => {
    setIsRefreshing(true);
    let allNewTrades: Trade[] = [];
    const updatedTraders = [...currentTraders];
    for (const trader of updatedTraders) {
      try {
        const response = await fetch(`https://data-api.polymarket.com/trades?user=${trader.address}&limit=20`);
        if (!response.ok) continue;
        const data = await response.json();
        const traderTrades = data.map((t: any) => ({
          id: t.transactionHash || `${trader.address}-${t.timestamp}`,
          trader_address: trader.address,
          market: t.conditionId,
          market_title: t.title,
          market_slug: t.slug,
          asset_id: t.asset,
          outcome: t.outcome,
          side: t.side,
          size: parseFloat(t.size || 0),
          price: parseFloat(t.price || 0),
          trade_timestamp: new Date((t.timestamp || 0) * 1000).toISOString(),
          transaction_hash: t.transactionHash,
          username: t.name || t.pseudonym,
          profile_image: t.profileImage || t.profileImageOptimized
        }));
        if (traderTrades.length > 0) {
          trader.username = traderTrades[0].username || trader.username;
          trader.profile_image = traderTrades[0].profile_image;
          allNewTrades = [...allNewTrades, ...traderTrades];
        }
      } catch (e) { console.error(e); }
    }
    const merged = [...allNewTrades, ...trades];
    const uniqueMap = new Map();
    merged.forEach(t => { if (!uniqueMap.has(t.id)) uniqueMap.set(t.id, t); });
    const unique = Array.from(uniqueMap.values()).sort((a: any, b: any) => new Date(b.trade_timestamp).getTime() - new Date(a.trade_timestamp).getTime());
    setTrades(unique);
    setTraders(updatedTraders);
    setIsRefreshing(false);
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 overflow-hidden">
      <Sidebar 
        traders={traders} 
        onAdd={addTrader} 
        onRemove={removeTrader} 
        selectedTrader={selectedTrader}
        onSelect={setSelectedTrader}
        stats={{ traders: traders.length, trades: trades.length }}
        currentView={currentView}
        onViewChange={setCurrentView}
        onExport={() => {
          const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(JSON.stringify(traders));
          const link = document.createElement('a');
          link.setAttribute('href', dataUri);
          link.setAttribute('download', 'poly_insiders.json');
          link.click();
        }}
        onImport={() => fileInputRef.current?.click()}
        settings={settings}
        onSettingsChange={setSettings}
        onTestNotification={async () => {
          setTestStatus('loading');
          try {
            const res = await fetch('/api/test-webhook', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ webhookUrl: settings.webhookUrl })
            });
            const data = await res.json();
            setTestStatus(data.success ? 'success' : 'error');
          } catch {
            setTestStatus('error');
          }
          setTimeout(() => setTestStatus('idle'), 4000);
        }}
        testStatus={testStatus}
        hasGlobalWebhook={!!GLOBAL_WEBHOOK_URL}
      />
      
      <main className="flex-1 flex flex-col min-w-0 bg-slate-900/50">
        <DashboardHeader 
          isRefreshing={isRefreshing}
          onRefresh={currentView === 'traders' ? () => refreshData() : () => {}}
          selectedTrader={traders.find(t => t.address === selectedTrader)}
          onAnalyze={async () => {
            if (!selectedTrader) return;
            const traderObj = traders.find(t => t.address === selectedTrader);
            const traderTrades = trades.filter(t => t.trader_address === selectedTrader);
            setIsAnalyzing(true);
            const analysis = await analyzeTraderStrategy(traderObj!, traderTrades);
            setAiAnalysis(analysis || "No data.");
            setIsAnalyzing(false);
          }}
          isAnalyzing={isAnalyzing}
          currentView={currentView}
          isScanning={isScanning}
          onToggleScan={() => setIsScanning(!isScanning)}
          onClearHistory={() => setFlaggedUsers([])}
          scanStats={scanStats}
          windowStartTime={'Server Launch'}
          isHeartbeating={isHeartbeating}
        />

        <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-8 custom-scrollbar">
          {currentView === 'traders' ? (
            <TradeFeed trades={selectedTrader ? trades.filter(t => t.trader_address === selectedTrader) : trades} />
          ) : (
            <ScannerFeed flaggedUsers={flaggedUsers} recentRejects={recentRejects} scanStats={scanStats} windowStartTime={'Server Start'} onTrack={addTrader} isAlreadyTracked={(addr) => traders.some(t => t.address.toLowerCase() === addr.toLowerCase())} />
          )}
        </div>
      </main>
    </div>
  );
};

export default App;