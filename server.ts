import express from 'express';
import fs from 'fs';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  MarketSymbolQuote,
  Mt5Account,
  Mt5AccountStats,
  Mt5Deal,
  Mt5Position,
  OrderSide,
  RsiGridConfig,
  RsiGridTier,
  ServerStateSnapshot,
  SessionBucket,
  SymbolPerformance,
  WsClientMessage,
  WsServerMessage,
  EquityPoint,
} from './src/types/mt5.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

// Initial institutional FX, Metals, and Index quotes
const quotes: Record<string, MarketSymbolQuote> = {
  EURUSD: {
    symbol: 'EURUSD',
    description: 'Euro vs US Dollar',
    bid: 1.08420,
    ask: 1.08426,
    spreadPips: 0.6,
    digits: 5,
    contractSize: 100000,
    pipValuePerLot: 10,
    dailyChangePct: 0.34,
    lastUpdated: Date.now(),
  },
  GBPUSD: {
    symbol: 'GBPUSD',
    description: 'Great Britain Pound vs US Dollar',
    bid: 1.29640,
    ask: 1.29649,
    spreadPips: 0.9,
    digits: 5,
    contractSize: 100000,
    pipValuePerLot: 10,
    dailyChangePct: 0.51,
    lastUpdated: Date.now(),
  },
  USDJPY: {
    symbol: 'USDJPY',
    description: 'US Dollar vs Japanese Yen',
    bid: 149.820,
    ask: 149.828,
    spreadPips: 0.8,
    digits: 3,
    contractSize: 100000,
    pipValuePerLot: 6.68,
    dailyChangePct: -0.28,
    lastUpdated: Date.now(),
  },
  XAUUSD: {
    symbol: 'XAUUSD',
    description: 'Spot Gold vs US Dollar',
    bid: 2658.40,
    ask: 2658.62,
    spreadPips: 2.2,
    digits: 2,
    contractSize: 100,
    pipValuePerLot: 10,
    dailyChangePct: 1.18,
    lastUpdated: Date.now(),
  },
  NAS100: {
    symbol: 'NAS100',
    description: 'US Tech 100 Cash Index',
    bid: 20418.50,
    ask: 20419.30,
    spreadPips: 0.8,
    digits: 2,
    contractSize: 10,
    pipValuePerLot: 10,
    dailyChangePct: 0.89,
    lastUpdated: Date.now(),
  },
  AUDUSD: {
    symbol: 'AUDUSD',
    description: 'Australian Dollar vs US Dollar',
    bid: 0.67180,
    ask: 0.67187,
    spreadPips: 0.7,
    digits: 5,
    contractSize: 100000,
    pipValuePerLot: 10,
    dailyChangePct: -0.15,
    lastUpdated: Date.now(),
  },
};

function getPipMultiplier(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s.includes('XAU') || s.includes('GOLD')) return 10; // 0.10 = 1 pip
  if (s.includes('NAS') || s.includes('US30') || s.includes('SPX') || s.includes('BTC')) return 1; // 1.00 = 1 point/pip
  if (s.includes('JPY') || s.includes('XAG')) return 100; // 0.01 = 1 pip
  return 10000; // 0.0001 = 1 pip
}

function calculatePositionMetrics(pos: Mt5Position, quote: MarketSymbolQuote): Mt5Position {
  const currentPrice = pos.type === 'BUY' ? quote.bid : quote.ask;
  const priceDiff = pos.type === 'BUY' ? currentPrice - pos.openPrice : pos.openPrice - currentPrice;
  const mult = getPipMultiplier(pos.symbol);
  const pips = Number((priceDiff * mult).toFixed(1));
  const profit = Number((pips * quote.pipValuePerLot * pos.volume).toFixed(2));
  return {
    ...pos,
    currentPrice: Number(currentPrice.toFixed(quote.digits)),
    pips,
    profit,
  };
}

