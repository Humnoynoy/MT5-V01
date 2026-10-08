import React, { useState, useRef, useEffect } from 'react';
import { Copy, Check, Upload, Download, FolderSync, RefreshCw } from 'lucide-react';
import type { Mt5Account, Mt5Deal } from '../types/mt5';

interface Mt5BridgeModalProps {
  account: Mt5Account;
  onImportDeals: (deals: Array<Partial<Mt5Deal>>) => void;
  isLiveFilePolling?: boolean;
  fileSyncStatus?: string | null;
  onLinkLocalMt5File?: () => void;
  proxyCookie?: string;
}

export const Mt5BridgeModal: React.FC<Mt5BridgeModalProps> = ({
  account,
  onImportDeals,
  isLiveFilePolling: externalPolling,
  fileSyncStatus: externalStatus,
  onLinkLocalMt5File,
  proxyCookie = '',
}) => {
  const [copied, setCopied] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedPs, setCopiedPs] = useState(false);
  const [csvInput, setCsvInput] = useState('');
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [localFileSyncStatus, setLocalFileSyncStatus] = useState<string | null>(null);
  const [localPolling, setLocalPolling] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileHandleRef = useRef<any>(null);
  const lastFileModifiedRef = useRef<number>(0);

  const isBridgeConnected = Boolean(account.webhookSyncCount && account.webhookSyncCount > 0);
  const isLiveFilePolling = externalPolling ?? (localPolling || isBridgeConnected);
  const fileSyncStatus = externalStatus ?? localFileSyncStatus;

  const detectedLocalFilePath =
    'C:\\Users\\phokham\\AppData\\Roaming\\MetaQuotes\\Terminal\\D0E8209F77C8CF37AD8BF550E51FF075\\MQL5\\Files\\MetaPulse_Account_Sync.json';

  const handleCopyFilePath = () => {
    navigator.clipboard.writeText(detectedLocalFilePath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2500);
  };

  const publicOrigin = window.location.origin.replace('https://ais-dev-', 'https://ais-pre-');
  const devOrigin = window.location.origin.replace('https://ais-pre-', 'https://ais-dev-');
  const webhookUrl = `${publicOrigin}/api/mt5/webhook`;
  const devWebhookUrl = `${devOrigin}/api/mt5/webhook`;
  const escapedCookie = proxyCookie.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const detectedCmdFilePath =
    'C:\\Users\\phokham\\AppData\\Roaming\\MetaQuotes\\Terminal\\D0E8209F77C8CF37AD8BF550E51FF075\\MQL5\\Files\\MetaPulse_Commands.txt';

  const psScript = `while($true){ try { $f="${detectedLocalFilePath}"; $cmdFile="${detectedCmdFilePath}"; if(Test-Path $f){ $j=Get-Content $f -Raw; $r=Invoke-RestMethod -Uri "${window.location.origin}/api/mt5/webhook" -Method Post -ContentType "application/json" -Headers @{Cookie="${proxyCookie}"} -Body $j; if($r.cmdString -and $r.cmdString.Length -gt 0){ Set-Content -Path $cmdFile -Value $r.cmdString -Encoding ASCII; Write-Host "Dispatched Web Order to MT5: $($r.cmdString)" -ForegroundColor Cyan }; Write-Host "Live 2s Auto-Sync OK: $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Green } } catch {} Start-Sleep -Seconds 2 }`;

  const handleCopyPsScript = () => {
    navigator.clipboard.writeText(psScript);
    setCopiedPs(true);
    setTimeout(() => setCopiedPs(false), 2500);
  };

  const handleDownloadBatBridge = () => {
    const batContent = `@echo off
title MetaPulse MT5 2-Second Bi-Directional Live Sync & Order Bridge
echo ====================================================================
echo   MetaPulse MT5 Live 2-Second Sync + Web Order Execution (#${account.login})
echo   Reading Telemetry: ${detectedLocalFilePath}
echo   Writing Web Orders: ${detectedCmdFilePath}
echo   Sending to: ${window.location.origin}/api/mt5/webhook
echo ====================================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "while($true){ try { $f='${detectedLocalFilePath}'; $cmdFile='${detectedCmdFilePath}'; $dl=Join-Path $env:USERPROFILE 'Downloads\\MetaPulse_Account_Sync.json'; if(Test-Path $f){ Copy-Item $f $dl -Force -ErrorAction SilentlyContinue; $j=Get-Content $f -Raw -Encoding UTF8; $r=Invoke-RestMethod -Uri '${window.location.origin}/api/mt5/webhook' -Method Post -ContentType 'application/json' -Headers @{Cookie='${proxyCookie}'} -Body $j; if($r.cmdString -and $r.cmdString.Length -gt 0){ Set-Content -Path $cmdFile -Value $r.cmdString -Encoding ASCII; Write-Host ('[WEB ORDER SENT TO MT5] ' + $r.cmdString) -ForegroundColor Cyan }; Write-Host ('[MetaPulse 2s Sync OK] Real MT5 Data synced at ' + (Get-Date -Format 'HH:mm:ss')) -ForegroundColor Green } else { Write-Host 'Waiting for MT5 EA file...' -ForegroundColor Yellow } } catch { Write-Host ('Sync retry: ' + $_.Exception.Message) -ForegroundColor Red } Start-Sleep -Seconds 2 }"
pause
`;
    const blob = new Blob([batContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Start_MetaPulse_2s_Sync.bat';
    a.click();
    URL.revokeObjectURL(url);
  };

  const pushJsonToWebhook = async (rawText: string) => {
    try {
      const cleaned = rawText.trim().replace(/\0/g, '');
      if (!cleaned) return;
      const parsed = JSON.parse(cleaned);
      // Force current logged-in ownerUserId and accountId if needed
      parsed.ownerUserId = account.ownerUserId || parsed.ownerUserId || 'Sosaka';
      const res = await fetch('/api/mt5/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      if (res.ok) {
        setLocalFileSyncStatus(
          `Synced real MT5 data (#${parsed.login || account.login}) · Balance: $${Number(parsed.balance || 0).toFixed(2)} · Open Orders: ${Array.isArray(parsed.positions) ? parsed.positions.length : 0} · History: ${Array.isArray(parsed.deals) ? parsed.deals.length : 0}`
        );
      }
    } catch (err) {
      setLocalFileSyncStatus('Waiting for valid JSON in MetaPulse_Account_Sync.json...');
    }
  };

  useEffect(() => {
    if (!localPolling) return;
    const timer = setInterval(async () => {
      if (!fileHandleRef.current) return;
      try {
        const file: File = await fileHandleRef.current.getFile();
        if (file.lastModified !== lastFileModifiedRef.current) {
          lastFileModifiedRef.current = file.lastModified;
          const text = await file.text();
          await pushJsonToWebhook(text);
        }
      } catch {
        // Ignore transient lock while MT5 writes
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [localPolling, account.ownerUserId, account.id]);

  const handleLinkLocalMt5File = () => {
    if (onLinkLocalMt5File) {
      onLinkLocalMt5File();
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await pushJsonToWebhook(text);
    setLocalPolling(true);
    e.target.value = '';
  };

  const mql5Code = `//+------------------------------------------------------------------+
//|                                            MetaPulseSyncEA.mq5   |
//|     Real-Time MT5 Balance, Open Positions & Web Order Execution  |
//+------------------------------------------------------------------+
#property copyright "MetaPulse MT5 Analytics"
#property version   "3.50"
#property strict

#include <Trade\\Trade.mqh>

input string InpWebhookUrl     = "${webhookUrl}";
input string InpWebhookUrlAlt  = "${devWebhookUrl}";
input string InpProxyCookie    = "${escapedCookie}"; // Cloud Run Auth Cookie
input string InpOwnerUserId    = "${account.ownerUserId || 'Sosaka1'}"; // Dashboard Owner User ID
input int    InpSyncIntervalSec = 2;  // Live Sync Interval (Seconds)
input int    InpMaxHistoryDeals = 100; // Max Closed History Deals to Sync

CTrade trade;
int    rsiHandle = INVALID_HANDLE;
string lastExecResult = "";

int OnInit()
{
   trade.SetExpertMagicNumber(401002);
   trade.SetDeviationInPoints(30);
   rsiHandle = iRSI(_Symbol, PERIOD_M5, 14, PRICE_CLOSE);
   EventSetTimer(MathMax(1, InpSyncIntervalSec));
   ProcessPendingWebCommands();
   SyncFullAccountToWebApp();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   ProcessPendingWebCommands();
   SyncFullAccountToWebApp();
}

void ExecuteSingleCommandLine(string line)
{
   StringTrimLeft(line);
   StringTrimRight(line);
   if(StringLen(line) < 5 || StringFind(line, "CMD|") != 0) return;

   string parts[];
   int n = StringSplit(line, '|', parts);
   if(n < 9) return;

   string action  = parts[2];
   string sym     = parts[3];
   string side    = parts[4];
   double vol     = StringToDouble(parts[5]);
   double sl      = StringToDouble(parts[6]);
   double tp      = StringToDouble(parts[7]);
   ulong  ticket  = (ulong)StringToInteger(parts[8]);
   string comment = (n >= 10) ? parts[9] : "MT5_WebOrder";

   // Match broker symbol suffix if needed (e.g., XAUUSD -> XAUUSD.pc on current chart)
   if(!SymbolSelect(sym, true))
   {
      if(StringFind(_Symbol, sym) == 0)
         sym = _Symbol;
   }

   if(action == "OPEN")
   {
      bool ok = false;
      if(side == "BUY")
         ok = trade.Buy(vol, sym, 0.0, sl, tp, comment);
      else
         ok = trade.Sell(vol, sym, 0.0, sl, tp, comment);

      uint ret = trade.ResultRetcode();
      string desc = trade.ResultRetcodeDescription();
      if(ok && (ret == TRADE_RETCODE_DONE || ret == TRADE_RETCODE_PLACED))
      {
         lastExecResult = StringFormat("EXECUTED %s %.2f %s (#%I64u)", side, vol, sym, trade.ResultOrder());
         Print("[MetaPulse WebOrder] ", lastExecResult);
      }
      else
      {
         lastExecResult = StringFormat("REJECTED %s %.2f %s — Retcode %u (%s) [Check Algo Trading / Free Margin]", side, vol, sym, ret, desc);
         Print("[MetaPulse WebOrder] ", lastExecResult);
      }
   }
   else if(action == "CLOSE" && ticket > 0)
   {
      if(PositionSelectByTicket(ticket))
      {
         if(trade.PositionClose(ticket))
            lastExecResult = StringFormat("CLOSED Ticket #%I64u", ticket);
         else
            lastExecResult = StringFormat("CLOSE FAILED #%I64u (%s)", ticket, trade.ResultRetcodeDescription());
      }
   }
}

void ProcessPendingWebCommands()
{
   if(FileIsExist("MetaPulse_Commands.txt"))
   {
      int ch = FileOpen("MetaPulse_Commands.txt", FILE_READ|FILE_TXT|FILE_ANSI);
      if(ch != INVALID_HANDLE)
      {
         while(!FileIsEnding(ch))
         {
            string line = FileReadString(ch);
            ExecuteSingleCommandLine(line);
         }
         FileClose(ch);
         FileDelete("MetaPulse_Commands.txt");
      }
   }
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

   // 1. Build Real Open Positions JSON Array
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

   // 2. Build Real Closed History Deals JSON Array & Calculate Real Initial Deposit
   double totalDeposits = 0.0;
   string dealsJson = "[";
   bool firstDeal = true;

   if(HistorySelect(0, TimeCurrent()))
   {
      int totalDeals = HistoryDealsTotal();
      // First pass: sum deposits (DEAL_TYPE_BALANCE / DEAL_TYPE_CREDIT)
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

      // Second pass: collect up to InpMaxHistoryDeals most recent closed trades (DEAL_ENTRY_OUT / DEAL_ENTRY_INOUT)
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
         // Closing deal of a BUY position is DEAL_TYPE_SELL; closing deal of a SELL position is DEAL_TYPE_BUY
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

         // Find matching entry deal for exact openPrice and openTime
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

   string execMsg = EscapeJsonString(lastExecResult);
   lastExecResult = "";

   string fullPayload = StringFormat(
      "{\\"event\\":\\"mt5_full_sync\\",\\"ownerUserId\\":\\"%s\\",\\"login\\":%I64d,\\"server\\":\\"%s\\",\\"broker\\":\\"%s\\",\\"name\\":\\"%s\\",\\"currency\\":\\"%s\\",\\"leverage\\":%I64d,\\"initialDeposit\\":%.2f,\\"balance\\":%.2f,\\"equity\\":%.2f,\\"floatingPnL\\":%.2f,\\"margin\\":%.2f,\\"freeMargin\\":%.2f,\\"marginLevel\\":%.2f,\\"chartSymbol\\":\\"%s\\",\\"chartBid\\":%.5f,\\"chartAsk\\":%.5f,\\"chartDigits\\":%d,\\"currentRsi\\":%.2f,\\"lastExecResult\\":\\"%s\\",\\"positions\\":%s,\\"deals\\":%s}",
      InpOwnerUserId, login, server, company, accName, currency, leverage,
      totalDeposits, balance, equity, floatingPnL, margin, freeMargin, marginLevel,
      _Symbol, chartBid, chartAsk, chartDigits, currentRsi, execMsg, posJson, dealsJson
   );

   SendToWebApp(fullPayload, login, balance, equity, totalPos);
}

void SendToWebApp(string jsonPayload, long login, double balance, double equity, int openOrders)
{
   // 1. Always write real-time JSON snapshot to MQL5\\Files\\MetaPulse_Account_Sync.json (works 100% offline/online without URL rules)
   int fh = FileOpen("MetaPulse_Account_Sync.json", FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(fh != INVALID_HANDLE)
   {
      FileWriteString(fh, jsonPayload);
      FileClose(fh);
   }
   int fhCommon = FileOpen("MetaPulse_Account_Sync.json", FILE_WRITE|FILE_TXT|FILE_COMMON|FILE_ANSI);
   if(fhCommon != INVALID_HANDLE)
   {
      FileWriteString(fhCommon, jsonPayload);
      FileClose(fhCommon);
   }

   // 2. Also send via HTTP WebRequest if URL is allowed
   char postData[];
   char resultData[];
   string headers = "Content-Type: application/json\\r\\n";
   if(StringLen(InpProxyCookie) > 0)
      headers += "Cookie: " + InpProxyCookie + "\\r\\n";
   StringToCharArray(jsonPayload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(postData, ArraySize(postData) - 1);
   string resultHeaders;
   ResetLastError();
   int res = WebRequest("POST", InpWebhookUrl, headers, 4000, postData, resultData, resultHeaders);
   if(res != 200 && StringLen(InpWebhookUrlAlt) > 0 && InpWebhookUrlAlt != InpWebhookUrl)
   {
      ResetLastError();
      res = WebRequest("POST", InpWebhookUrlAlt, headers, 4000, postData, resultData, resultHeaders);
   }
   string dataPath = TerminalInfoString(TERMINAL_DATA_PATH) + "\\\\MQL5\\\\Files\\\\MetaPulse_Account_Sync.json";
   if(res == 200)
   {
      string respStr = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
      int cmdPos = StringFind(respStr, "CMD|");
      if(cmdPos >= 0)
      {
         string sub = StringSubstr(respStr, cmdPos);
         int endQuote = StringFind(sub, "\\"");
         if(endQuote > 0) sub = StringSubstr(sub, 0, endQuote);
         StringReplace(sub, "\\\\n", "\\n");
         string lines[];
         int cnt = StringSplit(sub, '\\n', lines);
         for(int c = 0; c < cnt; c++)
            ExecuteSingleCommandLine(lines[c]);
      }
      Comment(StringFormat(
         "=== MetaPulse MT5 Bridge: CONNECTED (HTTP 200 OK) ===\\nOwner ID: %s | Login: #%I64d\\nReal Balance: $%.2f | Real Equity: $%.2f | Open Orders: %d\\nLast Sync: %s",
         InpOwnerUserId, login, balance, equity, openOrders, TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS)
      ));
   }
   else
   {
      int err = GetLastError();
      Comment(StringFormat(
         "=== MetaPulse Local Sync File ACTIVE (Updated %s) ===\\nOwner ID: %s | Login: #%I64d | Balance: $%.2f | Equity: $%.2f | Open Orders: %d\\nLocal Sync File: %s\\n(WebRequest HTTP=%d, Error=%d — Use 'Sync Local MT5 File' button in Dashboard or Share App)",
         TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS), InpOwnerUserId, login, balance, equity, openOrders, dataPath, res, err
      ));
   }
}`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(mql5Code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadCode = () => {
    const blob = new Blob([mql5Code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'MetaPulseSyncEA.mq5';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleParseCsvImport = () => {
    const lines = csvInput
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const parsed: Array<Partial<Mt5Deal>> = [];
    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim());
      if (parts.length < 7) continue;
      const [ticketStr, symbol, sideStr, volStr, openStr, closeStr, profitStr, commStr, swapStr, pipsStr, comment] =
        parts;
      parsed.push({
        ticket: Number(ticketStr) || undefined,
        symbol: symbol.toUpperCase(),
        type: sideStr.toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
        volume: Number(volStr) || 0.01,
        openPrice: Number(openStr) || 0,
        closePrice: Number(closeStr) || 0,
        profit: Number(profitStr) || 0,
        commission: Number(commStr) || 0,
        swap: Number(swapStr) || 0,
        pips: Number(pipsStr) || 0,
        comment: comment || 'MT5_CSV_Import',
        closeTime: new Date().toISOString(),
      });
    }

    if (parsed.length > 0) {
      onImportDeals(parsed);
      setImportNotice(`Synced ${parsed.length} real MT5 deal record(s) over WebSocket.`);
      setTimeout(() => setImportNotice(null), 4000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Live Bridge Status Diagnostic Banner */}
      <section
        className={`border p-4 flex flex-wrap items-center justify-between gap-4 ${
          isBridgeConnected
            ? 'border-emerald-500/40 bg-emerald-950/20'
            : 'border-amber-500/40 bg-amber-950/20'
        }`}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                isBridgeConnected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
              }`}
            />
            <span
              className={`text-xs font-mono font-semibold uppercase tracking-wider ${
                isBridgeConnected ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {isBridgeConnected
                ? `BRIDGE ACTIVE — Receiving Real MT5 Data (#${account.login})`
                : `WAITING FOR MT5 TERMINAL — No WebRequest Received Yet for #${account.login}`}
            </span>
          </div>
          <p className="text-xs text-slate-300">
            {isBridgeConnected ? (
              <>
                Synced <span className="font-mono text-emerald-300">{account.webhookSyncCount}</span> packet(s) from MetaTrader 5 · Last Sync:{' '}
                <span className="font-mono text-slate-100">
                  {account.lastWebhookSyncAt ? new Date(account.lastWebhookSyncAt).toLocaleTimeString() : 'Just now'}
                </span>{' '}
                · Real Balance: <span className="font-mono text-emerald-300">${account.balance.toFixed(2)}</span> · Open Orders:{' '}
                <span className="font-mono text-slate-100">{account.positions.length}</span> · History Deals:{' '}
                <span className="font-mono text-slate-100">{account.deals.length}</span>
              </>
            ) : (
              <span className="block space-y-1.5 mt-1">
                <span className="block text-slate-200">
                  Chrome blocks direct browser file access to Windows <span className="font-mono text-amber-300">AppData\Roaming</span> ("contains system files").
                </span>
                <span className="block text-slate-300">
                  Click <span className="font-mono text-blue-300 font-semibold">1. Download 2s Auto-Sync (`Start_MetaPulse_2s_Sync.bat`)</span> on the right and double-click it on your PC — it will stream your real MT5 data every 2 seconds automatically (and also mirror the file to your <span className="font-mono text-emerald-300">Downloads</span> folder).
                </span>
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileInputChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={handleCopyFilePath}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#1E293B] hover:bg-slate-700 text-amber-300 border border-amber-500/30 rounded-md transition-colors whitespace-nowrap"
          >
            {copiedPath ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedPath ? 'Copied File Path!' : '1. Copy MT5 File Path'}
          </button>
          <button
            type="button"
            onClick={handleLinkLocalMt5File}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors whitespace-nowrap"
          >
            {isLiveFilePolling ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Live 2s Auto-Sync: ON ({account.webhookSyncCount || 1})
              </>
            ) : (
              <>
                <FolderSync className="w-4 h-4" />
                2. Sync Local MT5 File (`MetaPulse_Account_Sync.json`)
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleDownloadBatBridge}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Download 2s Auto-Sync (`Start_MetaPulse_2s_Sync.bat`)
          </button>
          <button
            type="button"
            onClick={handleCopyPsScript}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#1E293B] hover:bg-slate-700 text-emerald-300 border border-emerald-500/30 rounded-md transition-colors whitespace-nowrap"
          >
            {copiedPs ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedPs ? 'Copied PowerShell Command!' : 'Copy PowerShell 2s Command'}
          </button>
          <div className="text-right font-mono text-xs text-slate-400">
            <div>Packets Received: <span className="text-slate-100">{account.webhookSyncCount || 0}</span></div>
            <div>
              Last Heartbeat:{' '}
              <span className="text-slate-100">
                {account.lastWebhookSyncAt
                  ? new Date(account.lastWebhookSyncAt).toLocaleTimeString()
                  : 'None'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {fileSyncStatus && (
        <div className="px-4 py-2.5 bg-emerald-950/40 border border-emerald-500/40 text-xs font-mono text-emerald-300">
          {fileSyncStatus}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
      {/* Left Column: MQL5 Expert Advisor Code */}
      <section className="xl:col-span-7 border border-[#1E293B] bg-[#111827] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E293B] pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              MetaTrader 5 Real Balance, Open Orders & History Bridge (`MetaPulseSyncEA.mq5` v3.0)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Streams 100% real Balance, Equity, Open Positions & Deal History from MT5 every 2 seconds
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyCode}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors whitespace-nowrap"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied MQL5 Code' : 'Copy MQL5 EA Source'}
            </button>
            <button
              type="button"
              onClick={handleDownloadCode}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#1E293B] hover:bg-slate-700 text-slate-100 rounded-md transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Download .mq5
            </button>
          </div>
        </div>

        <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
          <span>Webhook Ingestion Endpoint:</span>
          <span className="font-mono text-slate-200 select-all">{webhookUrl}</span>
          <span aria-hidden="true">·</span>
          <span>Target Login: #{account.login}</span>
          <span aria-hidden="true">·</span>
          <span className="text-emerald-400 font-mono">Owner ID: {account.ownerUserId}</span>
        </div>

        <pre className="p-4 bg-[#0B0F17] border border-[#1E293B] text-[11px] leading-relaxed font-mono text-slate-300 overflow-x-auto max-h-96">
          {mql5Code}
        </pre>

        <div className="p-3 bg-[#0B0F17] border border-[#1E293B] text-xs text-slate-300 space-y-1">
          <div className="font-semibold text-emerald-400">
            What `MetaPulseSyncEA.mq5` v3.0 Syncs Automatically from Your MT5 Terminal:
          </div>
          <ul className="list-disc list-inside text-slate-400 space-y-0.5 text-[11px]">
            <li>Real Account Balance, Equity, Floating PnL, Margin, Free Margin & Margin Level %</li>
            <li>All currently Open Orders (`PositionsTotal()`) with real Ticket, Symbol, Lot, Open/Current Price, SL/TP & Profit</li>
            <li>All Closed History Deals (`HistoryDealsTotal()`) with real Ticket, Open/Close Price, Profit, Swap & Commission</li>
          </ul>
        </div>
      </section>

      {/* Right Column: Batch MT5 Deal CSV Importer via WebSocket */}
      <section className="xl:col-span-5 border border-[#1E293B] bg-[#111827] p-5 space-y-4">
        <div className="border-b border-[#1E293B] pb-4">
          <h3 className="text-base font-semibold text-slate-100">
            MT5 Deal History Batch Sync (CSV / WebSocket)
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Optional: Paste exported MT5 deal rows (`Ticket,Symbol,Side,Volume,Open,Close,Profit,Comm,Swap,Pips,Comment`)
          </p>
        </div>

        <div>
          <label htmlFor="mt5-csv-input" className="block text-xs text-slate-400 mb-2">
            Real MT5 Deal Rows (Leave empty if using `MetaPulseSyncEA.mq5`)
          </label>
          <textarea
            id="mt5-csv-input"
            rows={6}
            value={csvInput}
            onChange={(e) => setCsvInput(e.target.value)}
            placeholder="Ticket,Symbol,BUY/SELL,Volume,OpenPrice,ClosePrice,Profit,Commission,Swap,Pips,Comment"
            className="w-full p-3 bg-[#0B0F17] border border-[#1E293B] text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            Imports real closed MT5 deals into your account history
          </span>
          <button
            type="button"
            onClick={handleParseCsvImport}
            disabled={!csvInput.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
          >
            <Upload className="w-3.5 h-3.5" />
            Sync Deals via WebSocket
          </button>
        </div>

        {importNotice && (
          <div className="text-xs font-mono text-emerald-400">{importNotice}</div>
        )}
      </section>
      </div>
    </div>
  );
};
