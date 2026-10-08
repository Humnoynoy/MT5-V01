import React, { useState } from 'react';
import { Copy, Check, Play, Pause } from 'lucide-react';
import type {
  GridEntryTriggerMode,
  GridTrendMode,
  MarketSymbolQuote,
  Mt5Account,
  Mt5Timeframe,
  RsiGridConfig,
  RsiGridTier,
} from '../types/mt5';
import { PriceRsiChart } from './PriceRsiChart';

interface RsiGridPanelProps {
  account: Mt5Account;
  quotes: Record<string, MarketSymbolQuote>;
  gridConfig: RsiGridConfig;
  onUpdateConfig: (payload: {
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
  }) => void;
  onSetRsi: (rsi: number) => void;
  onManualTierAction: (tierId: string, action: 'OPEN' | 'CLOSE') => void;
}

const QUICK_RSI_LEVELS = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90];
const MT5_TIMEFRAMES: Mt5Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

export const RsiGridPanel: React.FC<RsiGridPanelProps> = ({
  account,
  quotes,
  gridConfig,
  onUpdateConfig,
  onSetRsi,
  onManualTierAction,
}) => {
  const [copiedEa, setCopiedEa] = useState(false);

  const symbols = Object.keys(quotes);
  const publicOrigin = window.location.origin.replace('https://ais-dev-', 'https://ais-pre-');
  const webhookUrl = `${publicOrigin}/api/mt5/webhook`;
  const activeQuote = quotes[gridConfig.symbol] || quotes.XAUUSD || Object.values(quotes)[0];

  const getActivePositionForTicket = (ticket: number | null) => {
    if (ticket === null) return null;
    return account.positions.find((p) => p.ticket === ticket) || null;
  };

  const activeTf: Mt5Timeframe = gridConfig.timeframe || 'M5';
  const activeRsiPeriod = gridConfig.rsiPeriod || 14;
  const entryTriggerMode: GridEntryTriggerMode =
    gridConfig.entryTriggerMode || 'EXACT_LEVEL_CROSS';
  const upTp = gridConfig.uptrendTpPoints ?? 0;
  const dnTp = gridConfig.downtrendTpPoints ?? 0;
  const maxPnlStopPct = gridConfig.maxPnlStopPct ?? 50;
  const closeAllOnStop = gridConfig.closeAllOnStop ?? true;

  const accountTotalPnlPct =
    account.initialDeposit > 0
      ? ((account.equity - account.initialDeposit) / account.initialDeposit) * 100
      : 0;
  const floatingPnlPct =
    account.balance > 0 ? (account.floatingPnL / account.balance) * 100 : 0;

  const mql5GridCode = `//+------------------------------------------------------------------+
//|                                      MetaPulse_RSI_Grid_EA.mq5   |
//|         Automated Uptrend & Downtrend RSI Grid Order Execution   |
//+------------------------------------------------------------------+
#property copyright "MetaPulse MT5 Grid Engine"
#property version   "3.50"
#property strict

#include <Trade\\Trade.mqh>
CTrade trade;

enum ENUM_TREND_MODE
{
   TREND_UPTREND   = 0, // ======Uptrend====== (Buy Start)
   TREND_DOWNTREND = 1, // ====Down trend=== (Sell Start)
   TREND_BOTH      = 2  // Dual Trend Grid
};

enum ENUM_ENTRY_TRIGGER_MODE
{
   ENTRY_EXACT_LEVEL_CROSS = 0, // RSI = XX.x (MathFloor(RSI) == EntryLevel, e.g. 30.0..30.99)
   ENTRY_BAND_RANGE        = 1, // Any RSI inside [Entry, Exit) band
   ENTRY_DIRECTIONAL_CROSS = 2, // Rising RSI Only for Buy, Falling Only for Sell
   ENTRY_PULLBACK_DIP      = 3  // Pullback Dip Only for Buy, Bounce Only for Sell
};

input ENUM_TREND_MODE         InpTrendMode        = TREND_UPTREND;
input ENUM_ENTRY_TRIGGER_MODE InpEntryTriggerMode = ${
    entryTriggerMode === 'EXACT_LEVEL_CROSS'
      ? 'ENTRY_EXACT_LEVEL_CROSS'
      : entryTriggerMode === 'DIRECTIONAL_CROSS'
      ? 'ENTRY_DIRECTIONAL_CROSS'
      : entryTriggerMode === 'PULLBACK_CROSS'
      ? 'ENTRY_PULLBACK_DIP'
      : 'ENTRY_BAND_RANGE'
  };
input ENUM_TIMEFRAMES         InpRsiTimeframe     = PERIOD_${activeTf}; // Default: ${activeTf} Timeframe
input int                     InpRsiPeriod        = ${activeRsiPeriod};
input double                  InpUptrendLot       = ${gridConfig.uptrendLotSize.toFixed(2)};   // Buy Lot Size = 0.01
input int                     InpUptrendSL        = ${gridConfig.uptrendSlPoints};     // Buy SL: 3000 points
input int                     InpUptrendTP        = ${upTp};     // Buy Hard TP: 0 = Dynamic RSI Exit Only
input double                  InpDowntrendLot     = ${gridConfig.downtrendLotSize.toFixed(2)};   // Sell Lot Size = 0.01
input int                     InpDowntrendSL      = ${gridConfig.downtrendSlPoints};     // Sell SL: 3000 points
input int                     InpDowntrendTP      = ${dnTp};     // Sell Hard TP: 0 = Dynamic RSI Exit Only
input double                  InpStopGridPnLPct   = ${maxPnlStopPct.toFixed(1)};   // Stop Auto-Grid when PnL = ${maxPnlStopPct}%
input bool                    InpCloseAllOnStop   = ${closeAllOnStop ? 'true' : 'false'};  // Close all open grid positions on PnL Stop
input string                  InpWebhookUrl       = "${webhookUrl}";
input string                  InpOwnerUserId      = "${account.ownerUserId || 'Sosaka'}"; // Dashboard Owner User ID
input int                     InpSyncIntervalSec  = 2;  // Live Sync Interval (Seconds)
input int                     InpMaxHistoryDeals  = 100; // Max Closed History Deals to Sync

int    rsiHandle;
double g_initialBaseline = 0.0;
bool   g_gridStoppedByPnL = false;

// Buy Tiers (9 Levels: RSI=5.x -> RSI=>10.x ... RSI=80.x -> RSI=>90.x)
int UpEntry[9] = {5, 10, 20, 30, 40, 50, 60, 70, 80};
int UpExit[9]  = {10, 20, 30, 40, 50, 60, 70, 80, 90};

// Sell Tiers (9 Levels: RSI=90.x -> RSI<=80.x ... RSI=10.x -> RSI<=5.x)
int DnEntry[9] = {90, 80, 70, 60, 50, 40, 30, 20, 10};
int DnExit[9]  = {80, 70, 60, 50, 40, 30, 20, 10, 5};

int OnInit()
{
   g_initialBaseline = AccountInfoDouble(ACCOUNT_BALANCE);
   rsiHandle = iRSI(_Symbol, InpRsiTimeframe, InpRsiPeriod, PRICE_CLOSE);
   if(rsiHandle == INVALID_HANDLE) return(INIT_FAILED);
   EventSetTimer(MathMax(1, InpSyncIntervalSec));
   SyncFullAccountToWebApp();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   SyncFullAccountToWebApp();
}

void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD ||
      trans.type == TRADE_TRANSACTION_ORDER_DELETE ||
      trans.type == TRADE_TRANSACTION_HISTORY_ADD)
   {
      SyncFullAccountToWebApp();
   }
}

void OnTick()
{
   if(g_gridStoppedByPnL) return;

   // Check PnL = ${maxPnlStopPct}% Stop Auto-Grid Circuit Breaker
   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double baseCap = (g_initialBaseline > 0.0) ? g_initialBaseline : balance;
   double totalPnlPct = (baseCap > 0.0) ? ((equity - baseCap) / baseCap) * 100.0 : 0.0;
   double floatPnlPct = (balance > 0.0) ? ((equity - balance) / balance) * 100.0 : 0.0;

   if(InpStopGridPnLPct > 0.0 && (MathAbs(totalPnlPct) >= InpStopGridPnLPct || MathAbs(floatPnlPct) >= InpStopGridPnLPct))
   {
      g_gridStoppedByPnL = true;
      PrintFormat("MetaPulse Auto-Grid STOPPED: PnL reached %.2f%% (Limit: %.2f%%)", totalPnlPct, InpStopGridPnLPct);
      if(InpCloseAllOnStop) CloseAllGridPositions();
      return;
   }

   double rsiBuf[];
   ArraySetAsSeries(rsiBuf, true);
   if(CopyBuffer(rsiHandle, 0, 0, 2, rsiBuf) < 2) return;
   double currentRsi = rsiBuf[0];
   double prevRsi    = rsiBuf[1];
   int    rsiInt     = (int)MathFloor(currentRsi); // e.g. 30.4 -> 30 (matches RSI=30.x)

   // 1. Evaluate Buy Grid (9 Tiers: Lot = 0.01, SL = 3000)
   for(int i = 0; i < 9; i++)
   {
      long magic = 880100 + UpEntry[i];
      ulong activeTicket = FindOpenTicketByMagic(magic);

      // TP (RSI Exit): RSI => UpExit[i].x (i.e. currentRsi >= UpExit[i])
      if(activeTicket > 0 && currentRsi >= UpExit[i])
      {
         trade.PositionClose(activeTicket);
      }
      // Buy Entry: RSI = UpEntry[i].x (i.e. rsiInt == UpEntry[i])
      else if(activeTicket == 0 && (InpTrendMode == TREND_UPTREND || InpTrendMode == TREND_BOTH))
      {
         bool inBand     = (currentRsi >= UpEntry[i] && currentRsi < UpExit[i]);
         bool exactDec   = (rsiInt == UpEntry[i]);

         bool shouldOpen = (InpEntryTriggerMode == ENTRY_EXACT_LEVEL_CROSS) ? exactDec :
                           (InpEntryTriggerMode == ENTRY_BAND_RANGE) ? inBand :
                           (InpEntryTriggerMode == ENTRY_DIRECTIONAL_CROSS) ? (inBand && currentRsi >= prevRsi) :
                           (inBand && currentRsi <= prevRsi);
         if(shouldOpen)
         {
            double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
            double sl  = ask - InpUptrendSL * _Point;
            double tp  = (InpUptrendTP > 0) ? (ask + InpUptrendTP * _Point) : 0.0;
            trade.SetExpertMagicNumber(magic);
            string cmt = StringFormat("GRID_UP_RSI_%d_%d", UpEntry[i], UpExit[i]);
            trade.Buy(InpUptrendLot, _Symbol, ask, sl, tp, cmt);
         }
      }
   }

   // 2. Evaluate Sell Grid (9 Tiers: Lot = 0.01, SL = 3000)
   for(int j = 0; j < 9; j++)
   {
      long magic = 880200 + DnEntry[j];
      ulong activeTicket = FindOpenTicketByMagic(magic);

      // TP (RSI Exit): RSI <= DnExit[j].x (i.e. rsiInt <= DnExit[j])
      if(activeTicket > 0 && rsiInt <= DnExit[j])
      {
         trade.PositionClose(activeTicket);
      }
      // Sell Entry: RSI = DnEntry[j].x (i.e. rsiInt == DnEntry[j])
      else if(activeTicket == 0 && (InpTrendMode == TREND_DOWNTREND || InpTrendMode == TREND_BOTH))
      {
         bool inBand     = (currentRsi <= DnEntry[j] && currentRsi > DnExit[j]);
         bool exactDec   = (rsiInt == DnEntry[j]);

         bool shouldOpen = (InpEntryTriggerMode == ENTRY_EXACT_LEVEL_CROSS) ? exactDec :
                           (InpEntryTriggerMode == ENTRY_BAND_RANGE) ? inBand :
                           (InpEntryTriggerMode == ENTRY_DIRECTIONAL_CROSS) ? (inBand && currentRsi <= prevRsi) :
                           (inBand && currentRsi >= prevRsi);
         if(shouldOpen)
         {
            double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
            double sl  = bid + InpDowntrendSL * _Point;
            double tp  = (InpDowntrendTP > 0) ? (bid - InpDowntrendTP * _Point) : 0.0;
            trade.SetExpertMagicNumber(magic);
            string cmt = StringFormat("GRID_DN_RSI_%d_%d", DnEntry[j], DnExit[j]);
            trade.Sell(InpDowntrendLot, _Symbol, bid, sl, tp, cmt);
         }
      }
   }
}

ulong FindOpenTicketByMagic(long magic)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(PositionSelectByTicket(ticket))
      {
         if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
            PositionGetInteger(POSITION_MAGIC) == magic)
            return ticket;
      }
   }
   return 0;
}

void CloseAllGridPositions()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(PositionSelectByTicket(ticket))
      {
         long magic = PositionGetInteger(POSITION_MAGIC);
         if(PositionGetString(POSITION_SYMBOL) == _Symbol && magic >= 880100 && magic <= 880300)
            trade.PositionClose(ticket);
      }
   }
}

string EscapeJsonString(string s)
{
   StringReplace(s, "\\\\", "\\\\\\\\");
   StringReplace(s, "\\"", "\\\\\\"");
   StringReplace(s, "\\r", " ");
   StringReplace(s, "\\n", " ");
   return s;
}

void SyncFullAccountToWebApp()
{
   long   login       = AccountInfoInteger(ACCOUNT_LOGIN);
   string server      = EscapeJsonString(AccountInfoString(ACCOUNT_SERVER));
   string company     = EscapeJsonString(AccountInfoString(ACCOUNT_COMPANY));
   string accName     = EscapeJsonString(AccountInfoString(ACCOUNT_NAME));
   string currency    = EscapeJsonString(AccountInfoString(ACCOUNT_CURRENCY));
   long   leverage    = AccountInfoInteger(ACCOUNT_LEVERAGE);
   double balance     = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity      = AccountInfoDouble(ACCOUNT_EQUITY);
   double floatingPnL = AccountInfoDouble(ACCOUNT_PROFIT);
   double margin      = AccountInfoDouble(ACCOUNT_MARGIN);
   double freeMargin  = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double marginLevel = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);

   double currentRsi = 0.0;
   if(rsiHandle != INVALID_HANDLE)
   {
      double rBuf[];
      ArraySetAsSeries(rBuf, true);
      if(CopyBuffer(rsiHandle, 0, 0, 1, rBuf) == 1)
         currentRsi = rBuf[0];
   }

   double chartBid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double chartAsk = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   int    chartDigits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);

   string posJson = "[";
   int totalPos = PositionsTotal();
   bool firstPos = true;
   for(int i = 0; i < totalPos; i++)
   {
      ulong posTicket = PositionGetTicket(i);
      if(!PositionSelectByTicket(posTicket)) continue;

      string sym     = EscapeJsonString(PositionGetString(POSITION_SYMBOL));
      long   pType   = PositionGetInteger(POSITION_TYPE);
      string side    = (pType == POSITION_TYPE_BUY) ? "BUY" : "SELL";
      double vol     = PositionGetDouble(POSITION_VOLUME);
      double openPr  = PositionGetDouble(POSITION_PRICE_OPEN);
      double curPr   = PositionGetDouble(POSITION_PRICE_CURRENT);
      double sl      = PositionGetDouble(POSITION_SL);
      double tp      = PositionGetDouble(POSITION_TP);
      double profit  = PositionGetDouble(POSITION_PROFIT);
      double swap    = PositionGetDouble(POSITION_SWAP);
      long   magic   = PositionGetInteger(POSITION_MAGIC);
      string comment = EscapeJsonString(PositionGetString(POSITION_COMMENT));
      datetime oTime = (datetime)PositionGetInteger(POSITION_TIME);
      string openIso = TimeToString(oTime, TIME_DATE|TIME_SECONDS);
      StringReplace(openIso, ".", "-");
      StringReplace(openIso, " ", "T");
      openIso += "Z";

      if(!firstPos) posJson += ",";
      firstPos = false;

      posJson += StringFormat(
         "{\\"ticket\\":%I64u,\\"symbol\\":\\"%s\\",\\"type\\":\\"%s\\",\\"volume\\":%.2f,\\"openPrice\\":%.5f,\\"currentPrice\\":%.5f,\\"sl\\":%.5f,\\"tp\\":%.5f,\\"profit\\":%.2f,\\"swap\\":%.2f,\\"commission\\":0.00,\\"openTime\\":\\"%s\\",\\"magicNumber\\":%I64d,\\"comment\\":\\"%s\\"}",
         posTicket, sym, side, vol, openPr, curPr, sl, tp, profit, swap, openIso, magic, comment
      );
   }
   posJson += "]";

   double totalDeposits = 0.0;
   string dealsJson = "[";
   bool firstDeal = true;

   if(HistorySelect(0, TimeCurrent()))
   {
      int totalDeals = HistoryDealsTotal();
      for(int d = 0; d < totalDeals; d++)
      {
         ulong dTicket = HistoryDealGetTicket(d);
         long dType = HistoryDealGetInteger(dTicket, DEAL_TYPE);
         if(dType == DEAL_TYPE_BALANCE || dType == DEAL_TYPE_CREDIT)
         {
            double dep = HistoryDealGetDouble(dTicket, DEAL_PROFIT);
            if(dep > 0) totalDeposits += dep;
         }
      }

      int count = 0;
      for(int k = totalDeals - 1; k >= 0 && count < InpMaxHistoryDeals; k--)
      {
         ulong dTicket = HistoryDealGetTicket(k);
         long dType  = HistoryDealGetInteger(dTicket, DEAL_TYPE);
         long dEntry = HistoryDealGetInteger(dTicket, DEAL_ENTRY);

         if((dType != DEAL_TYPE_BUY && dType != DEAL_TYPE_SELL) ||
            (dEntry != DEAL_ENTRY_OUT && dEntry != DEAL_ENTRY_INOUT))
            continue;

         string sym     = EscapeJsonString(HistoryDealGetString(dTicket, DEAL_SYMBOL));
         string side    = (dType == DEAL_TYPE_SELL) ? "BUY" : "SELL";
         double vol     = HistoryDealGetDouble(dTicket, DEAL_VOLUME);
         double closePr = HistoryDealGetDouble(dTicket, DEAL_PRICE);
         double openPr  = closePr;
         double profit  = HistoryDealGetDouble(dTicket, DEAL_PROFIT);
         double swap    = HistoryDealGetDouble(dTicket, DEAL_SWAP);
         double comm    = HistoryDealGetDouble(dTicket, DEAL_COMMISSION);
         long   magic   = HistoryDealGetInteger(dTicket, DEAL_MAGIC);
         long   posId   = HistoryDealGetInteger(dTicket, DEAL_POSITION_ID);
         string comment = EscapeJsonString(HistoryDealGetString(dTicket, DEAL_COMMENT));
         datetime cTime = (datetime)HistoryDealGetInteger(dTicket, DEAL_TIME);
         datetime oTime = cTime;

         for(int m = k - 1; m >= 0; m--)
         {
            ulong inTicket = HistoryDealGetTicket(m);
            if(HistoryDealGetInteger(inTicket, DEAL_POSITION_ID) == posId &&
               HistoryDealGetInteger(inTicket, DEAL_ENTRY) == DEAL_ENTRY_IN)
            {
               openPr = HistoryDealGetDouble(inTicket, DEAL_PRICE);
               oTime  = (datetime)HistoryDealGetInteger(inTicket, DEAL_TIME);
               comm  += HistoryDealGetDouble(inTicket, DEAL_COMMISSION);
               break;
            }
         }

         string openIso  = TimeToString(oTime, TIME_DATE|TIME_SECONDS);
         StringReplace(openIso, ".", "-");
         StringReplace(openIso, " ", "T");
         openIso += "Z";

         string closeIso = TimeToString(cTime, TIME_DATE|TIME_SECONDS);
         StringReplace(closeIso, ".", "-");
         StringReplace(closeIso, " ", "T");
         closeIso += "Z";

         if(!firstDeal) dealsJson += ",";
         firstDeal = false;
         count++;

         dealsJson += StringFormat(
            "{\\"ticket\\":%I64u,\\"symbol\\":\\"%s\\",\\"type\\":\\"%s\\",\\"volume\\":%.2f,\\"openPrice\\":%.5f,\\"closePrice\\":%.5f,\\"profit\\":%.2f,\\"swap\\":%.2f,\\"commission\\":%.2f,\\"openTime\\":\\"%s\\",\\"closeTime\\":\\"%s\\",\\"magicNumber\\":%I64d,\\"comment\\":\\"%s\\"}",
            dTicket, sym, side, vol, openPr, closePr, profit, swap, comm, openIso, closeIso, magic, comment
         );
      }
   }
   dealsJson += "]";

   if(totalDeposits <= 0.0) totalDeposits = balance;

   string fullPayload = StringFormat(
      "{\\"event\\":\\"mt5_full_sync\\",\\"ownerUserId\\":\\"%s\\",\\"login\\":%I64d,\\"server\\":\\"%s\\",\\"broker\\":\\"%s\\",\\"name\\":\\"%s\\",\\"currency\\":\\"%s\\",\\"leverage\\":%I64d,\\"initialDeposit\\":%.2f,\\"balance\\":%.2f,\\"equity\\":%.2f,\\"floatingPnL\\":%.2f,\\"margin\\":%.2f,\\"freeMargin\\":%.2f,\\"marginLevel\\":%.2f,\\"chartSymbol\\":\\"%s\\",\\"chartBid\\":%.5f,\\"chartAsk\\":%.5f,\\"chartDigits\\":%d,\\"currentRsi\\":%.2f,\\"positions\\":%s,\\"deals\\":%s}",
      InpOwnerUserId, login, server, company, accName, currency, leverage,
      totalDeposits, balance, equity, floatingPnL, margin, freeMargin, marginLevel,
      _Symbol, chartBid, chartAsk, chartDigits, currentRsi, posJson, dealsJson
   );

   int fh = FileOpen("MetaPulse_Account_Sync.json", FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(fh != INVALID_HANDLE)
   {
      FileWriteString(fh, fullPayload);
      FileClose(fh);
   }
   int fhCommon = FileOpen("MetaPulse_Account_Sync.json", FILE_WRITE|FILE_TXT|FILE_COMMON|FILE_ANSI);
   if(fhCommon != INVALID_HANDLE)
   {
      FileWriteString(fhCommon, fullPayload);
      FileClose(fhCommon);
   }

   char postData[];
   char resultData[];
   string headers = "Content-Type: application/json\\r\\n";
   StringToCharArray(fullPayload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(postData, ArraySize(postData) - 1);
   string resultHeaders;
   ResetLastError();
   int res = WebRequest("POST", InpWebhookUrl, headers, 5000, postData, resultData, resultHeaders);
   if(res == 200)
   {
      Comment(StringFormat(
         "=== MetaPulse RSI Grid & Bridge: CONNECTED (HTTP 200 OK) ===\\nOwner ID: %s | Login: #%I64d | RSI: %.1f\\nReal Balance: $%.2f | Real Equity: $%.2f | Open Orders: %d\\nLast Sync: %s",
         InpOwnerUserId, login, currentRsi, balance, equity, totalPos, TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS)
      ));
   }
   else
   {
      int err = GetLastError();
      string errHint = (err == 4014)
         ? "Add URL in Tools -> Options -> Expert Advisors -> Allow WebRequest"
         : "Check internet or URL in EA Inputs";
      Comment(StringFormat(
         "=== MetaPulse Bridge: DISCONNECTED (HTTP %d | Error %d) ===\\nFix: %s\\nRequired URL: %s",
         res, err, errHint, InpWebhookUrl
      ));
      PrintFormat("MetaPulse_RSI_Grid_EA WebRequest Failed: HTTP=%d, MQL5 Error=%d (%s) URL=%s", res, err, errHint, InpWebhookUrl);
   }
}`;

  const handleCopyEa = () => {
    navigator.clipboard.writeText(mql5GridCode);
    setCopiedEa(true);
    setTimeout(() => setCopiedEa(false), 2000);
  };

  const renderTierRow = (tier: RsiGridTier, idx: number) => {
    const isActive = tier.activeTicket !== null;
    const activePos = getActivePositionForTicket(tier.activeTicket);
    const floatingPnL = activePos ? activePos.profit : null;
    const digits = activeQuote ? activeQuote.digits : 2;
    const liveExecPrice = activeQuote
      ? tier.side === 'BUY'
        ? activeQuote.ask
        : activeQuote.bid
      : 0;

    const isRsiInEntryZone =
      entryTriggerMode === 'EXACT_LEVEL_CROSS'
        ? Math.floor(gridConfig.currentRsi) === tier.entryRsi
        : tier.trend === 'UPTREND'
        ? gridConfig.currentRsi >= tier.entryRsi && gridConfig.currentRsi < tier.exitRsi
        : gridConfig.currentRsi <= tier.entryRsi && gridConfig.currentRsi > tier.exitRsi;

    const exitLabel =
      tier.trend === 'UPTREND' ? `RSI=>${tier.exitRsi}.x` : `RSI<=${tier.exitRsi}.x`;

    return (
      <tr
        key={tier.id}
        className={`transition-colors ${
          isActive
            ? 'bg-blue-950/30 hover:bg-blue-950/50'
            : isRsiInEntryZone
            ? 'bg-[#1E293B]/35 hover:bg-[#1E293B]/50'
            : 'hover:bg-[#1E293B]/25'
        }`}
      >
        <td className="py-2.5 px-3 text-slate-400">#{idx + 1}</td>
        <td className="py-2.5 px-3 font-semibold text-slate-100">
          <span className="text-blue-400">RSI={tier.entryRsi}.x</span>
        </td>
        <td className="py-2.5 px-3 font-semibold text-slate-100">
          <span className="text-amber-400">{exitLabel}</span>
        </td>
        <td className="py-2.5 px-3 text-right text-slate-200">
          {activePos ? (
            <span className="text-slate-100">
              {activePos.openPrice.toFixed(digits)} →{' '}
              <span className="text-blue-400 font-semibold">
                {activePos.currentPrice.toFixed(digits)}
              </span>
            </span>
          ) : (
            <span className="text-slate-300">{liveExecPrice.toFixed(digits)}</span>
          )}
        </td>
        <td className="py-2.5 px-3 text-right text-slate-200">{tier.lotSize.toFixed(2)}</td>
        <td className="py-2.5 px-3 text-right text-slate-300">
          {tier.slPoints} /{' '}
          <span className="text-emerald-400">
            {(tier.tpPoints ?? 0) > 0 ? `${tier.tpPoints}` : exitLabel}
          </span>
        </td>
        <td className="py-2.5 px-3">
          {isActive ? (
            <span className="text-emerald-400 font-semibold">
              ACTIVE #{tier.activeTicket}
              {floatingPnL !== null && (
                <span className="ml-1.5 text-slate-200">
                  ({floatingPnL >= 0 ? '+' : '-'}${Math.abs(floatingPnL).toFixed(2)})
                </span>
              )}
            </span>
          ) : (
            <span className="text-slate-400">
              WAITING · {tier.triggeredCount}x ({tier.realizedPnL >= 0 ? '+' : '-'}$
              {Math.abs(tier.realizedPnL).toFixed(2)})
            </span>
          )}
        </td>
        <td className="py-2.5 px-3 text-right">
          {isActive ? (
            <button
              type="button"
              onClick={() => onManualTierAction(tier.id, 'CLOSE')}
              className="px-2.5 py-1 text-[11px] font-sans font-medium bg-rose-950/70 hover:bg-rose-900 text-rose-300 border border-rose-500/30 rounded transition-colors whitespace-nowrap"
            >
              Exit ({exitLabel})
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onManualTierAction(tier.id, 'OPEN')}
              className="px-2.5 py-1 text-[11px] font-sans font-medium bg-[#0B0F17] hover:bg-[#1E293B] text-slate-200 border border-[#1E293B] rounded transition-colors whitespace-nowrap"
            >
              {tier.side} {tier.lotSize.toFixed(2)}
            </button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Control Header: Trend Mode, Symbol, Auto-Grid Toggle & Live RSI Simulator */}
      <section className="border border-[#1E293B] bg-[#111827] p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#1E293B]">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              RSI Grid Order Engine — Automated Buy (0.01 Lot) & Sell (0.01 Lot)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Executes exact decimal RSI=XX.x Entry & RSI=&gt; / RSI&lt;= Exit grid orders with SL: 3000 points in real time
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Trend Mode Segmented Control */}
            <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-[#1E293B] rounded-lg">
              {(['UPTREND', 'DOWNTREND', 'BOTH'] as GridTrendMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onUpdateConfig({ trendMode: mode, accountId: account.id })}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    gridConfig.trendMode === mode
                      ? 'bg-[#1E293B] text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {mode === 'UPTREND'
                    ? 'Uptrend (Buy Start)'
                    : mode === 'DOWNTREND'
                    ? 'Downtrend (Sell Start)'
                    : 'Both Trends'}
                </button>
              ))}
            </div>

            {/* Timeframe Selector (M1, M5, M15, M30, H1, H4, D1) */}
            <div className="flex items-center gap-0.5 p-1 bg-[#0B0F17] border border-[#1E293B] rounded-lg">
              {MT5_TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => onUpdateConfig({ timeframe: tf, accountId: account.id })}
                  className={`px-2.5 py-1.5 text-xs font-mono font-medium rounded transition-colors ${
                    activeTf === tf
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            {/* RSI Period Selector */}
            <select
              value={activeRsiPeriod}
              onChange={(e) =>
                onUpdateConfig({ rsiPeriod: parseInt(e.target.value, 10) || 14, accountId: account.id })
              }
              className="px-2.5 py-2 bg-[#0B0F17] border border-[#1E293B] text-xs font-mono text-slate-100 rounded-lg"
            >
              <option value="5">RSI (5) Fast</option>
              <option value="7">RSI (7) Scalping</option>
              <option value="9">RSI (9) Intraday</option>
              <option value="14">RSI (14) Standard</option>
            </select>

            {/* Symbol Selector */}
            <select
              value={gridConfig.symbol}
              onChange={(e) =>
                onUpdateConfig({ symbol: e.target.value, accountId: account.id })
              }
              className="px-3 py-2 bg-[#0B0F17] border border-[#1E293B] text-xs font-mono text-slate-100 rounded-lg"
            >
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            {/* Enable / Pause Auto Grid */}
            <button
              type="button"
              onClick={() =>
                onUpdateConfig({ enabled: !gridConfig.enabled, accountId: account.id })
              }
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                gridConfig.enabled
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-[#0B0F17] border border-[#1E293B] text-slate-300 hover:bg-[#1E293B]'
              }`}
            >
              {gridConfig.enabled ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  Auto-Grid Active
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  Enable Auto-Grid
                </>
              )}
            </button>
          </div>
        </div>

        {/* Interactive Live RSI Oscillator & Current Market Price Bar */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-center">
          <div className="xl:col-span-5 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs text-slate-400">
                Live RSI ({activeRsiPeriod}) ·{' '}
                <span className="font-mono text-blue-400 font-semibold">{activeTf}</span> ·{' '}
                <span className="font-mono text-slate-100 font-semibold">{gridConfig.symbol}</span>
                {activeQuote && (
                  <span className="ml-2 font-mono text-slate-300">
                    Bid:{' '}
                    <span className="text-rose-400 font-semibold">
                      {activeQuote.bid.toFixed(activeQuote.digits)}
                    </span>{' '}
                    / Ask:{' '}
                    <span className="text-emerald-400 font-semibold">
                      {activeQuote.ask.toFixed(activeQuote.digits)}
                    </span>{' '}
                    <span className="text-slate-500">({activeQuote.spreadPips}p)</span>
                  </span>
                )}
              </span>
              <span className="text-xl font-bold font-mono tabular-nums text-blue-400">
                RSI {gridConfig.currentRsi.toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="99"
              step="0.5"
              value={gridConfig.currentRsi}
              onChange={(e) => onSetRsi(parseFloat(e.target.value))}
              className="w-full accent-blue-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>RSI 5 (Buy Start)</span>
              <span>RSI 30</span>
              <span>RSI 50 (Neutral)</span>
              <span>RSI 70</span>
              <span>RSI 90 (Sell Start)</span>
            </div>
          </div>

          <div className="xl:col-span-7 space-y-2">
            <div className="text-xs text-slate-400">
              Jump RSI to exact Grid Entry / Exit Threshold (fires matching tier over WebSocket):
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {QUICK_RSI_LEVELS.map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => onSetRsi(lvl)}
                  className={`px-2.5 py-1.5 text-xs font-mono rounded border transition-colors ${
                    Math.abs(gridConfig.currentRsi - lvl) < 2.5
                      ? 'bg-blue-600 border-blue-500 text-white font-semibold'
                      : 'bg-[#0B0F17] border-[#1E293B] text-slate-300 hover:bg-[#1E293B]'
                  }`}
                >
                  RSI {lvl}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Stop Auto-Grid when PnL = 50% Circuit Breaker Control Bar */}
        <div className="pt-4 border-t border-[#1E293B] flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="text-xs">
              <span className="text-slate-400">PnL Auto-Stop Guard:</span>{' '}
              <span className="font-mono font-semibold text-amber-400">
                Stop Auto-Grid @ PnL = ±{maxPnlStopPct}%
              </span>
              <span className="text-slate-500 mx-2">·</span>
              <span className="text-slate-400">Current Total PnL:</span>{' '}
              <span
                className={`font-mono font-semibold ${
                  accountTotalPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {accountTotalPnlPct >= 0 ? '+' : ''}
                {accountTotalPnlPct.toFixed(2)}%
              </span>
              <span className="text-slate-500 mx-2">·</span>
              <span className="text-slate-400">Floating PnL:</span>{' '}
              <span
                className={`font-mono ${
                  floatingPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {floatingPnlPct >= 0 ? '+' : ''}
                {floatingPnlPct.toFixed(2)}%
              </span>
            </div>

            {gridConfig.stoppedByPnlGuard && gridConfig.stoppedReason && (
              <span className="text-xs font-mono text-rose-400 font-semibold">
                [{gridConfig.stoppedReason}]
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-1.5 text-slate-300 font-mono">
              Entry Trigger:
              <select
                value={entryTriggerMode}
                onChange={(e) =>
                  onUpdateConfig({
                    entryTriggerMode: e.target.value as GridEntryTriggerMode,
                    accountId: account.id,
                  })
                }
                className="px-2 py-1 bg-[#0B0F17] border border-[#1E293B] text-slate-100 rounded"
              >
                <option value="EXACT_LEVEL_CROSS">Exact Decimal RSI=XX.x (e.g. RSI=30.x → RSI=&gt;40.x)</option>
                <option value="BAND_RANGE">Band Range [Entry..Exit) (41→39 Opens Buy #4)</option>
                <option value="DIRECTIONAL_CROSS">Rising Only for Buy / Falling for Sell</option>
                <option value="PULLBACK_CROSS">Pullback Dip Only for Buy (41→39)</option>
              </select>
            </label>

            <label className="flex items-center gap-1.5 text-slate-300 font-mono">
              Stop PnL (%):
              <input
                type="number"
                step="5"
                min="1"
                max="500"
                value={maxPnlStopPct}
                onChange={(e) =>
                  onUpdateConfig({
                    maxPnlStopPct: Math.max(1, parseFloat(e.target.value) || 50),
                    accountId: account.id,
                  })
                }
                className="w-16 px-2 py-1 bg-[#0B0F17] border border-[#1E293B] text-amber-400 text-right font-semibold"
              />
            </label>

            <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={closeAllOnStop}
                onChange={(e) =>
                  onUpdateConfig({
                    closeAllOnStop: e.target.checked,
                    accountId: account.id,
                  })
                }
                className="accent-blue-600"
              />
              Close all grid trades when PnL = {maxPnlStopPct}%
            </label>
          </div>
        </div>
      </section>

      {/* Live Synchronized Price & RSI Line Chart */}
      <PriceRsiChart
        symbol={gridConfig.symbol}
        timeframe={activeTf}
        rsiPeriod={activeRsiPeriod}
        quote={activeQuote}
        currentRsi={gridConfig.currentRsi}
        positions={account.positions}
      />

      {/* Side-by-Side Uptrend (9 Tiers) & Downtrend (9 Tiers) Grid Tables */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* UPTREND BUY START TABLE */}
        <section className="xl:col-span-6 border border-[#1E293B] bg-[#111827] flex flex-col justify-between">
          <div>
            <div className="px-5 py-4 border-b border-[#1E293B] flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs text-emerald-400 font-mono">
                  Uptrend Condition · Buy Start
                </div>
                <h3 className="text-base font-semibold text-slate-100 mt-0.5">
                  Uptrend Buy Grid (9 RSI Levels)
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                <label className="flex items-center gap-1 text-slate-400">
                  Lot:
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={gridConfig.uptrendLotSize}
                    onChange={(e) =>
                      onUpdateConfig({
                        uptrendLotSize: parseFloat(e.target.value) || 0.01,
                      })
                    }
                    className="w-14 px-1.5 py-1 bg-[#0B0F17] border border-[#1E293B] text-slate-100 text-right"
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-400">
                  SL:
                  <input
                    type="number"
                    step="100"
                    min="50"
                    value={gridConfig.uptrendSlPoints}
                    onChange={(e) =>
                      onUpdateConfig({
                        uptrendSlPoints: parseInt(e.target.value, 10) || 3000,
                      })
                    }
                    className="w-16 px-1.5 py-1 bg-[#0B0F17] border border-[#1E293B] text-slate-100 text-right"
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-400" title="0 = Dynamic RSI EXIT Level only">
                  TP (Pts):
                  <input
                    type="number"
                    step="100"
                    min="0"
                    value={upTp}
                    onChange={(e) =>
                      onUpdateConfig({
                        uptrendTpPoints: Math.max(0, parseInt(e.target.value, 10) || 0),
                      })
                    }
                    className="w-16 px-1.5 py-1 bg-[#0B0F17] border border-[#1E293B] text-emerald-400 text-right"
                  />
                </label>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#1E293B] text-[11px] text-slate-400">
                    <th className="py-2.5 px-3 font-medium">Tier</th>
                    <th className="py-2.5 px-3 font-medium">Buy Entry</th>
                    <th className="py-2.5 px-3 font-medium">TP (RSI Exit)</th>
                    <th className="py-2.5 px-3 font-medium text-right">Current Price</th>
                    <th className="py-2.5 px-3 font-medium text-right">Lot Size</th>
                    <th className="py-2.5 px-3 font-medium text-right">SL / TP</th>
                    <th className="py-2.5 px-3 font-medium">Status / Realized</th>
                    <th className="py-2.5 px-3 font-medium text-right">Manual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E293B] text-xs font-mono tabular-nums">
                  {gridConfig.uptrendTiers.map((t, i) => renderTierRow(t, i))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="px-5 py-3 border-t border-[#1E293B] text-xs text-slate-400 flex items-center justify-between">
            <span>Rule: Buy Entry (RSI=5.x..80.x) → TP (RSI=&gt;10.x..90.x)</span>
            <span className="font-mono text-emerald-400">
              Lot = {gridConfig.uptrendLotSize.toFixed(2)} · SL = {gridConfig.uptrendSlPoints}
            </span>
          </div>
        </section>

        {/* DOWNTREND SELL START TABLE */}
        <section className="xl:col-span-6 border border-[#1E293B] bg-[#111827] flex flex-col justify-between">
          <div>
            <div className="px-5 py-4 border-b border-[#1E293B] flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs text-rose-400 font-mono">
                  Downtrend Condition · Sell Start
                </div>
                <h3 className="text-base font-semibold text-slate-100 mt-0.5">
                  Downtrend Sell Grid (9 RSI Levels)
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                <label className="flex items-center gap-1 text-slate-400">
                  Lot:
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={gridConfig.downtrendLotSize}
                    onChange={(e) =>
                      onUpdateConfig({
                        downtrendLotSize: parseFloat(e.target.value) || 0.01,
                      })
                    }
                    className="w-14 px-1.5 py-1 bg-[#0B0F17] border border-[#1E293B] text-slate-100 text-right"
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-400">
                  SL:
                  <input
                    type="number"
                    step="100"
                    min="50"
                    value={gridConfig.downtrendSlPoints}
                    onChange={(e) =>
                      onUpdateConfig({
                        downtrendSlPoints: parseInt(e.target.value, 10) || 3000,
                      })
                    }
                    className="w-16 px-1.5 py-1 bg-[#0B0F17] border border-[#1E293B] text-slate-100 text-right"
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-400" title="0 = Dynamic RSI EXIT Level only">
                  TP (Pts):
                  <input
                    type="number"
                    step="100"
                    min="0"
                    value={dnTp}
                    onChange={(e) =>
                      onUpdateConfig({
                        downtrendTpPoints: Math.max(0, parseInt(e.target.value, 10) || 0),
                      })
                    }
                    className="w-16 px-1.5 py-1 bg-[#0B0F17] border border-[#1E293B] text-emerald-400 text-right"
                  />
                </label>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#1E293B] text-[11px] text-slate-400">
                    <th className="py-2.5 px-3 font-medium">Tier</th>
                    <th className="py-2.5 px-3 font-medium">Sell Entry</th>
                    <th className="py-2.5 px-3 font-medium">TP (RSI Exit)</th>
                    <th className="py-2.5 px-3 font-medium text-right">Current Price</th>
                    <th className="py-2.5 px-3 font-medium text-right">Lot Size</th>
                    <th className="py-2.5 px-3 font-medium text-right">SL / TP</th>
                    <th className="py-2.5 px-3 font-medium">Status / Realized</th>
                    <th className="py-2.5 px-3 font-medium text-right">Manual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E293B] text-xs font-mono tabular-nums">
                  {gridConfig.downtrendTiers.map((t, i) => renderTierRow(t, i))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="px-5 py-3 border-t border-[#1E293B] text-xs text-slate-400 flex items-center justify-between">
            <span>Rule: Sell Entry (RSI=90.x..10.x) → TP (RSI&lt;=80.x..5.x)</span>
            <span className="font-mono text-rose-400">
              Lot = {gridConfig.downtrendLotSize.toFixed(2)} · SL = {gridConfig.downtrendSlPoints}
            </span>
          </div>
        </section>
      </div>

      {/* Ready-to-Compile MQL5 Grid EA Code */}
      <section className="border border-[#1E293B] bg-[#111827] p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#1E293B]">
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              MQL5 Expert Advisor Code — <span className="font-mono">MetaPulse_RSI_Grid_EA.mq5</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Ready-to-compile MT5 Expert Advisor implementing your exact Buy (0.01 lot, SL 3000) & Sell (0.01 lot, SL 3000) RSI=XX.x Grid levels
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopyEa}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors whitespace-nowrap"
          >
            {copiedEa ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedEa ? 'Copied MQL5 Grid EA' : 'Copy MQL5 Grid EA Code'}
          </button>
        </div>

        <pre className="p-4 bg-[#0B0F17] border border-[#1E293B] text-[11px] leading-relaxed font-mono text-slate-300 overflow-x-auto max-h-80">
          {mql5GridCode}
        </pre>
      </section>
    </div>
  );
};
