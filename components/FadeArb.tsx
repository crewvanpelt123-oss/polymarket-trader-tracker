import React, { useState, useMemo, useCallback } from 'react';

interface Outcome {
  id: string;
  name: string;
  noPrice: number;
  yesPrice: number;
  liquidity: number;
  faded: boolean;
}

interface ScannedOutcome {
  name: string;
  conditionId: string;
  slug: string;
  yesPrice: number;
  noPrice: number;
  liquidity: number;
  volume24hr: number;
}

interface FadeOpportunity {
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  outcomes: ScannedOutcome[];
  fullBasket: { K: number; cost: number; payout: number; netProfit: number; roi: number };
  bestFade: { fadedName: string; roi: number; cost: number; netProfit: number; blackSwan: number } | null;
}

// ── NO Basket math ────────────────────────────────────────────────────────────
// Buy NO on all included outcomes. Payout = (K-1) × $1 if any included wins.
function calcNoBasket(outcomes: Outcome[]) {
  const included = outcomes.filter(o => !o.faded);
  const K = included.length;
  if (K < 2) return null;
  const cost = included.reduce((s, o) => s + o.noPrice, 0);
  const payout = (K - 1) * 1.0;
  const netProfit = payout - cost;
  const roi = cost > 0 ? (netProfit / cost) * 100 : 0;
  const faded = outcomes.filter(o => o.faded);
  const blackSwanProb = faded.reduce((s, o) => s + o.yesPrice, 0);
  const originalCost = outcomes.reduce((s, o) => s + o.noPrice, 0);
  const reinvestedRoi = originalCost > 0 ? ((payout - originalCost) / originalCost) * 100 : null;
  // Max stake: bottleneck is the thinnest order book in the basket
  const minLiquidity = included.length > 0 ? Math.min(...included.map(o => o.liquidity)) : 0;
  const maxStake = minLiquidity > 0 ? minLiquidity : null;
  return { included, K, cost, payout, netProfit, roi, blackSwanProb, reinvestedRoi, originalCost, maxStake };
}

// ── YES Basket math ───────────────────────────────────────────────────────────
// Buy YES on all included outcomes. Exactly one wins → payout = $1.
// Pure arb if sum of YES prices < $1. Fade high-priced to bring cost under $1.
function calcYesBasket(outcomes: Outcome[]) {
  const included = outcomes.filter(o => !o.faded);
  const K = included.length;
  if (K < 2) return null;
  const cost = included.reduce((s, o) => s + o.yesPrice, 0);
  const payout = 1.0;
  const netProfit = payout - cost;
  const roi = cost > 0 ? (netProfit / cost) * 100 : 0;
  const faded = outcomes.filter(o => o.faded);
  const blackSwanProb = faded.reduce((s, o) => s + o.yesPrice, 0);
  const isPureArb = cost < 1.0;
  const originalCost = outcomes.reduce((s, o) => s + o.yesPrice, 0);
  const reinvestedRoi = originalCost > 0 ? ((payout - originalCost) / originalCost) * 100 : null;
  const minLiquidity = included.length > 0 ? Math.min(...included.map(o => o.liquidity)) : 0;
  const maxStake = minLiquidity > 0 ? minLiquidity : null;
  return { included, K, cost, payout, netProfit, roi, blackSwanProb, isPureArb, reinvestedRoi, originalCost, maxStake };
}

// ── Brute force ───────────────────────────────────────────────────────────────
type BruteRow = { faded: string[]; roi: number; cost: number; netProfit: number; blackSwanProb: number; K: number; reinvestedRoi: number | null; maxStake: number | null };

