export type OrderSide = 'BUY' | 'SELL';

export interface MarketSymbolQuote {
  symbol: string;
  description: string;
  bid: number;
  ask: number;
  spreadPips: number;
  digits: number;
  contractSize: number;
  pipValuePerLot: number;
  dailyChangePct: number;
  lastUpdated: number;
}

export interface Mt5Position {
  ticket: number;
  accountId: string;
  symbol: string;
  type: OrderSide;
  volume: number;
  openPrice: number;
  currentPrice: number;
  sl: number;
  tp: number;
  openTime: string;
  swap: number;
  commission: number;
  profit: number;
  pips: number;
  magicNumber: number;
  comment: string;
}

export interface Mt5Deal {
  ticket: number;
  accountId: string;
  symbol: string;
  type: OrderSide;
  volume: number;
  openPrice: number;
  closePrice: number;
  sl: number;
  tp: number;
  openTime: string;
  closeTime: string;
  durationMinutes: number;
  swap: number;
  commission: number;
  profit: number;
  netProfit: number;
  pips: number;
  magicNumber: number;
  comment: string;
}

export interface EquityPoint {
  timestamp: string;
  label: string;
  balance: number;
  equity: number;
  drawdownPct: number;
  dailyPnL: number;
}

export interface SymbolPerformance {
  symbol: string;
  trades: number;
  lots: number;
  winCount: number;
  lossCount: number;
  winRatePct: number;
  grossProfit: number;
  grossLoss: number;
  netProfit: number;
  profitFactor: number;
  expectancy: number;
  longTrades: number;
  shortTrades: number;
}

export interface SessionBucket {
  session: string;
  hoursUtc: string;
  trades: number;
  winRatePct: number;
  netProfit: number;
  avgPips: number;
}

export interface Mt5AccountStats {
  totalNetProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  expectedPayoff: number;
  recoveryFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  absoluteDrawdown: number;
  maximalDrawdownUsd: number;
  maximalDrawdownPct: number;
  relativeDrawdownPct: number;
  relativeDrawdownUsd: number;
  totalTrades: number;
  shortTrades: number;
  shortTradesWonPct: number;
  longTrades: number;
  longTradesWonPct: number;
  profitTrades: number;
  profitTradesPct: number;
  lossTrades: number;
  lossTradesPct: number;
  largestProfitTrade: number;
  largestLossTrade: number;
  avgProfitTrade: number;
  avgLossTrade: number;
  maxConsecutiveWinsCount: number;
  maxConsecutiveWinsUsd: number;
  maxConsecutiveLossesCount: number;
  maxConsecutiveLossesUsd: number;
  ahprPct: number;
  ghprPct: number;
  zScore: number;
  zScoreConfidencePct: number;
}

export interface Mt5Account {
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
  balance: number;
  equity: number;
  floatingPnL: number;
  margin: number;
  freeMargin: number;
  marginLevelPct: number;
  lastWebhookSyncAt?: string | null;
  webhookSyncCount?: number;
  positions: Mt5Position[];
  deals: Mt5Deal[];
  equityCurve: EquityPoint[];
  stats: Mt5AccountStats;
  symbolBreakdown: SymbolPerformance[];
  sessionBreakdown: SessionBucket[];
}

export type GridTrendMode = 'UPTREND' | 'DOWNTREND' | 'BOTH';
export type GridEntryTriggerMode =
  | 'EXACT_LEVEL_CROSS'
  | 'BAND_RANGE'
  | 'DIRECTIONAL_CROSS'
  | 'PULLBACK_CROSS';
export type Mt5Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

export interface RsiGridTier {
  id: string;
  trend: 'UPTREND' | 'DOWNTREND';
  side: OrderSide;
  entryRsi: number;
  exitRsi: number;
  lotSize: number;
  slPoints: number;
  tpPoints: number;
  activeTicket: number | null;
  triggeredCount: number;
  realizedPnL: number;
  lastActionTime?: string;
}

export interface RsiGridConfig {
  enabled: boolean;
  accountId: string;
  symbol: string;
  timeframe: Mt5Timeframe;
  rsiPeriod: number;
  trendMode: GridTrendMode;
  entryTriggerMode: GridEntryTriggerMode;
  currentRsi: number;
  previousRsi: number;
  uptrendLotSize: number;
  uptrendSlPoints: number;
  uptrendTpPoints: number;
  downtrendLotSize: number;
  downtrendSlPoints: number;
  downtrendTpPoints: number;
  maxPnlStopPct: number;
  closeAllOnStop: boolean;
  stoppedByPnlGuard: boolean;
  stoppedReason: string | null;
  uptrendTiers: RsiGridTier[];
  downtrendTiers: RsiGridTier[];
}

export interface ServerStateSnapshot {
  accounts: Mt5Account[];
  quotes: Record<string, MarketSymbolQuote>;
  gridConfig: RsiGridConfig;
  streamPaused: boolean;
  connectedClients: number;
  serverTimeUtc: string;
  tickSequence: number;
  proxyCookie?: string;
}

export type WsClientMessage =
  | { type: 'stream:toggle'; paused: boolean }
  | {
      type: 'account:connect';
      payload: {
        ownerUserId?: string;
        login: number;
        password?: string;
        passwordType?: 'Investor (Read-Only)' | 'Master (Full Execution)';
        server: string;
        name?: string;
        broker?: string;
        currency?: string;
        leverage?: number;
        initialDeposit?: number;
        seedSampleData?: boolean;
      };
    }
  | { type: 'account:remove'; payload: { accountId: string } }
  | {
      type: 'grid:update_config';
      payload: {
        enabled?: boolean;
        accountId?: string;
        symbol?: string;
        timeframe?: Mt5Timeframe;
        rsiPeriod?: number;
        trendMode?: GridTrendMode;
        entryTriggerMode?: GridEntryTriggerMode;
        uptrendLotSize?: number;
        uptrendSlPoints?: number;
        uptrendTpPoints?: number;
        downtrendLotSize?: number;
        downtrendSlPoints?: number;
        downtrendTpPoints?: number;
        maxPnlStopPct?: number;
        closeAllOnStop?: boolean;
      };
    }
  | {
      type: 'grid:set_rsi';
      payload: {
        rsi: number;
      };
    }
  | {
      type: 'grid:manual_tier';
      payload: {
        tierId: string;
        action: 'OPEN' | 'CLOSE';
      };
    }
  | { type: 'position:open'; payload: { accountId: string; symbol: string; side: OrderSide; volume: number; sl: number; tp: number; comment: string } }
  | { type: 'position:close'; payload: { accountId: string; ticket: number } }
  | { type: 'position:modify'; payload: { accountId: string; ticket: number; sl: number; tp: number } }
  | { type: 'quote:nudge'; payload: { symbol: string; deltaPips: number } }
  | { type: 'deal:import'; payload: { accountId: string; deals: Array<Partial<Mt5Deal>> } }
  | { type: 'state:request_sync' };

export type WsServerMessage =
  | { type: 'state:init'; payload: ServerStateSnapshot }
  | {
      type: 'tick:update';
      payload: {
        quotes: Record<string, MarketSymbolQuote>;
        accounts: Mt5Account[];
        gridConfig: RsiGridConfig;
        serverTimeUtc: string;
        tickSequence: number;
        connectedClients: number;
      };
    }
  | {
      type: 'account:mutated';
      payload: {
        account: Mt5Account;
        gridConfig: RsiGridConfig;
        message: string;
        serverTimeUtc: string;
      };
    }
  | { type: 'stream:status'; payload: { streamPaused: boolean; connectedClients: number } };