function computeAccountStatistics(
  initialDeposit: number,
  deals: Mt5Deal[],
  positions: Mt5Position[]
): {
  balance: number;
  equity: number;
  floatingPnL: number;
  margin: number;
  freeMargin: number;
  marginLevelPct: number;
  stats: Mt5AccountStats;
  equityCurve: EquityPoint[];
  symbolBreakdown: SymbolPerformance[];
  sessionBreakdown: SessionBucket[];
} {
  // Sort deals chronologically by closeTime
  const sortedDeals = [...deals].sort(
    (a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime()
  );

  let runningBalance = initialDeposit;
  let peakBalance = initialDeposit;
  let minBalance = initialDeposit;
  let maxDrawdownUsd = 0;
  let maxDrawdownPct = 0;
  let relDrawdownPct = 0;
  let relDrawdownUsd = 0;

  let grossProfit = 0;
  let grossLoss = 0;
  let profitTrades = 0;
  let lossTrades = 0;
  let longTrades = 0;
  let longWins = 0;
  let shortTrades = 0;
  let shortWins = 0;

  let largestProfitTrade = 0;
  let largestLossTrade = 0;

  let curWinStreak = 0;
  let curWinStreakUsd = 0;
  let maxConsecutiveWinsCount = 0;
  let maxConsecutiveWinsUsd = 0;

  let curLossStreak = 0;
  let curLossStreakUsd = 0;
  let maxConsecutiveLossesCount = 0;
  let maxConsecutiveLossesUsd = 0;

  const hprList: number[] = [];
  const winLossSequence: ('W' | 'L')[] = [];

  const equityCurve: EquityPoint[] = [
    {
      timestamp: '2026-09-01T08:00:00Z',
      label: 'Sep 01',
      balance: initialDeposit,
      equity: initialDeposit,
      drawdownPct: 0,
      dailyPnL: 0,
    },
  ];

  const symbolMap = new Map<
    string,
    {
      trades: number;
      lots: number;
      winCount: number;
      lossCount: number;
      grossProfit: number;
      grossLoss: number;
      longTrades: number;
      shortTrades: number;
    }
  >();

  const sessionMap = new Map<
    string,
    {
      session: string;
      hoursUtc: string;
      trades: number;
      wins: number;
      netProfit: number;
      totalPips: number;
    }
  >([
    ['Asian (Tokyo)', { session: 'Asian (Tokyo)', hoursUtc: '00:00 - 07:59 UTC', trades: 0, wins: 0, netProfit: 0, totalPips: 0 }],
    ['London Open', { session: 'London Open', hoursUtc: '08:00 - 12:59 UTC', trades: 0, wins: 0, netProfit: 0, totalPips: 0 }],
    ['London / NY Overlap', { session: 'London / NY Overlap', hoursUtc: '13:00 - 16:59 UTC', trades: 0, wins: 0, netProfit: 0, totalPips: 0 }],
    ['New York Afternoon', { session: 'New York Afternoon', hoursUtc: '17:00 - 23:59 UTC', trades: 0, wins: 0, netProfit: 0, totalPips: 0 }],
  ]);

  for (const deal of sortedDeals) {
    const net = Number((deal.profit + deal.swap + deal.commission).toFixed(2));
    const prevBalance = runningBalance;
    runningBalance = Number((runningBalance + net).toFixed(2));

    if (prevBalance > 0) {
      hprList.push(net / prevBalance);
    }

    if (runningBalance > peakBalance) {
      peakBalance = runningBalance;
    }
    if (runningBalance < minBalance) {
      minBalance = runningBalance;
    }

    const currentDdUsd = Math.max(0, Number((peakBalance - runningBalance).toFixed(2)));
    const currentDdPct = peakBalance > 0 ? Number(((currentDdUsd / peakBalance) * 100).toFixed(2)) : 0;

    if (currentDdUsd > maxDrawdownUsd) {
      maxDrawdownUsd = currentDdUsd;
      maxDrawdownPct = currentDdPct;
    }
    if (currentDdPct > relDrawdownPct) {
      relDrawdownPct = currentDdPct;
      relDrawdownUsd = currentDdUsd;
    }

    if (net >= 0) {
      grossProfit += net;
      profitTrades++;
      winLossSequence.push('W');
      if (net > largestProfitTrade) largestProfitTrade = net;

      curWinStreak++;
      curWinStreakUsd += net;
      curLossStreak = 0;
      curLossStreakUsd = 0;

      if (curWinStreak > maxConsecutiveWinsCount) {
        maxConsecutiveWinsCount = curWinStreak;
      }
      if (curWinStreakUsd > maxConsecutiveWinsUsd) {
        maxConsecutiveWinsUsd = Number(curWinStreakUsd.toFixed(2));
      }
    } else {
      grossLoss += Math.abs(net);
      lossTrades++;
      winLossSequence.push('L');
      if (net < largestLossTrade) largestLossTrade = net;

      curLossStreak++;
      curLossStreakUsd += Math.abs(net);
      curWinStreak = 0;
      curWinStreakUsd = 0;

      if (curLossStreak > maxConsecutiveLossesCount) {
        maxConsecutiveLossesCount = curLossStreak;
      }
      if (curLossStreakUsd > maxConsecutiveLossesUsd) {
        maxConsecutiveLossesUsd = Number(curLossStreakUsd.toFixed(2));
      }
    }

    if (deal.type === 'BUY') {
      longTrades++;
      if (net >= 0) longWins++;
    } else {
      shortTrades++;
      if (net >= 0) shortWins++;
    }

    // Symbol breakdown
    const symEntry = symbolMap.get(deal.symbol) || {
      trades: 0,
      lots: 0,
      winCount: 0,
      lossCount: 0,
      grossProfit: 0,
      grossLoss: 0,
      longTrades: 0,
      shortTrades: 0,
    };
    symEntry.trades++;
    symEntry.lots = Number((symEntry.lots + deal.volume).toFixed(2));
    if (net >= 0) {
      symEntry.winCount++;
      symEntry.grossProfit = Number((symEntry.grossProfit + net).toFixed(2));
    } else {
      symEntry.lossCount++;
      symEntry.grossLoss = Number((symEntry.grossLoss + Math.abs(net)).toFixed(2));
    }
    if (deal.type === 'BUY') symEntry.longTrades++;
    else symEntry.shortTrades++;
    symbolMap.set(deal.symbol, symEntry);

    // Session breakdown
    const closeDate = new Date(deal.closeTime);
    const hourUtc = closeDate.getUTCHours();
    let bucketKey = 'New York Afternoon';
    if (hourUtc < 8) bucketKey = 'Asian (Tokyo)';
    else if (hourUtc < 13) bucketKey = 'London Open';
    else if (hourUtc < 17) bucketKey = 'London / NY Overlap';

    const sess = sessionMap.get(bucketKey)!;
    sess.trades++;
    if (net >= 0) sess.wins++;
    sess.netProfit = Number((sess.netProfit + net).toFixed(2));
    sess.totalPips = Number((sess.totalPips + deal.pips).toFixed(1));

    const dateLabel = closeDate.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      timeZone: 'UTC',
    });

    // Simulate slight intratrade equity excursion around balance
    const equityVariation = Number((runningBalance + (net * 0.14)).toFixed(2));
    equityCurve.push({
      timestamp: deal.closeTime,
      label: dateLabel,
      balance: runningBalance,
      equity: equityVariation,
      drawdownPct: currentDdPct,
      dailyPnL: net,
    });
  }

  const floatingPnL = Number(
    positions.reduce((acc, p) => acc + p.profit + p.swap + p.commission, 0).toFixed(2)
  );
  const equity = Number((runningBalance + floatingPnL).toFixed(2));

  // Add live point to equity curve
  const livePeak = Math.max(peakBalance, equity);
  const liveDdUsd = Math.max(0, Number((livePeak - equity).toFixed(2)));
  const liveDdPct = livePeak > 0 ? Number(((liveDdUsd / livePeak) * 100).toFixed(2)) : 0;

  equityCurve.push({
    timestamp: new Date().toISOString(),
    label: 'LIVE',
    balance: runningBalance,
    equity,
    drawdownPct: liveDdPct,
    dailyPnL: floatingPnL,
  });

  const totalTrades = sortedDeals.length;
  const totalNetProfit = Number((grossProfit - grossLoss).toFixed(2));
  const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 9.99 : 0;
  const expectedPayoff = totalTrades > 0 ? Number((totalNetProfit / totalTrades).toFixed(2)) : 0;
  const effectiveMaxDdUsd = Math.max(maxDrawdownUsd, liveDdUsd, 1);
  const recoveryFactor = Number((totalNetProfit / effectiveMaxDdUsd).toFixed(2));

  // Sharpe & Sortino calculation from HPRs
  let sharpeRatio = 0;
  let sortinoRatio = 0;
  let ahprPct = 0;
  let ghprPct = 0;

  if (hprList.length > 1) {
    const meanHpr = hprList.reduce((a, b) => a + b, 0) / hprList.length;
    const variance = hprList.reduce((acc, r) => acc + Math.pow(r - meanHpr, 2), 0) / (hprList.length - 1);
    const stdDev = Math.sqrt(variance);
    const downsideVariance =
      hprList.reduce((acc, r) => acc + (r < 0 ? Math.pow(r, 2) : 0), 0) / hprList.length;
    const downsideDev = Math.sqrt(downsideVariance);

    sharpeRatio = stdDev > 0 ? Number(((meanHpr / stdDev) * Math.sqrt(hprList.length)).toFixed(2)) : 0;
    sortinoRatio = downsideDev > 0 ? Number(((meanHpr / downsideDev) * Math.sqrt(hprList.length)).toFixed(2)) : 0;
    ahprPct = Number((meanHpr * 100).toFixed(2));
    const productHpr = hprList.reduce((acc, r) => acc * (1 + r), 1);
    ghprPct = Number(((Math.pow(productHpr, 1 / hprList.length) - 1) * 100).toFixed(2));
  }

  // Z-Score calculation for serial trade dependency
  let runs = 1;
  for (let i = 1; i < winLossSequence.length; i++) {
    if (winLossSequence[i] !== winLossSequence[i - 1]) runs++;
  }
  let zScore = 0;
  if (profitTrades > 0 && lossTrades > 0 && totalTrades > 2) {
    const p = 2 * profitTrades * lossTrades;
    const n = totalTrades;
    const numerator = n * (runs - 0.5) - p;
    const denominator = Math.sqrt((p * (p - n)) / (n - 1));
    if (denominator > 0) {
      zScore = Number((numerator / denominator).toFixed(2));
    }
  }
  const zScoreConfidencePct = Number(
    (Math.min(99.9, Math.abs(zScore) * 38.5)).toFixed(1)
  );

  // Margin calculation (1:100 standard institutional margin estimate)
  const margin = Number(
    positions
      .reduce((acc, pos) => {
        const q = quotes[pos.symbol];
        const contractNotional = pos.volume * (q ? q.contractSize : 100000);
        return acc + contractNotional / 100;
      }, 0)
      .toFixed(2)
  );
  const freeMargin = Number((equity - margin).toFixed(2));
  const marginLevelPct = margin > 0 ? Number(((equity / margin) * 100).toFixed(1)) : 0;

  const symbolBreakdown: SymbolPerformance[] = Array.from(symbolMap.entries())
    .map(([symbol, data]) => {
      const netProfit = Number((data.grossProfit - data.grossLoss).toFixed(2));
      const pf =
        data.grossLoss > 0
          ? Number((data.grossProfit / data.grossLoss).toFixed(2))
          : data.grossProfit > 0
          ? 9.99
          : 0;
      return {
        symbol,
        trades: data.trades,
        lots: data.lots,
        winCount: data.winCount,
        lossCount: data.lossCount,
        winRatePct: data.trades > 0 ? Number(((data.winCount / data.trades) * 100).toFixed(1)) : 0,
        grossProfit: data.grossProfit,
        grossLoss: data.grossLoss,
        netProfit,
        profitFactor: pf,
        expectancy: data.trades > 0 ? Number((netProfit / data.trades).toFixed(2)) : 0,
        longTrades: data.longTrades,
        shortTrades: data.shortTrades,
      };
    })
    .sort((a, b) => b.netProfit - a.netProfit);

  const sessionBreakdown: SessionBucket[] = Array.from(sessionMap.values()).map((s) => ({
    session: s.session,
    hoursUtc: s.hoursUtc,
    trades: s.trades,
    winRatePct: s.trades > 0 ? Number(((s.wins / s.trades) * 100).toFixed(1)) : 0,
    netProfit: s.netProfit,
    avgPips: s.trades > 0 ? Number((s.totalPips / s.trades).toFixed(1)) : 0,
  }));

  const stats: Mt5AccountStats = {
    totalNetProfit,
    grossProfit: Number(grossProfit.toFixed(2)),
    grossLoss: Number(grossLoss.toFixed(2)),
    profitFactor,
    expectedPayoff,
    recoveryFactor,
    sharpeRatio,
    sortinoRatio,
    absoluteDrawdown: Number(Math.max(0, initialDeposit - minBalance).toFixed(2)),
    maximalDrawdownUsd: Number(Math.max(maxDrawdownUsd, liveDdUsd).toFixed(2)),
    maximalDrawdownPct: Number(Math.max(maxDrawdownPct, liveDdPct).toFixed(2)),
    relativeDrawdownPct: Number(Math.max(relDrawdownPct, liveDdPct).toFixed(2)),
    relativeDrawdownUsd: Number(Math.max(relDrawdownUsd, liveDdUsd).toFixed(2)),
    totalTrades,
    shortTrades,
    shortTradesWonPct: shortTrades > 0 ? Number(((shortWins / shortTrades) * 100).toFixed(1)) : 0,
    longTrades,
    longTradesWonPct: longTrades > 0 ? Number(((longWins / longTrades) * 100).toFixed(1)) : 0,
    profitTrades,
    profitTradesPct: totalTrades > 0 ? Number(((profitTrades / totalTrades) * 100).toFixed(1)) : 0,
    lossTrades,
    lossTradesPct: totalTrades > 0 ? Number(((lossTrades / totalTrades) * 100).toFixed(1)) : 0,
    largestProfitTrade: Number(largestProfitTrade.toFixed(2)),
    largestLossTrade: Number(largestLossTrade.toFixed(2)),
    avgProfitTrade: profitTrades > 0 ? Number((grossProfit / profitTrades).toFixed(2)) : 0,
    avgLossTrade: lossTrades > 0 ? Number((-grossLoss / lossTrades).toFixed(2)) : 0,
    maxConsecutiveWinsCount,
    maxConsecutiveWinsUsd,
    maxConsecutiveLossesCount,
    maxConsecutiveLossesUsd,
    ahprPct,
    ghprPct,
    zScore,
    zScoreConfidencePct,
  };

  return {
    balance: runningBalance,
    equity,
    floatingPnL,
    margin,
    freeMargin,
    marginLevelPct,
    stats,
    equityCurve,
    symbolBreakdown,
    sessionBreakdown,
  };
}