function bruteForce(outcomes: Outcome[], maxBlackSwan: number, mode: 'no' | 'yes'): BruteRow[] {
  const n = outcomes.length;
  const results: BruteRow[] = [];
  const calc = mode === 'yes' ? calcYesBasket : calcNoBasket;

  const test = (fadedIndices: number[]) => {
    const modified = outcomes.map((o, i) => ({ ...o, faded: fadedIndices.includes(i) }));
    const res = calc(modified);
    if (!res) return;
    if (res.blackSwanProb > maxBlackSwan) return;
    if (res.roi <= 0) return;
    results.push({
      faded: fadedIndices.map(i => outcomes[i].name),
      roi: res.roi,
      cost: res.cost,
      netProfit: res.netProfit,
      blackSwanProb: res.blackSwanProb,
      K: res.K,
      reinvestedRoi: res.reinvestedRoi,
      maxStake: res.maxStake ?? null,
    });
  };

  test([]);
  for (let i = 0; i < n; i++) test([i]);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) test([i, j]);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) test([i, j, k]);

  return results.sort((a, b) => b.roi - a.roi).slice(0, 10);
}

let nextId = 1;

const FadeArb: React.FC = () => {
  const [mode, setMode] = useState<'no' | 'yes'>('no');
  const [outcomes, setOutcomes] = useState<Outcome[]>([
    { id: 'o1', name: 'Outcome A', noPrice: 0.85, yesPrice: 0.15, liquidity: 0, faded: false },
    { id: 'o2', name: 'Outcome B', noPrice: 0.80, yesPrice: 0.20, liquidity: 0, faded: false },
    { id: 'o3', name: 'Outcome C', noPrice: 0.75, yesPrice: 0.25, liquidity: 0, faded: false },
  ]);
  const [maxBlackSwan, setMaxBlackSwan] = useState(5);
  const [bruteResults, setBruteResults] = useState<BruteRow[] | null>(null);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [loadedEventTitle, setLoadedEventTitle] = useState('');

  // Scanner state
  const [scanResults, setScanResults] = useState<FadeOpportunity[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanMinLiquidity, setScanMinLiquidity] = useState('1000');
  const [scanMinOutcomes, setScanMinOutcomes] = useState('3');
  const [scanMaxBlackSwan, setScanMaxBlackSwan] = useState('10');
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  const isExcludedEvent = (title: string) => {
    const t = title.toLowerCase();
    const CRYPTO_PRICE = ['above', 'below', 'exceed', 'hit $', 'reach $', 'what price', 'price will'];
    const CRYPTO_ASSETS = ['bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'xrp', 'crypto', 'doge', 'bnb'];
    if (CRYPTO_ASSETS.some(a => t.includes(a)) && CRYPTO_PRICE.some(p => t.includes(p))) return true;
    if (t.includes('___')) return true;
    if (t.includes('by...')) return true;
    if (t.includes('on...')) return true;
    if (/\bby \d{4}\b/.test(t)) return true;
    if (/\bin \d{4}\b/.test(t)) return true;
    if (/\bhit \$/.test(t)) return true;
    if (/\bstrike\b.+\bon\b/i.test(title)) return true;
    if (/\bstrike\b.+\bby\b/i.test(title)) return true;
    if (/\bby\b.+\?\s*$/.test(t) && t.includes('strike')) return true;
    const TIME_PHRASES = ['how long', 'when will', 'when does', 'when is', 'by when', 'what date', 'what day', 'what month', 'what year', 'what time', 'how many days', 'how many weeks', 'how many months', 'how soon', 'first day', 'last day'];
    if (TIME_PHRASES.some(p => t.includes(p))) return true;
    const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';
    if (new RegExp(`\\b(by|on|before|after|in|during)\\s+(${MONTHS})`, 'i').test(title)) return true;
    return false;
  };

  const runScan = useCallback(async () => {
    setScanning(true);
    setScanError('');
    setScanResults([]);
    try {
      const params = new URLSearchParams({ minOutcomes: scanMinOutcomes, minLiquidity: scanMinLiquidity, maxBlackSwan: (parseFloat(scanMaxBlackSwan) / 100).toString() });
      const res = await fetch(`/api/fade-scan?${params}`);
      if (!res.ok) throw new Error('Server error');
      const data = await res.json();
      const filtered = (data.opportunities || []).filter((opp: FadeOpportunity) => !isExcludedEvent(opp.eventTitle));
      setScanResults(filtered);
    } catch (e: any) {
      setScanError(e.message || 'Failed to scan');
    } finally {
      setScanning(false);
    }
  }, [scanMinOutcomes, scanMinLiquidity, scanMaxBlackSwan]);

  const loadIntoCalculator = useCallback((opp: FadeOpportunity, fadedName?: string) => {
    let id = 100;
    setOutcomes(opp.outcomes.map(o => ({
      id: `scan-${id++}`,
      name: o.name,
      noPrice: o.noPrice,
      yesPrice: o.yesPrice,
      liquidity: o.liquidity,
      faded: fadedName ? o.name === fadedName : false,
    })));
    setLoadedEventTitle(opp.eventTitle);
    setBruteResults(null);
    setTimeout(() => document.getElementById('fade-calculator')?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, []);

  const basket = useMemo(() => mode === 'yes' ? calcYesBasket(outcomes) : calcNoBasket(outcomes), [outcomes, mode]);

  const toggleFade = (id: string) => { setOutcomes(prev => prev.map(o => o.id === id ? { ...o, faded: !o.faded } : o)); setBruteResults(null); };

  const updateOutcome = (id: string, field: 'name' | 'price', value: string) => {
    setOutcomes(prev => prev.map(o => {
      if (o.id !== id) return o;
      if (field === 'name') return { ...o, name: value };
      const p = parseFloat(value);
      if (isNaN(p) || p <= 0 || p >= 1) return o;
      return { ...o, yesPrice: parseFloat(p.toFixed(4)), noPrice: parseFloat((1 - p).toFixed(4)) };
    }));
    setBruteResults(null);
  };

  const addOutcome = () => {
    const p = parseFloat(newPrice);
    if (!newName || isNaN(p) || p <= 0 || p >= 1) return;
    setOutcomes(prev => [...prev, { id: `o${++nextId}`, name: newName, yesPrice: p, noPrice: parseFloat((1 - p).toFixed(4)), liquidity: 0, faded: false }]);
    setNewName(''); setNewPrice(''); setBruteResults(null);
  };

  const removeOutcome = (id: string) => { setOutcomes(prev => prev.filter(o => o.id !== id)); setBruteResults(null); };
  const runBruteForce = () => { setBruteResults(bruteForce(outcomes, maxBlackSwan / 100, mode)); };
  const applyBruteResult = (fadedNames: string[]) => { setOutcomes(prev => prev.map(o => ({ ...o, faded: fadedNames.includes(o.name) }))); setBruteResults(null); };

  const priceLabel = mode === 'yes' ? 'YES Price' : 'NO Price';
  const priceKey = mode === 'yes' ? 'yesPrice' : 'noPrice';

  return (
    <div className="w-full space-y-6">

      {/* Scanner */}
      <div className="bg-slate-800/40 rounded-xl border border-slate-700/50 px-5 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Live Market Scanner</div>
            <div className="text-xs text-slate-400">Searches Polymarket for active multi-outcome events and ranks them by fade ROI.</div>
          </div>
          <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-slate-500 font-bold uppercase whitespace-nowrap">Min Liquidity</label>
              <input type="number" value={scanMinLiquidity} onChange={e => setScanMinLiquidity(e.target.value)} className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-slate-500 font-bold uppercase whitespace-nowrap">Min Outcomes</label>
              <input type="number" value={scanMinOutcomes} onChange={e => setScanMinOutcomes(e.target.value)} min="2" max="20" className="w-14 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-slate-500 font-bold uppercase whitespace-nowrap">Max BS%</label>
              <input type="number" value={scanMaxBlackSwan} onChange={e => setScanMaxBlackSwan(e.target.value)} min="0" max="100" className="w-14 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500" />
            </div>
            <button onClick={runScan} disabled={scanning} className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-xs font-bold transition-colors whitespace-nowrap">
              {scanning ? 'Scanning...' : 'Scan Markets'}
            </button>
          </div>
        </div>

        {scanError && <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{scanError}</div>}

        {scanResults.length > 0 && (
          <div className="space-y-2 mt-2">
            <div className="text-[10px] text-slate-500 font-bold uppercase mb-2">{scanResults.length} opportunities found</div>
            <div className="rounded-xl border border-slate-800 overflow-hidden">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/50">
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">Event</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">Outcomes</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">Full Basket ROI</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">Best Fade ROI</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">Black Swan</th>
                    <th className="px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {scanResults.map(opp => (
                    <React.Fragment key={opp.eventId}>
                      <tr className="hover:bg-slate-800/30 transition-colors cursor-pointer" onClick={() => setExpandedEvent(expandedEvent === opp.eventId ? null : opp.eventId)}>
                        <td className="px-3 py-3"><div className="text-slate-200 font-medium text-xs line-clamp-1 max-w-xs">{opp.eventTitle}</div></td>
                        <td className="px-3 py-3 text-xs text-slate-400">{opp.fullBasket.K}</td>
                        <td className="px-3 py-3">
                          <span className={`text-xs font-bold font-mono ${opp.fullBasket.roi > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {opp.fullBasket.roi > 0 ? '+' : ''}{opp.fullBasket.roi.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {opp.bestFade ? <span className="text-xs font-bold font-mono text-emerald-400">+{opp.bestFade.roi.toFixed(1)}%</span> : <span className="text-slate-600 text-xs">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          {opp.bestFade ? <span className={`text-xs font-mono ${opp.bestFade.blackSwan > 0.05 ? 'text-amber-400' : 'text-emerald-400'}`}>{(opp.bestFade.blackSwan * 100).toFixed(1)}%</span> : <span className="text-slate-600 text-xs">—</span>}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={e => { e.stopPropagation(); loadIntoCalculator(opp); }} className="text-[9px] font-bold px-2 py-1 rounded bg-slate-700 text-slate-300 border border-slate-600 hover:bg-indigo-600/30 hover:text-indigo-400 transition-colors whitespace-nowrap">Load All</button>
                            {opp.bestFade && (
                              <button onClick={e => { e.stopPropagation(); loadIntoCalculator(opp, opp.bestFade!.fadedName); }} className="text-[9px] font-bold px-2 py-1 rounded bg-violet-600/20 text-violet-400 border border-violet-500/30 hover:bg-violet-600/40 transition-colors whitespace-nowrap">Best Fade</button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedEvent === opp.eventId && (
                        <tr>
                          <td colSpan={6} className="px-3 py-3 bg-slate-900/60">
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                              {opp.outcomes.map(o => (
                                <div key={o.conditionId} className="bg-slate-800 rounded-lg px-3 py-2 text-xs">
                                  <div className="text-slate-300 font-medium truncate mb-1">{o.name}</div>
                                  <div className="flex justify-between text-[10px]">
                                    <span className="text-slate-500">NO: <span className="text-slate-200 font-mono">{(o.noPrice * 100).toFixed(1)}¢</span></span>
                                    <span className={o.yesPrice > 0.15 ? 'text-rose-400' : o.yesPrice > 0.05 ? 'text-amber-400' : 'text-emerald-400'}>YES: {(o.yesPrice * 100).toFixed(1)}%</span>
                                  </div>
                                  <div className="text-[9px] text-slate-600 mt-1">Liq: ${o.liquidity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!scanning && scanResults.length === 0 && !scanError && (
          <div className="text-center text-slate-600 text-xs py-4">Hit "Scan Markets" to find live fade arbitrage opportunities on Polymarket.</div>
        )}
      </div>

      {/* Calculator header + mode toggle */}
      <div id="fade-calculator" className="bg-slate-800/40 rounded-xl border border-slate-700/50 px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Fade Arb Calculator</div>
            {loadedEventTitle && (
              <div className="text-sm font-semibold text-violet-300 border-l-2 border-violet-500 pl-3">{loadedEventTitle}</div>
            )}
          </div>
          {/* Mode toggle */}
          <div className="flex items-center bg-slate-900 rounded-lg border border-slate-700 p-0.5">
            <button
              onClick={() => { setMode('no'); setBruteResults(null); }}
              className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${mode === 'no' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
            >
              NO Basket
            </button>
            <button
              onClick={() => { setMode('yes'); setBruteResults(null); }}
              className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${mode === 'yes' ? 'bg-emerald-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
            >
              YES Basket
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          {mode === 'no'
            ? <>Buy <span className="text-white font-bold">NO</span> shares on all included outcomes. Payout = <span className="text-white font-bold">(K−1) × $1.00</span> if any included outcome wins. Faded outcomes are excluded — if one wins you lose everything.</>
            : <>Buy <span className="text-white font-bold">YES</span> shares on all included outcomes. Exactly one wins → payout = <span className="text-white font-bold">$1.00</span>. Pure arb if total YES cost &lt; $1. Fade expensive outcomes to bring cost under $1.</>
          }
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left: Outcome table */}
        <div className="space-y-4">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Outcomes</div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/50">
                  <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">Outcome</th>
                  <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">{priceLabel}</th>
                  <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">{mode === 'yes' ? 'NO %' : 'YES %'}</th>
                  <th className="px-3 py-3 text-center text-[10px] font-bold text-slate-500 uppercase">Fade</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {outcomes.map(o => {
                  const displayPrice = o[priceKey as keyof Outcome] as number;
                  const otherPrice = mode === 'yes' ? o.noPrice : o.yesPrice;
                  return (
                    <tr key={o.id} className={`transition-colors ${o.faded ? 'opacity-40 bg-slate-900/60' : 'hover:bg-slate-800/20'}`}>
                      <td className="px-3 py-3">
                        <input className="bg-transparent text-slate-200 font-medium w-full focus:outline-none focus:text-white" value={o.name} onChange={e => updateOutcome(o.id, 'name', e.target.value)} />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          className="bg-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-300 w-20 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          value={displayPrice}
                          onChange={e => updateOutcome(o.id, 'price', e.target.value)}
                          step="0.01" min="0.01" max="0.99" type="number"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-xs font-mono font-bold ${otherPrice > 0.15 ? 'text-rose-400' : otherPrice > 0.05 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {(otherPrice * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <button onClick={() => toggleFade(o.id)} className={`px-2 py-0.5 text-[9px] font-bold rounded border transition-all ${o.faded ? 'bg-rose-500/20 text-rose-400 border-rose-500/40' : 'bg-slate-800 text-slate-500 border-slate-700 hover:border-rose-500/30 hover:text-rose-400'}`}>
                          {o.faded ? 'Faded' : 'Fade'}
                        </button>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button onClick={() => removeOutcome(o.id)} className="text-slate-700 hover:text-rose-400 transition-colors text-xs">×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Add outcome */}
          <div className="flex gap-2">
            <input className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-200 placeholder:text-slate-600" placeholder="Outcome name" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addOutcome()} />
            <input className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-200 placeholder:text-slate-600" placeholder="YES price" type="number" step="0.01" min="0.01" max="0.99" value={newPrice} onChange={e => setNewPrice(e.target.value)} onKeyDown={e => e.key === 'Enter' && addOutcome()} />
            <button onClick={addOutcome} className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 text-xs font-bold transition-colors">Add</button>
          </div>
        </div>

        {/* Right: Results */}
        <div className="space-y-4">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Basket Result</div>

          {basket ? (
            <div className="space-y-3">
              {/* Pure Arb badge for YES mode */}
              {'isPureArb' in basket && basket.isPureArb && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-2 flex items-center gap-2">
                  <span className="text-emerald-400 font-bold text-xs">PURE ARB</span>
                  <span className="text-xs text-emerald-600">Total YES cost &lt; $1.00 — riskless profit if no fades.</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-3 text-center">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Total Cost</div>
                  <div className="text-lg font-bold text-white mt-1">${basket.cost.toFixed(3)}</div>
                  <div className="text-[9px] text-slate-600">{basket.K} outcomes × {mode === 'yes' ? 'YES' : 'NO'}</div>
                </div>
                <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-3 text-center">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Payout</div>
                  <div className="text-lg font-bold text-white mt-1">${basket.payout.toFixed(2)}</div>
                  <div className="text-[9px] text-slate-600">{mode === 'yes' ? '$1.00 fixed' : `${basket.K - 1} × $1.00`}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className={`rounded-lg border p-3 text-center ${basket.roi > 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'}`}>
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Standard ROI</div>
                  <div className={`text-lg font-bold mt-1 ${basket.roi > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {basket.roi > 0 ? '+' : ''}{basket.roi.toFixed(1)}%
                  </div>
                  <div className={`text-[9px] ${basket.netProfit > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {basket.netProfit > 0 ? '+' : ''}${basket.netProfit.toFixed(3)} net
                  </div>
                </div>
                {basket.reinvestedRoi !== null && outcomes.some(o => o.faded) ? (
                  <div className="rounded-lg border bg-violet-500/10 border-violet-500/30 p-3 text-center">
                    <div className="text-[10px] text-slate-500 font-bold uppercase">Reinvested ROI</div>
                    <div className={`text-lg font-bold mt-1 ${basket.reinvestedRoi > 0 ? 'text-violet-400' : 'text-rose-400'}`}>
                      {basket.reinvestedRoi > 0 ? '+' : ''}{basket.reinvestedRoi.toFixed(1)}%
                    </div>
                    <div className="text-[9px] text-violet-600">
                      Δ {basket.reinvestedRoi > basket.roi ? '+' : ''}{(basket.reinvestedRoi - basket.roi).toFixed(1)}% vs standard
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-700/30 bg-slate-800/20 p-3 text-center flex flex-col items-center justify-center">
                    <div className="text-[10px] text-slate-600 font-bold uppercase">Reinvested ROI</div>
                    <div className="text-[9px] text-slate-700 mt-1">Fade an outcome to see</div>
                  </div>
                )}
              </div>

              {/* Max Stake */}
              <div className="bg-slate-900 rounded-xl border border-indigo-500/20 px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Max Stake</div>
                  <div className="text-xs text-slate-400 mt-0.5">Max you can deploy before the thinnest order book runs dry.</div>
                </div>
                <div className="text-right">
                  {basket.maxStake ? (
                    <>
                      <div className="text-xl font-bold text-indigo-300">${basket.maxStake.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                      <div className="text-[9px] text-slate-600">liquidity bottleneck</div>
                    </>
                  ) : (
                    <div className="text-slate-600 text-xs">No liquidity data</div>
                  )}
                </div>
              </div>

              {/* Black Swan */}
              <div className="bg-slate-900 rounded-xl border border-rose-500/20 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">Black Swan Risk</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {outcomes.filter(o => o.faded).length === 0
                        ? 'No outcomes faded — no black swan risk.'
                        : `If any faded outcome wins, you lose 100% of $${basket.cost.toFixed(3)}.`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xl font-bold ${basket.blackSwanProb > 0.1 ? 'text-rose-400' : basket.blackSwanProb > 0.05 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {(basket.blackSwanProb * 100).toFixed(1)}%
                    </div>
                    <div className="text-[9px] text-slate-600">faded YES prob</div>
                  </div>
                </div>
              </div>

              {/* Basket breakdown */}
              <div className="bg-slate-800/30 rounded-xl border border-slate-800 px-4 py-3">
                <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">Basket Breakdown</div>
                <div className="space-y-1">
                  {basket.included.map(o => (
                    <div key={o.id} className="flex justify-between text-xs">
                      <span className="text-slate-300">{o.name}</span>
                      <span className="text-slate-500 font-mono">{mode === 'yes' ? 'YES' : 'NO'} @ {((mode === 'yes' ? o.yesPrice : o.noPrice) * 100).toFixed(1)}¢</span>
                    </div>
                  ))}
                  <div className="border-t border-slate-700 mt-2 pt-2 flex justify-between text-xs font-bold">
                    <span className="text-slate-400">Total</span>
                    <span className="text-white font-mono">${basket.cost.toFixed(3)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-800/30 rounded-xl border border-slate-800 px-4 py-8 text-center text-slate-600 text-sm">
              Need at least 2 included outcomes to calculate.
            </div>
          )}
        </div>
      </div>

      {/* Brute Force */}
      <div className="bg-slate-800/40 rounded-xl border border-slate-700/50 px-5 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Brute Force Optimizer</div>
            <div className="text-xs text-slate-500">Tests every combination of fading 0, 1, 2, or 3 outcomes — ranked by ROI under your black swan threshold. Uses <span className="text-slate-400 font-bold">{mode === 'yes' ? 'YES' : 'NO'} Basket</span> mode.</div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-slate-500 font-bold uppercase whitespace-nowrap">Max Black Swan</label>
              <input type="number" min="0" max="100" step="0.5" value={maxBlackSwan} onChange={e => setMaxBlackSwan(parseFloat(e.target.value))} className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              <span className="text-[10px] text-slate-500">%</span>
            </div>
            <button onClick={runBruteForce} className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 text-xs font-bold transition-colors whitespace-nowrap">Run</button>
          </div>
        </div>

        {bruteResults && (
          bruteResults.length === 0 ? (
            <div className="text-center text-slate-600 text-xs py-4">No profitable combinations found under {maxBlackSwan}% black swan threshold.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/50">
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">Faded</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">Size</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">Cost</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">Net Profit</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">ROI</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-violet-500 uppercase">Reinvested ROI</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">Δ</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-indigo-500 uppercase">Max Stake</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">Black Swan</th>
                    <th className="px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {bruteResults.map((r, i) => (
                    <tr key={i} className={`hover:bg-slate-800/30 transition-colors ${i === 0 ? 'bg-emerald-500/5' : ''}`}>
                      <td className="px-3 py-3">
                        {r.faded.length === 0
                          ? <span className="text-slate-600 text-xs italic">None</span>
                          : <div className="flex flex-wrap gap-1">{r.faded.map(f => <span key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">{f}</span>)}</div>
                        }
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-400">{r.K}</td>
                      <td className="px-3 py-3 text-xs font-mono text-slate-300">${r.cost.toFixed(3)}</td>
                      <td className="px-3 py-3 text-xs font-mono font-bold text-emerald-400">+${r.netProfit.toFixed(3)}</td>
                      <td className="px-3 py-3">
                        <span className={`text-xs font-bold ${i === 0 ? 'text-emerald-400' : 'text-slate-300'}`}>{r.roi.toFixed(1)}%</span>
                        {i === 0 && <span className="ml-1 text-[8px] text-emerald-600 font-bold uppercase">Best</span>}
                      </td>
                      <td className="px-3 py-3">
                        {r.reinvestedRoi !== null && r.faded.length > 0
                          ? <span className="text-xs font-bold font-mono text-violet-400">{r.reinvestedRoi > 0 ? '+' : ''}{r.reinvestedRoi.toFixed(1)}%</span>
                          : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        {r.reinvestedRoi !== null && r.faded.length > 0
                          ? <span className={`text-xs font-bold font-mono ${r.reinvestedRoi - r.roi > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{r.reinvestedRoi - r.roi > 0 ? '+' : ''}{(r.reinvestedRoi - r.roi).toFixed(1)}%</span>
                          : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        {r.maxStake
                          ? <span className="text-xs font-mono text-indigo-300">${r.maxStake.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                          : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-xs font-mono ${r.blackSwanProb > 0.05 ? 'text-amber-400' : 'text-emerald-400'}`}>{(r.blackSwanProb * 100).toFixed(1)}%</span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button onClick={() => applyBruteResult(r.faded)} className="text-[9px] font-bold px-2 py-1 rounded bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-600/40 transition-colors">Apply</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default FadeArb;