// Seed realistic institutional MT5 deals and active positions
let nextTicket = 88421050;

const ACCOUNTS_CACHE_FILE = path.join(__dirname, '.mt5_accounts_cache.json');

const rawAccounts: Array<{
  id: string;
  ownerUserId: string;
  login: number;
  name: string;
  broker: string;
  server: string;
  currency: string;
  leverage: number;
  accountType: 'ECN Institutional' | 'Raw Spread Hedge' | 'Prime DMA';
  initialDeposit: number;
  realBalance?: number;
  realEquity?: number;
  realFloatingPnL?: number;
  realMargin?: number;
  realFreeMargin?: number;
  realMarginLevelPct?: number;
  lastWebhookSyncAt?: string | null;
  webhookSyncCount?: number;
  positions: Mt5Position[];
  deals: Mt5Deal[];
}> = (() => {
  try {
    if (fs.existsSync(ACCOUNTS_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(ACCOUNTS_CACHE_FILE, 'utf-8'));
      if (Array.isArray(data)) return data;
    }
  } catch {
    // ignore cache read error
  }
  return [];
})();

function saveAccountsCache() {
  try {
    fs.writeFileSync(ACCOUNTS_CACHE_FILE, JSON.stringify(rawAccounts), 'utf-8');
  } catch {
    // ignore cache write error
  }
}

interface PendingMt5Command {
  id: string;
  action: 'OPEN' | 'CLOSE';
  login: number;
  symbol: string;
  side: OrderSide;
  volume: number;
  sl: number;
  tp: number;
  ticket: number;
  comment: string;
}

const pendingMt5Commands: PendingMt5Command[] = [];
let streamPaused = false;
let tickSequence = 1042;
let latestBrowserCookie = '';

interface PendingMt5Command {
  id: number;
  action: 'OPEN' | 'CLOSE';
  symbol: string;
  side: OrderSide;
  volume: number;
  sl: number;
  tp: number;
  ticket: number;
  comment: string;
  webTempTicket?: number;
}
const pendingMt5Commands: PendingMt5Command[] = [];
let nextCommandId = 1;
let lastMt5ExecutionResult: string = '';

const gridConfig: RsiGridConfig = {
  enabled: false,
  accountId: '',
  symbol: 'XAUUSD',
  timeframe: 'M5',
  rsiPeriod: 14,
  trendMode: 'UPTREND',
  entryTriggerMode: 'EXACT_LEVEL_CROSS',
  currentRsi: 30.2,
  previousRsi: 29.8,
  uptrendLotSize: 0.01,
  uptrendSlPoints: 3000,
  uptrendTpPoints: 0,
  downtrendLotSize: 0.01,
  downtrendSlPoints: 3000,
  downtrendTpPoints: 0,
  maxPnlStopPct: 50,
  closeAllOnStop: true,
  stoppedByPnlGuard: false,
  stoppedReason: null,
  uptrendTiers: [
    { id: 'up-5-10', trend: 'UPTREND', side: 'BUY', entryRsi: 5, exitRsi: 10, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'up-10-20', trend: 'UPTREND', side: 'BUY', entryRsi: 10, exitRsi: 20, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'up-20-30', trend: 'UPTREND', side: 'BUY', entryRsi: 20, exitRsi: 30, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'up-30-40', trend: 'UPTREND', side: 'BUY', entryRsi: 30, exitRsi: 40, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'up-40-50', trend: 'UPTREND', side: 'BUY', entryRsi: 40, exitRsi: 50, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'up-50-60', trend: 'UPTREND', side: 'BUY', entryRsi: 50, exitRsi: 60, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'up-60-70', trend: 'UPTREND', side: 'BUY', entryRsi: 60, exitRsi: 70, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'up-70-80', trend: 'UPTREND', side: 'BUY', entryRsi: 70, exitRsi: 80, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'up-80-90', trend: 'UPTREND', side: 'BUY', entryRsi: 80, exitRsi: 90, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
  ],
  downtrendTiers: [
    { id: 'dn-90-80', trend: 'DOWNTREND', side: 'SELL', entryRsi: 90, exitRsi: 80, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'dn-80-70', trend: 'DOWNTREND', side: 'SELL', entryRsi: 80, exitRsi: 70, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'dn-70-60', trend: 'DOWNTREND', side: 'SELL', entryRsi: 70, exitRsi: 60, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'dn-60-50', trend: 'DOWNTREND', side: 'SELL', entryRsi: 60, exitRsi: 50, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'dn-50-40', trend: 'DOWNTREND', side: 'SELL', entryRsi: 50, exitRsi: 40, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'dn-40-30', trend: 'DOWNTREND', side: 'SELL', entryRsi: 40, exitRsi: 30, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'dn-30-20', trend: 'DOWNTREND', side: 'SELL', entryRsi: 30, exitRsi: 20, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'dn-20-10', trend: 'DOWNTREND', side: 'SELL', entryRsi: 20, exitRsi: 10, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
    { id: 'dn-10-5', trend: 'DOWNTREND', side: 'SELL', entryRsi: 10, exitRsi: 5, lotSize: 0.01, slPoints: 3000, tpPoints: 0, activeTicket: null, triggeredCount: 0, realizedPnL: 0 },
  ],
};

function openGridTierPosition(tier: RsiGridTier): string | null {
  const acc = rawAccounts.find((a) => a.id === gridConfig.accountId) || rawAccounts[0];
  if (!acc) return null;
  const q = quotes[gridConfig.symbol] || quotes.XAUUSD;
  if (tier.activeTicket !== null) {
    const stillOpen = acc.positions.some((p) => p.ticket === tier.activeTicket);
    if (stillOpen) return null;
  }

  const pointSize = Math.pow(10, -q.digits);
  const openPrice = tier.side === 'BUY' ? q.ask : q.bid;
  const slDistance = tier.slPoints * pointSize;
  const slPrice =
    tier.side === 'BUY'
      ? Number(Math.max(0.0001, openPrice - slDistance).toFixed(q.digits))
      : Number((openPrice + slDistance).toFixed(q.digits));

  const tpDistance = tier.tpPoints > 0 ? tier.tpPoints * pointSize : 0;
  const tpPrice =
    tier.tpPoints > 0
      ? tier.side === 'BUY'
        ? Number((openPrice + tpDistance).toFixed(q.digits))
        : Number(Math.max(0.0001, openPrice - tpDistance).toFixed(q.digits))
      : 0;

  const ticket = ++nextTicket;
  const comment = `GRID_${tier.trend === 'UPTREND' ? 'UP' : 'DN'}_RSI_${tier.entryRsi}_${tier.exitRsi}`;

  const newPos = calculatePositionMetrics(
    {
      ticket,
      accountId: acc.id,
      symbol: q.symbol,
      type: tier.side,
      volume: tier.lotSize,
      openPrice,
      currentPrice: openPrice,
      sl: slPrice,
      tp: tpPrice,
      openTime: new Date().toISOString(),
      swap: 0,
      commission: Number((-7 * tier.lotSize).toFixed(2)),
      profit: 0,
      pips: 0,
      magicNumber: tier.trend === 'UPTREND' ? 880100 + tier.entryRsi : 880200 + tier.entryRsi,
      comment,
    },
    q
  );

  acc.positions.unshift(newPos);
  tier.activeTicket = ticket;
  tier.triggeredCount += 1;
  tier.lastActionTime = new Date().toISOString();

  return `Grid ${tier.trend} ${tier.side} (${tier.lotSize} lot, SL ${tier.slPoints}) opened #${ticket} at RSI ${gridConfig.currentRsi.toFixed(1)} [Entry ${tier.entryRsi} -> Exit ${tier.exitRsi}]`;
}

function closeGridTierPosition(tier: RsiGridTier): string | null {
  if (tier.activeTicket === null) return null;
  const acc = rawAccounts.find((a) => a.id === gridConfig.accountId) || rawAccounts[0];
  if (!acc) {
    tier.activeTicket = null;
    return null;
  }
  const posIdx = acc.positions.findIndex((p) => p.ticket === tier.activeTicket);
  if (posIdx === -1) {
    tier.activeTicket = null;
    return null;
  }

  const [pos] = acc.positions.splice(posIdx, 1);
  const q = quotes[pos.symbol] || quotes.XAUUSD;
  const updatedPos = calculatePositionMetrics(pos, q);
  const netProfit = Number((updatedPos.profit + updatedPos.swap + updatedPos.commission).toFixed(2));

  const closedDeal: Mt5Deal = {
    ticket: updatedPos.ticket,
    accountId: acc.id,
    symbol: updatedPos.symbol,
    type: updatedPos.type,
    volume: updatedPos.volume,
    openPrice: updatedPos.openPrice,
    closePrice: updatedPos.currentPrice,
    sl: updatedPos.sl,
    tp: updatedPos.tp,
    openTime: updatedPos.openTime,
    closeTime: new Date().toISOString(),
    durationMinutes: Math.max(1, Math.round((Date.now() - new Date(pos.openTime).getTime()) / 60000)),
    swap: updatedPos.swap,
    commission: updatedPos.commission,
    profit: updatedPos.profit,
    netProfit,
    pips: updatedPos.pips,
    magicNumber: updatedPos.magicNumber,
    comment: `${updatedPos.comment}_EXIT_RSI_${tier.exitRsi}`,
  };

  acc.deals.push(closedDeal);
  tier.activeTicket = null;
  tier.realizedPnL = Number((tier.realizedPnL + netProfit).toFixed(2));
  tier.lastActionTime = new Date().toISOString();

  return `Grid ${tier.trend} EXIT #${closedDeal.ticket} at RSI ${gridConfig.currentRsi.toFixed(1)} (Target ${tier.exitRsi}) · Net ${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}`;
}

function evaluateRsiGrid(): string[] {
  const logs: string[] = [];
  if (!gridConfig.enabled || rawAccounts.length === 0) return logs;

  // Check PnL = 50% (maxPnlStopPct) Auto-Stop Circuit Breaker
  const accountsState = buildFullAccountsState();
  const activeAcc =
    accountsState.find((a) => a.id === gridConfig.accountId) || accountsState[0];

  if (activeAcc && gridConfig.maxPnlStopPct > 0) {
    const totalPnlPct =
      activeAcc.initialDeposit > 0
        ? ((activeAcc.equity - activeAcc.initialDeposit) / activeAcc.initialDeposit) * 100
        : 0;
    const floatingPnlPct =
      activeAcc.balance > 0 ? (activeAcc.floatingPnL / activeAcc.balance) * 100 : 0;

    const triggeredTotal = Math.abs(totalPnlPct) >= gridConfig.maxPnlStopPct;
    const triggeredFloating = Math.abs(floatingPnlPct) >= gridConfig.maxPnlStopPct;

    if (triggeredTotal || triggeredFloating) {
      const hitPct = triggeredTotal ? totalPnlPct : floatingPnlPct;
      gridConfig.enabled = false;
      gridConfig.stoppedByPnlGuard = true;
      gridConfig.stoppedReason = `Auto-Grid Stopped: PnL reached ${hitPct >= 0 ? '+' : ''}${hitPct.toFixed(2)}% (Limit: ${gridConfig.maxPnlStopPct}%)`;
      logs.push(gridConfig.stoppedReason);

      if (gridConfig.closeAllOnStop) {
        for (const tier of [...gridConfig.uptrendTiers, ...gridConfig.downtrendTiers]) {
          if (tier.activeTicket !== null) {
            const cMsg = closeGridTierPosition(tier);
            if (cMsg) logs.push(cMsg);
          }
        }
      }
      return logs;
    }
  }

  const rsi = gridConfig.currentRsi;
  const prevRsi = gridConfig.previousRsi;
  const triggerMode = gridConfig.entryTriggerMode || 'EXACT_LEVEL_CROSS';

  // Evaluate Uptrend Tiers (Buy: Entry RSI=5.x->TP RSI=>10.x ... RSI=80.x->TP RSI=>90.x)
  for (const tier of gridConfig.uptrendTiers) {
    // Check Exit first: TP (RSI Exit) RSI => exitRsi.x (i.e. rsi >= tier.exitRsi)
    if (tier.activeTicket !== null && rsi >= tier.exitRsi) {
      const msg = closeGridTierPosition(tier);
      if (msg) logs.push(msg);
    }
    // Check Entry: RSI = entryRsi.x means Math.floor(rsi) === tier.entryRsi (e.g. 30.0 .. 30.99)
    const inBand = rsi >= tier.entryRsi && rsi < tier.exitRsi;
    const isExactDecimalMatch = Math.floor(rsi) === tier.entryRsi;

    const isEntryAllowed =
      triggerMode === 'EXACT_LEVEL_CROSS'
        ? isExactDecimalMatch
        : triggerMode === 'BAND_RANGE'
        ? inBand
        : triggerMode === 'DIRECTIONAL_CROSS'
        ? inBand && rsi >= prevRsi
        : inBand && rsi <= prevRsi;

    if (
      (gridConfig.trendMode === 'UPTREND' || gridConfig.trendMode === 'BOTH') &&
      tier.activeTicket === null &&
      isEntryAllowed
    ) {
      const msg = openGridTierPosition(tier);
      if (msg) logs.push(msg);
    }
  }

  // Evaluate Downtrend Tiers (Sell: Entry RSI=90.x->TP RSI<=80.x ... RSI=10.x->TP RSI<=5.x)
  for (const tier of gridConfig.downtrendTiers) {
    // Check Exit first: TP (RSI Exit) RSI <= exitRsi.x (i.e. Math.floor(rsi) <= tier.exitRsi, or rsi < tier.exitRsi + 1)
    if (tier.activeTicket !== null && Math.floor(rsi) <= tier.exitRsi) {
      const msg = closeGridTierPosition(tier);
      if (msg) logs.push(msg);
    }
    // Check Entry: RSI = entryRsi.x means Math.floor(rsi) === tier.entryRsi (e.g. 90.0 .. 90.99)
    const inBand = rsi <= tier.entryRsi && rsi > tier.exitRsi;
    const isExactDecimalMatch = Math.floor(rsi) === tier.entryRsi;

    const isEntryAllowed =
      triggerMode === 'EXACT_LEVEL_CROSS'
        ? isExactDecimalMatch
        : triggerMode === 'BAND_RANGE'
        ? inBand
        : triggerMode === 'DIRECTIONAL_CROSS'
        ? inBand && rsi <= prevRsi
        : inBand && rsi >= prevRsi;

    if (
      (gridConfig.trendMode === 'DOWNTREND' || gridConfig.trendMode === 'BOTH') &&
      tier.activeTicket === null &&
      isEntryAllowed
    ) {
      const msg = openGridTierPosition(tier);
      if (msg) logs.push(msg);
    }
  }

  return logs;
}

function buildFullAccountsState(): Mt5Account[] {
  saveAccountsCache();
  return rawAccounts.map((acc) => {
    const positions = acc.positions;
    const deals = [...acc.deals].sort(
      (a, b) => new Date(b.closeTime).getTime() - new Date(a.closeTime).getTime()
    );

    const totalNetProfitFromDeals = Number(
      deals.reduce((sum, d) => sum + (d.profit + d.swap + d.commission), 0).toFixed(2)
    );

    const effectiveInitialDeposit =
      acc.initialDeposit > 0
        ? acc.initialDeposit
        : acc.realBalance !== undefined
        ? Math.max(0, Number((acc.realBalance - totalNetProfitFromDeals).toFixed(2)))
        : 0;

    const computed = computeAccountStatistics(effectiveInitialDeposit, deals, positions);

    const realFloatingFromPositions = Number(
      positions.reduce((sum, p) => sum + p.profit + p.swap + p.commission, 0).toFixed(2)
    );

    const balance = acc.realBalance !== undefined ? acc.realBalance : computed.balance;
    const floatingPnL =
      acc.realFloatingPnL !== undefined
        ? acc.realFloatingPnL
        : positions.length > 0
        ? realFloatingFromPositions
        : 0;
    const equity =
      acc.realEquity !== undefined
        ? acc.realEquity
        : Number((balance + floatingPnL).toFixed(2));
    const margin = acc.realMargin !== undefined ? acc.realMargin : computed.margin;
    const freeMargin =
      acc.realFreeMargin !== undefined
        ? acc.realFreeMargin
        : Number((equity - margin).toFixed(2));
    const marginLevelPct =
      acc.realMarginLevelPct !== undefined
        ? acc.realMarginLevelPct
        : margin > 0
        ? Number(((equity / margin) * 100).toFixed(1))
        : 0;

    // Ensure final LIVE point on equity curve reflects real MT5 balance & equity
    if (computed.equityCurve.length > 0) {
      const lastPt = computed.equityCurve[computed.equityCurve.length - 1];
      lastPt.balance = balance;
      lastPt.equity = equity;
      lastPt.dailyPnL = floatingPnL;
    }

    return {
      id: acc.id,
      ownerUserId: acc.ownerUserId || 'Sosaka',
      login: acc.login,
      name: acc.name,
      broker: acc.broker,
      server: acc.server,
      currency: acc.currency,
      leverage: acc.leverage,
      accountType: acc.accountType,
      initialDeposit: effectiveInitialDeposit,
      balance,
      equity,
      floatingPnL,
      margin,
      freeMargin,
      marginLevelPct,
      lastWebhookSyncAt: acc.lastWebhookSyncAt || null,
      webhookSyncCount: acc.webhookSyncCount || 0,
      positions,
      deals,
      equityCurve: computed.equityCurve,
      stats: computed.stats,
      symbolBreakdown: computed.symbolBreakdown,
      sessionBreakdown: computed.sessionBreakdown,
    };
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, _res, next) => {
    if (req.headers.cookie && req.headers.cookie.length > 10) {
      latestBrowserCookie = req.headers.cookie;
    }
    next();
  });

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  function getConnectedCount(): number {
    let count = 0;
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) count++;
    });
    return count;
  }

  function broadcast(msg: WsServerMessage) {
    const payload = JSON.stringify(msg);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  function getSnapshot(): ServerStateSnapshot {
    return {
      accounts: buildFullAccountsState(),
      quotes,
      gridConfig,
      streamPaused,
      connectedClients: getConnectedCount(),
      serverTimeUtc: new Date().toISOString(),
      tickSequence,
      proxyCookie: latestBrowserCookie,
    };
  }

  // REST API for MT5 Expert Advisor WebRequest webhook sync
  app.get('/api/mt5/state', (_req, res) => {
    res.json(getSnapshot());
  });

   app.post('/api/mt5/webhook', (req, res) => {
    const body = req.body || {};
    const {
      event,
      ownerUserId,
      accountId,
      login,
      server = 'MetaQuotes-Demo',
      broker = 'MetaQuotes Software Corp.',
      name,
      currency,
      initialDeposit,
      balance,
      equity,
      floatingPnL,
      margin,
      freeMargin,
      marginLevel,
      leverage = 100,
      symbol = 'XAUUSD',
      side = 'BUY',
      volume = 0.01,
      sl = 0,
      tp = 0,
      comment = 'MT5_Live_EA',
    } = body;

    const cleanLogin = Number(login) || 0;
    const effectiveOwner =
      ownerUserId ||
      rawAccounts[0]?.ownerUserId ||
      'Sosaka1';
    const scopedAccountId =
      accountId ||
      (cleanLogin > 0
        ? `acc-${String(effectiveOwner).toLowerCase()}-${cleanLogin}`
        : `acc-${String(effectiveOwner).toLowerCase()}-live`);

    let acc =
      rawAccounts.find(
        (a) =>
          a.id === scopedAccountId ||
          (accountId && a.id === accountId) ||
          (cleanLogin > 0 && a.login === cleanLogin)
      ) || null;

    if (!acc) {
      acc = {
        id: scopedAccountId,
        ownerUserId: String(effectiveOwner),
        login: cleanLogin,
        name: name || `MT5 #${cleanLogin}`,
        broker: String(broker),
        server: String(server),
        currency: String(currency || 'USD'),
        leverage: Number(leverage) || 100,
        accountType: 'ECN Institutional',
        initialDeposit: initialDeposit !== undefined ? Number(initialDeposit) : 0,
        realBalance: balance !== undefined ? Number(balance) : 0,
        realEquity: equity !== undefined ? Number(equity) : 0,
        realFloatingPnL: floatingPnL !== undefined ? Number(floatingPnL) : 0,
        realMargin: margin !== undefined ? Number(margin) : 0,
        realFreeMargin: freeMargin !== undefined ? Number(freeMargin) : 0,
        realMarginLevelPct: marginLevel !== undefined ? Number(marginLevel) : 0,
        lastWebhookSyncAt: new Date().toISOString(),
        webhookSyncCount: 1,
        positions: [],
        deals: [],
      };
      rawAccounts.unshift(acc);
      if (!gridConfig.accountId) gridConfig.accountId = acc.id;
    } else {
      // Always update existing account with real MT5 metadata & balances
      // NEVER overwrite acc.ownerUserId so the logged-in user is never kicked out when EA syncs!
      acc.lastWebhookSyncAt = new Date().toISOString();
      acc.webhookSyncCount = (acc.webhookSyncCount || 0) + 1;
      if (cleanLogin > 0) acc.login = cleanLogin;
      if (server) acc.server = String(server);
      if (broker) acc.broker = String(broker);
      if (name) acc.name = String(name);
      if (currency) acc.currency = String(currency);
      if (leverage) acc.leverage = Number(leverage);
      if (initialDeposit !== undefined && Number(initialDeposit) > 0) {
        acc.initialDeposit = Number(initialDeposit);
      }
      if (balance !== undefined) acc.realBalance = Number(balance);
      if (equity !== undefined) acc.realEquity = Number(equity);
      if (floatingPnL !== undefined) acc.realFloatingPnL = Number(floatingPnL);
      if (margin !== undefined) acc.realMargin = Number(margin);
      if (freeMargin !== undefined) acc.realFreeMargin = Number(freeMargin);
      if (marginLevel !== undefined) acc.realMarginLevelPct = Number(marginLevel);
    }

    // Update live chart quote and RSI if sent from MT5 EA
    if (body.chartSymbol && body.chartBid && body.chartAsk) {
      const sym = String(body.chartSymbol).toUpperCase();
      const digits = Number(body.chartDigits ?? 2);
      const mult = getPipMultiplier(sym);
      const bidPrice = Number(body.chartBid);
      const askPrice = Number(body.chartAsk);
      quotes[sym] = {
        symbol: sym,
        description: quotes[sym]?.description || `${sym} MT5 Live`,
        bid: bidPrice,
        ask: askPrice,
        spreadPips: Number(((askPrice - bidPrice) * mult).toFixed(1)),
        digits,
        contractSize: quotes[sym]?.contractSize || 100,
        pipValuePerLot: quotes[sym]?.pipValuePerLot || 10,
        dailyChangePct: quotes[sym]?.dailyChangePct || 0,
        lastUpdated: Date.now(),
      };
      gridConfig.symbol = sym;
    }

    if (body.currentRsi !== undefined && Number(body.currentRsi) > 0) {
      gridConfig.previousRsi = gridConfig.currentRsi;
      gridConfig.currentRsi = Number(Number(body.currentRsi).toFixed(1));
    }

    // Process any execution results reported back from MT5 EA
    if (body.lastExecResult && String(body.lastExecResult).trim() !== '') {
      lastMt5ExecutionResult = String(body.lastExecResult).trim();
    }

    // Full real open positions sync from MT5
    if (Array.isArray(body.positions)) {
      // Keep manual web positions only if they are still waiting in pendingMt5Commands
      const pendingTempTickets = new Set(
        pendingMt5Commands.map((c) => c.webTempTicket).filter(Boolean)
      );
      const manualWebPositions = acc.positions.filter(
        (p) => p.magicNumber === 401002 && pendingTempTickets.has(p.ticket)
      );
      const mt5Positions = body.positions.map((p: Record<string, unknown>) => {
        const sym = String(p.symbol || 'XAUUSD').toUpperCase();
        const posSide: OrderSide = String(p.type || p.side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
        const openPr = Number(p.openPrice) || 0;
        const curPr = Number(p.currentPrice) || openPr;
        const mult = getPipMultiplier(sym);
        const diff = posSide === 'BUY' ? curPr - openPr : openPr - curPr;
        const pips = p.pips !== undefined ? Number(p.pips) : Number((diff * mult).toFixed(1));
        return {
          ticket: Number(p.ticket) || ++nextTicket,
          accountId: acc!.id,
          symbol: sym,
          type: posSide,
          volume: Number(p.volume) || 0.01,
          openPrice: openPr,
          currentPrice: curPr,
          sl: Number(p.sl) || 0,
          tp: Number(p.tp) || 0,
          openTime: p.openTime ? String(p.openTime) : new Date().toISOString(),
          swap: Number(p.swap) || 0,
          commission: Number(p.commission) || 0,
          profit: Number(p.profit) || 0,
          pips,
          magicNumber: Number(p.magicNumber ?? p.magic) || 0,
          comment: String(p.comment || ''),
        } satisfies Mt5Position;
      });
      acc.positions = [...manualWebPositions, ...mt5Positions];

      // Map active grid tier tickets from real MT5 open positions
      for (const tier of gridConfig.uptrendTiers) {
        const expectedMagic = 880100 + tier.entryRsi;
        const matched = acc.positions.find(
          (pos) =>
            pos.magicNumber === expectedMagic ||
            pos.comment.includes(`GRID_UP_RSI_${tier.entryRsi}_${tier.exitRsi}`)
        );
        tier.activeTicket = matched ? matched.ticket : null;
      }
      for (const tier of gridConfig.downtrendTiers) {
        const expectedMagic = 880200 + tier.entryRsi;
        const matched = acc.positions.find(
          (pos) =>
            pos.magicNumber === expectedMagic ||
            pos.comment.includes(`GRID_DN_RSI_${tier.entryRsi}_${tier.exitRsi}`)
        );
        tier.activeTicket = matched ? matched.ticket : null;
      }
    }

    // Full real closed history deals sync from MT5
    if (Array.isArray(body.deals)) {
      acc.deals = body.deals.map((d: Record<string, unknown>) => {
        const sym = String(d.symbol || 'XAUUSD').toUpperCase();
        const dealSide: OrderSide = String(d.type || d.side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
        const openPr = Number(d.openPrice) || 0;
        const closePr = Number(d.closePrice) || openPr;
        const mult = getPipMultiplier(sym);
        const diff = dealSide === 'BUY' ? closePr - openPr : openPr - closePr;
        const pips = d.pips !== undefined ? Number(d.pips) : openPr > 0 ? Number((diff * mult).toFixed(1)) : 0;
        const profitVal = Number(d.profit) || 0;
        const swapVal = Number(d.swap) || 0;
        const commVal = Number(d.commission) || 0;
        const netProfitVal =
          d.netProfit !== undefined
            ? Number(d.netProfit)
            : Number((profitVal + swapVal + commVal).toFixed(2));
        const openTimeStr = d.openTime ? String(d.openTime) : new Date().toISOString();
        const closeTimeStr = d.closeTime ? String(d.closeTime) : new Date().toISOString();
        const durMin = Math.max(
          1,
          Math.round((new Date(closeTimeStr).getTime() - new Date(openTimeStr).getTime()) / 60000) || 1
        );
        return {
          ticket: Number(d.ticket) || ++nextTicket,
          accountId: acc!.id,
          symbol: sym,
          type: dealSide,
          volume: Number(d.volume) || 0.01,
          openPrice: openPr,
          closePrice: closePr,
          sl: Number(d.sl) || 0,
          tp: Number(d.tp) || 0,
          openTime: openTimeStr,
          closeTime: closeTimeStr,
          durationMinutes: durMin,
          swap: swapVal,
          commission: commVal,
          profit: profitVal,
          netProfit: netProfitVal,
          pips,
          magicNumber: Number(d.magicNumber ?? d.magic) || 0,
          comment: String(d.comment || ''),
        } satisfies Mt5Deal;
      });
    }

    if (event === 'account_init' || event === 'mt5_full_sync') {
      tickSequence++;
      const commandsToDispatch = pendingMt5Commands.splice(0, pendingMt5Commands.length);
      const cmdString = commandsToDispatch
        .map(
          (c) =>
            `CMD|${c.id}|${c.action}|${c.symbol}|${c.side}|${c.volume.toFixed(2)}|${c.sl}|${c.tp}|${c.ticket}|${c.comment}`
        )
        .join('\n');

      const updatedAccounts = buildFullAccountsState();
      const updatedAcc = updatedAccounts.find((a) => a.id === acc!.id)!;
      broadcast({
        type: 'state:init',
        payload: getSnapshot(),
      });
      if (lastMt5ExecutionResult) {
        broadcast({
          type: 'account:mutated',
          payload: {
            account: updatedAcc,
            gridConfig,
            message: `MT5 Terminal: ${lastMt5ExecutionResult}`,
            serverTimeUtc: new Date().toISOString(),
          },
        });
        lastMt5ExecutionResult = '';
      }
      res.json({
        ok: true,
        accountId: acc.id,
        login: acc.login,
        commands: commandsToDispatch,
        cmdString,
        account: updatedAcc,
      });
      return;
    }

    const q = quotes[symbol] || quotes.XAUUSD;

    if (event === 'deal_closed') {
      const dealTicket = Number(body.ticket) || ++nextTicket;
      const openPrice = Number(body.openPrice || body.closePrice || q.bid);
      const closePrice = Number(body.closePrice || q.ask);
      const mult = getPipMultiplier(symbol);
      const diff = side === 'BUY' ? closePrice - openPrice : openPrice - closePrice;
      const pips = Number((diff * mult).toFixed(1));
      const profit = Number((body.profit ?? 0).toFixed(2));
      const swap = Number((body.swap ?? 0).toFixed(2));
      const commission = Number((body.commission ?? 0).toFixed(2));
      const exists = acc.deals.some((d) => d.ticket === dealTicket);
      if (!exists) {
        const newDeal: Mt5Deal = {
          ticket: dealTicket,
          accountId: acc.id,
          symbol: String(symbol).toUpperCase(),
          type: side === 'SELL' ? 'SELL' : 'BUY',
          volume: Number(volume),
          openPrice,
          closePrice,
          sl: Number(sl),
          tp: Number(tp),
          openTime: body.openTime ? String(body.openTime) : new Date().toISOString(),
          closeTime: body.closeTime ? String(body.closeTime) : new Date().toISOString(),
          durationMinutes: 1,
          swap,
          commission,
          profit,
          netProfit: Number((profit + swap + commission).toFixed(2)),
          pips,
          magicNumber: Number(body.magicNumber || 0),
          comment: String(comment),
        };
        acc.deals.push(newDeal);
      }
      if (body.positionTicket) {
        acc.positions = acc.positions.filter((p) => p.ticket !== Number(body.positionTicket));
      }
    } else if (event === 'position_opened') {
      const posTicket = Number(body.ticket) || ++nextTicket;
      const openPrice = Number(body.openPrice || body.closePrice || q.ask);
      const exists = acc.positions.some((p) => p.ticket === posTicket);
      if (!exists) {
        acc.positions.unshift({
          ticket: posTicket,
          accountId: acc.id,
          symbol: String(symbol).toUpperCase(),
          type: side === 'SELL' ? 'SELL' : 'BUY',
          volume: Number(volume),
          openPrice,
          currentPrice: openPrice,
          sl: Number(sl),
          tp: Number(tp),
          openTime: new Date().toISOString(),
          swap: Number(body.swap || 0),
          commission: Number(body.commission || 0),
          profit: Number(body.profit || 0),
          pips: 0,
          magicNumber: Number(body.magicNumber || 0),
          comment: String(comment),
        });
      }
    }

    const updatedAccounts = buildFullAccountsState();
    const updatedAcc = updatedAccounts.find((a) => a.id === acc.id)!;

    broadcast({
      type: 'account:mutated',
      payload: {
        account: updatedAcc,
        gridConfig,
        message: `MT5 Live Sync (#${acc.login})`,
        serverTimeUtc: new Date().toISOString(),
      },
    });

    res.json({ ok: true, ticket: nextTicket, account: updatedAcc });
  });

  // WebSocket Connection Handler
  wss.on('connection', (ws) => {
    // Send authoritative state immediately upon connection
    const initMsg: WsServerMessage = {
      type: 'state:init',
      payload: getSnapshot(),
    };
    ws.send(JSON.stringify(initMsg));

    // Notify all clients of updated connection count
    broadcast({
      type: 'stream:status',
      payload: { streamPaused, connectedClients: getConnectedCount() },
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as WsClientMessage;

        if (msg.type === 'state:request_sync') {
          ws.send(
            JSON.stringify({
              type: 'state:init',
              payload: getSnapshot(),
            } satisfies WsServerMessage)
          );
          return;
        }

        if (msg.type === 'stream:toggle') {
          streamPaused = Boolean(msg.paused);
          broadcast({
            type: 'stream:status',
            payload: { streamPaused, connectedClients: getConnectedCount() },
          });
          return;
        }

        if (msg.type === 'account:connect') {
          const {
            ownerUserId = 'Sosaka',
            login,
            server,
            name,
            broker,
            currency = 'USD',
            leverage = 100,
          } = msg.payload;

          const cleanLogin = Number(login) || 0;
          const scopedAccountId = `acc-${String(ownerUserId).toLowerCase()}-${cleanLogin}`;
          let existing = rawAccounts.find(
            (a) =>
              a.id === scopedAccountId ||
              (a.login === cleanLogin &&
                a.ownerUserId.toLowerCase() === String(ownerUserId).toLowerCase()) ||
              a.login === cleanLogin
          );

          if (!existing) {
            const inferredBroker =
              broker ||
              (server.toLowerCase().includes('metaquotes')
                ? 'MetaQuotes Software Corp.'
                : server.toLowerCase().includes('icmarkets')
                ? 'IC Markets Global Ltd'
                : server.toLowerCase().includes('pepperstone')
                ? 'Pepperstone Institutional'
                : server.toLowerCase().includes('ftmo')
                ? 'FTMO Evaluation Global'
                : server.toLowerCase().includes('exness')
                ? 'Exness Technologies Ltd'
                : 'MT5 Broker Server');

            existing = {
              id: scopedAccountId,
              ownerUserId: String(ownerUserId),
              login: cleanLogin,
              name: name?.trim() || `${server} (#${cleanLogin})`,
              broker: inferredBroker,
              server: server || 'MetaQuotes-Demo',
              currency: currency || 'USD',
              leverage: Number(leverage) || 100,
              accountType: 'ECN Institutional',
              initialDeposit: 0,
              realBalance: 0,
              realEquity: 0,
              realFloatingPnL: 0,
              realMargin: 0,
              realFreeMargin: 0,
              realMarginLevelPct: 0,
              positions: [],
              deals: [],
            };
            rawAccounts.unshift(existing);
          } else {
            existing.ownerUserId = String(ownerUserId);
            existing.server = server || existing.server;
            if (name?.trim()) existing.name = name.trim();
          }

          gridConfig.accountId = existing.id;

          broadcast({
            type: 'state:init',
            payload: getSnapshot(),
          });

          const updatedAcc = buildFullAccountsState().find((a) => a.id === existing!.id)!;
          broadcast({
            type: 'account:mutated',
            payload: {
              account: updatedAcc,
              gridConfig,
              message: `Registered MT5 Login #${cleanLogin} (${existing.server}) — Ready for real MT5 data sync`,
              serverTimeUtc: new Date().toISOString(),
            },
          });
          return;
        }

        if (msg.type === 'account:remove') {
          const { accountId } = msg.payload;
          const idx = rawAccounts.findIndex((a) => a.id === accountId);
          if (idx !== -1) {
            rawAccounts.splice(idx, 1);
            if (gridConfig.accountId === accountId) {
              gridConfig.accountId = rawAccounts[0]?.id || '';
              if (!gridConfig.accountId) gridConfig.enabled = false;
            }
            broadcast({
              type: 'state:init',
              payload: getSnapshot(),
            });
          }
          return;
        }

        if (msg.type === 'grid:update_config') {
          const p = msg.payload;
          if (p.enabled !== undefined) {
            gridConfig.enabled = Boolean(p.enabled);
            if (gridConfig.enabled) {
              gridConfig.stoppedByPnlGuard = false;
              gridConfig.stoppedReason = null;
            }
          }
          if (p.accountId) gridConfig.accountId = p.accountId;
          if (p.symbol && quotes[p.symbol]) gridConfig.symbol = p.symbol;
          if (p.timeframe) gridConfig.timeframe = p.timeframe;
          if (p.rsiPeriod !== undefined) gridConfig.rsiPeriod = Math.max(2, Math.min(50, Number(p.rsiPeriod)));
          if (p.trendMode) gridConfig.trendMode = p.trendMode;
          if (p.entryTriggerMode) gridConfig.entryTriggerMode = p.entryTriggerMode;
          if (p.maxPnlStopPct !== undefined) {
            gridConfig.maxPnlStopPct = Math.max(1, Math.min(500, Number(p.maxPnlStopPct)));
          }
          if (p.closeAllOnStop !== undefined) {
            gridConfig.closeAllOnStop = Boolean(p.closeAllOnStop);
          }
          if (p.uptrendLotSize !== undefined) {
            gridConfig.uptrendLotSize = Math.max(0.01, Number(p.uptrendLotSize));
            gridConfig.uptrendTiers.forEach((t) => (t.lotSize = gridConfig.uptrendLotSize));
          }
          if (p.uptrendSlPoints !== undefined) {
            gridConfig.uptrendSlPoints = Math.max(10, Number(p.uptrendSlPoints));
            gridConfig.uptrendTiers.forEach((t) => (t.slPoints = gridConfig.uptrendSlPoints));
          }
          if (p.uptrendTpPoints !== undefined) {
            gridConfig.uptrendTpPoints = Math.max(0, Number(p.uptrendTpPoints));
            gridConfig.uptrendTiers.forEach((t) => (t.tpPoints = gridConfig.uptrendTpPoints));
          }
          if (p.downtrendLotSize !== undefined) {
            gridConfig.downtrendLotSize = Math.max(0.01, Number(p.downtrendLotSize));
            gridConfig.downtrendTiers.forEach((t) => (t.lotSize = gridConfig.downtrendLotSize));
          }
          if (p.downtrendSlPoints !== undefined) {
            gridConfig.downtrendSlPoints = Math.max(10, Number(p.downtrendSlPoints));
            gridConfig.downtrendTiers.forEach((t) => (t.slPoints = gridConfig.downtrendSlPoints));
          }
          if (p.downtrendTpPoints !== undefined) {
            gridConfig.downtrendTpPoints = Math.max(0, Number(p.downtrendTpPoints));
            gridConfig.downtrendTiers.forEach((t) => (t.tpPoints = gridConfig.downtrendTpPoints));
          }

          const logs = evaluateRsiGrid();
          const allAccs = buildFullAccountsState();
          const targetAcc =
            allAccs.find((a) => a.id === gridConfig.accountId) || allAccs[0];

          if (targetAcc) {
            broadcast({
              type: 'account:mutated',
              payload: {
                account: targetAcc,
                gridConfig,
                message: logs[0] || `Updated RSI Grid (${gridConfig.trendMode} · ${gridConfig.symbol})`,
                serverTimeUtc: new Date().toISOString(),
              },
            });
          } else {
            broadcast({
              type: 'state:init',
              payload: getSnapshot(),
            });
          }
          return;
        }

        if (msg.type === 'grid:set_rsi') {
          gridConfig.previousRsi = gridConfig.currentRsi;
          gridConfig.currentRsi = Math.max(1, Math.min(99, Number(msg.payload.rsi)));
          const logs = evaluateRsiGrid();
          const allAccs = buildFullAccountsState();
          const targetAcc =
            allAccs.find((a) => a.id === gridConfig.accountId) || allAccs[0];

          if (targetAcc) {
            broadcast({
              type: 'account:mutated',
              payload: {
                account: targetAcc,
                gridConfig,
                message:
                  logs[0] ||
                  `RSI set to ${gridConfig.currentRsi.toFixed(1)} (${gridConfig.trendMode})`,
                serverTimeUtc: new Date().toISOString(),
              },
            });
          } else {
            broadcast({
              type: 'state:init',
              payload: getSnapshot(),
            });
          }
          return;
        }

        if (msg.type === 'grid:manual_tier') {
          const { tierId, action } = msg.payload;
          const allTiers = [...gridConfig.uptrendTiers, ...gridConfig.downtrendTiers];
          const tier = allTiers.find((t) => t.id === tierId);
          if (!tier) return;

          const logMsg =
            action === 'OPEN' ? openGridTierPosition(tier) : closeGridTierPosition(tier);
          const allAccs = buildFullAccountsState();
          const targetAcc =
            allAccs.find((a) => a.id === gridConfig.accountId) || allAccs[0];

          if (targetAcc) {
            broadcast({
              type: 'account:mutated',
              payload: {
                account: targetAcc,
                gridConfig,
                message: logMsg || `Grid tier ${tier.id} ${action} executed`,
                serverTimeUtc: new Date().toISOString(),
              },
            });
          }
          return;
        }

        if (msg.type === 'quote:nudge') {
          const { symbol, deltaPips } = msg.payload;
          const q = quotes[symbol];
          if (q) {
            const mult = getPipMultiplier(symbol);
            const deltaPrice = deltaPips / mult;
            const spread = q.ask - q.bid;
            q.bid = Number((q.bid + deltaPrice).toFixed(q.digits));
            q.ask = Number((q.bid + spread).toFixed(q.digits));
            q.lastUpdated = Date.now();
            tickSequence++;

            broadcast({
              type: 'tick:update',
              payload: {
                quotes,
                accounts: buildFullAccountsState(),
                gridConfig,
                serverTimeUtc: new Date().toISOString(),
                tickSequence,
                connectedClients: getConnectedCount(),
              },
            });
          }
          return;
        }

        if (msg.type === 'position:open') {
          const { accountId, symbol, side, volume, sl, tp, comment } = msg.payload;
          const acc = rawAccounts.find((a) => a.id === accountId);
          const q = quotes[symbol] || quotes.XAUUSD;
          if (!acc || !q) return;

          const openPrice = side === 'BUY' ? q.ask : q.bid;
          const tempTicket = ++nextTicket;
          const cleanVol = Math.max(0.01, Number(volume));
          const cleanSl = Number(sl) || 0;
          const cleanTp = Number(tp) || 0;
          const cleanComment = comment || 'Manual_Order_MT5';

          // Enqueue command for real MT5 terminal execution on next 2-second sync
          pendingMt5Commands.push({
            id: nextCommandId++,
            action: 'OPEN',
            symbol,
            side,
            volume: cleanVol,
            sl: cleanSl,
            tp: cleanTp,
            ticket: 0,
            comment: cleanComment,
            webTempTicket: tempTicket,
          });

          const newPos = calculatePositionMetrics(
            {
              ticket: tempTicket,
              accountId: acc.id,
              symbol,
              type: side,
              volume: cleanVol,
              openPrice,
              currentPrice: openPrice,
              sl: cleanSl,
              tp: cleanTp,
              openTime: new Date().toISOString(),
              swap: 0,
              commission: Number((-7 * cleanVol).toFixed(2)),
              profit: 0,
              pips: 0,
              magicNumber: 401002,
              comment: cleanComment,
            },
            q
          );

          acc.positions.unshift(newPos);
          const updatedAcc = buildFullAccountsState().find((a) => a.id === acc.id)!;

          broadcast({
            type: 'account:mutated',
            payload: {
              account: updatedAcc,
              gridConfig,
              message: `Dispatched ${side} ${cleanVol} ${symbol} to MT5 Terminal (#${acc.login})`,
              serverTimeUtc: new Date().toISOString(),
            },
          });
          return;
        }

        if (msg.type === 'position:close') {
          const { accountId, ticket } = msg.payload;
          const acc = rawAccounts.find((a) => a.id === accountId);
          if (!acc) return;

          const posIndex = acc.positions.findIndex((p) => p.ticket === ticket);
          if (posIndex === -1) return; // Idempotent guard

          const [pos] = acc.positions.splice(posIndex, 1);

          // Enqueue CLOSE command for real MT5 terminal if it's a real MT5 ticket
          pendingMt5Commands.push({
            id: nextCommandId++,
            action: 'CLOSE',
            symbol: pos.symbol,
            side: pos.type,
            volume: pos.volume,
            sl: 0,
            tp: 0,
            ticket: pos.ticket,
            comment: 'Web_Close',
          });
          // Clear any activeTicket reference in gridConfig if closed manually
          for (const t of [...gridConfig.uptrendTiers, ...gridConfig.downtrendTiers]) {
            if (t.activeTicket === ticket) {
              t.activeTicket = null;
            }
          }
          const q = quotes[pos.symbol] || quotes.EURUSD;
          const updatedPos = calculatePositionMetrics(pos, q);
          const durationMinutes = Math.max(
            1,
            Math.round((Date.now() - new Date(pos.openTime).getTime()) / 60000)
          );
          const netProfit = Number(
            (updatedPos.profit + updatedPos.swap + updatedPos.commission).toFixed(2)
          );

          const closedDeal: Mt5Deal = {
            ticket: updatedPos.ticket,
            accountId: acc.id,
            symbol: updatedPos.symbol,
            type: updatedPos.type,
            volume: updatedPos.volume,
            openPrice: updatedPos.openPrice,
            closePrice: updatedPos.currentPrice,
            sl: updatedPos.sl,
            tp: updatedPos.tp,
            openTime: updatedPos.openTime,
            closeTime: new Date().toISOString(),
            durationMinutes,
            swap: updatedPos.swap,
            commission: updatedPos.commission,
            profit: updatedPos.profit,
            netProfit,
            pips: updatedPos.pips,
            magicNumber: updatedPos.magicNumber,
            comment: updatedPos.comment,
          };

          acc.deals.push(closedDeal);
          const updatedAcc = buildFullAccountsState().find((a) => a.id === acc.id)!;

          broadcast({
            type: 'account:mutated',
            payload: {
              account: updatedAcc,
              gridConfig,
              message: `Closed #${closedDeal.ticket} ${closedDeal.symbol} (${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)})`,
              serverTimeUtc: new Date().toISOString(),
            },
          });
          return;
        }

        if (msg.type === 'position:modify') {
          const { accountId, ticket, sl, tp } = msg.payload;
          const acc = rawAccounts.find((a) => a.id === accountId);
          if (!acc) return;
          const pos = acc.positions.find((p) => p.ticket === ticket);
          if (!pos) return;

          pos.sl = Number(sl) || 0;
          pos.tp = Number(tp) || 0;
          const updatedAcc = buildFullAccountsState().find((a) => a.id === acc.id)!;

          broadcast({
            type: 'account:mutated',
            payload: {
              account: updatedAcc,
              gridConfig,
              message: `Modified #${ticket} SL/TP`,
              serverTimeUtc: new Date().toISOString(),
            },
          });
          return;
        }

        if (msg.type === 'deal:import') {
          const { accountId, deals } = msg.payload;
          const acc = rawAccounts.find((a) => a.id === accountId);
          if (!acc || !Array.isArray(deals)) return;

          let added = 0;
          for (const d of deals) {
            const ticketId = Number(d.ticket) || ++nextTicket;
            // Idempotency check
            if (acc.deals.some((existing) => existing.ticket === ticketId)) continue;

            const symbol = d.symbol ? String(d.symbol).toUpperCase() : 'XAUUSD';
            const side: OrderSide = d.type === 'SELL' ? 'SELL' : 'BUY';
            const volume = Number(d.volume) || 0.01;
            const openPrice = Number(d.openPrice) || 0;
            const closePrice = Number(d.closePrice) || openPrice;
            const profit = Number(d.profit) || 0;
            const commission = Number(d.commission) || 0;
            const swap = Number(d.swap) || 0;
            const mult = getPipMultiplier(symbol);
            const pips =
              d.pips !== undefined
                ? Number(d.pips)
                : openPrice > 0
                ? Number(
                    (((side === 'BUY' ? closePrice - openPrice : openPrice - closePrice) * mult)).toFixed(1)
                  )
                : 0;

            acc.deals.push({
              ticket: ticketId,
              accountId: acc.id,
              symbol,
              type: side,
              volume,
              openPrice,
              closePrice,
              sl: Number(d.sl) || 0,
              tp: Number(d.tp) || 0,
              openTime: d.openTime || new Date().toISOString(),
              closeTime: d.closeTime || new Date().toISOString(),
              durationMinutes: Number(d.durationMinutes) || 1,
              swap,
              commission,
              profit,
              netProfit: Number((profit + swap + commission).toFixed(2)),
              pips,
              magicNumber: Number(d.magicNumber) || 0,
              comment: d.comment || 'MT5_Deal_Sync',
            });
            added++;
          }

          const updatedAcc = buildFullAccountsState().find((a) => a.id === acc.id)!;
          broadcast({
            type: 'account:mutated',
            payload: {
              account: updatedAcc,
              gridConfig,
              message: `Imported ${added} historical MT5 deal(s)`,
              serverTimeUtc: new Date().toISOString(),
            },
          });
        }
      } catch (err) {
        console.error('WS message parse error:', err);
      }
    });

    ws.on('close', () => {
      broadcast({
        type: 'stream:status',
        payload: { streamPaused, connectedClients: getConnectedCount() },
      });
    });
  });

  // Heartbeat broadcast loop (preserves real MT5 balances, open positions, and deal history without generating simulated orders)
  setInterval(() => {
    if (streamPaused || getConnectedCount() === 0) return;

    tickSequence++;
    broadcast({
      type: 'tick:update',
      payload: {
        quotes,
        accounts: buildFullAccountsState(),
        gridConfig,
        serverTimeUtc: new Date().toISOString(),
        tickSequence,
        connectedClients: getConnectedCount(),
      },
    });
  }, 2000);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`MetaPulse MT5 Server & WebSocket Engine listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
