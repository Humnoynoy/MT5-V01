import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  Search,
  Download,
  Plus,
  Play,
  Pause,
  ArrowUpDown,
  XCircle,
  KeyRound,
  LogOut,
  FolderSync,
  RefreshCw,
} from 'lucide-react';
import type {
  GridTrendMode,
  MarketSymbolQuote,
  Mt5Account,
  Mt5Deal,
  Mt5Timeframe,
  OrderSide,
  RsiGridConfig,
  ServerStateSnapshot,
  WsClientMessage,
  WsServerMessage,
} from './types/mt5';
import { EquityChart } from './components/EquityChart';
import { AnalyticsView } from './components/AnalyticsView';
import { Mt5BridgeModal } from './components/Mt5BridgeModal';
import { NewOrderModal } from './components/NewOrderModal';
import { ConnectAccountModal } from './components/ConnectAccountModal';
import { RsiGridPanel } from './components/RsiGridPanel';
import { UserLoginScreen } from './components/UserLoginScreen';

type NavTab = 'overview' | 'grid' | 'analytics' | 'positions' | 'ledger' | 'bridge';

export default function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(() => {
    try {
      return (
        localStorage.getItem('metapulse_owner_user') ||
        sessionStorage.getItem('metapulse_owner_user')
      );
    } catch {
      return null;
    }
  });
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [accounts, setAccounts] = useState<Mt5Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [quotes, setQuotes] = useState<Record<string, MarketSymbolQuote>>({});
  const [gridConfig, setGridConfig] = useState<RsiGridConfig | null>(null);
  const [streamPaused, setStreamPaused] = useState<boolean>(false);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [lastSyncNotice, setLastSyncNotice] = useState<string>('');
  const [initialLoaded, setInitialLoaded] = useState<boolean>(false);

  // Filtering and Sorting state for Trade Ledger & Positions
  const [symbolFilter, setSymbolFilter] = useState<string>('ALL');
  const [sideFilter, setSideFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<'closeTime' | 'netProfit' | 'volume' | 'pips'>('closeTime');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Modals
  const [isOrderModalOpen, setIsOrderModalOpen] = useState<boolean>(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);

  // Persistent 2-second Local MT5 File Sync (runs across all tabs)
  const [isLiveFilePolling, setIsLiveFilePolling] = useState<boolean>(false);
  const [fileSyncStatus, setFileSyncStatus] = useState<string | null>(null);
  const [proxyCookie, setProxyCookie] = useState<string>('');
  const globalFileInputRef = useRef<HTMLInputElement | null>(null);
  const globalFileHandleRef = useRef<any>(null);

  const pushJsonToWebhook = async (rawText: string) => {
    try {
      const cleaned = rawText.trim().replace(/\0/g, '');
      if (!cleaned) return;
      const parsed = JSON.parse(cleaned);
      if (currentUser) parsed.ownerUserId = currentUser;
      const res = await fetch('/api/mt5/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      if (res.ok) {
        setFileSyncStatus(
          `Live 2s Auto-Sync: ON (#${parsed.login}) · Balance: $${Number(parsed.balance || 0).toFixed(2)} · Open Orders: ${
            Array.isArray(parsed.positions) ? parsed.positions.length : 0
          } · History: ${Array.isArray(parsed.deals) ? parsed.deals.length : 0} · Updated ${new Date().toLocaleTimeString()}`
        );
      }
    } catch {
      // Ignore transient write lock while MT5 saves file
    }
  };

  useEffect(() => {
    if (!isLiveFilePolling) return;
    const timer = setInterval(async () => {
      if (!globalFileHandleRef.current) return;
      try {
        const file: File = await globalFileHandleRef.current.getFile();
        const text = await file.text();
        await pushJsonToWebhook(text);
      } catch {
        // Ignore transient write lock while MT5 writes every 2s
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [isLiveFilePolling, currentUser]);

  const handleLinkLocalMt5File = () => {
    globalFileInputRef.current?.click();
  };

  const handleGlobalFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await pushJsonToWebhook(text);
    setIsLiveFilePolling(true);
    e.target.value = '';
  };

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const applySnapshot = (snap: ServerStateSnapshot) => {
    setAccounts(snap.accounts);
    setQuotes(snap.quotes);
    if (snap.gridConfig) setGridConfig(snap.gridConfig);
    setStreamPaused(snap.streamPaused);
    if (snap.proxyCookie) setProxyCookie(snap.proxyCookie);
    setInitialLoaded(true);
    if (snap.accounts.length > 0 && !snap.accounts.some((a) => a.id === selectedAccountId)) {
      setSelectedAccountId(snap.accounts[0].id);
    }
  };

  useEffect(() => {
    let isUnmounted = false;

    // Initial HTTP fallback fetch in case WS takes a moment
    fetch('/api/mt5/state')
      .then((r) => r.json())
      .then((snap: ServerStateSnapshot) => {
        if (!isUnmounted && snap?.accounts) {
          applySnapshot(snap);
        }
      })
      .catch(() => {});

    const connectWebSocket = () => {
      if (isUnmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (isUnmounted) return;
        setWsConnected(true);
        socket.send(JSON.stringify({ type: 'state:request_sync' } satisfies WsClientMessage));
      };

      socket.onmessage = (event) => {
        if (isUnmounted) return;
        try {
          const msg = JSON.parse(event.data) as WsServerMessage;
          if (msg.type === 'state:init') {
            applySnapshot(msg.payload);
          } else if (msg.type === 'tick:update') {
            setQuotes(msg.payload.quotes);
            setAccounts(msg.payload.accounts);
            if (msg.payload.gridConfig) setGridConfig(msg.payload.gridConfig);
          } else if (msg.type === 'account:mutated') {
            setAccounts((prev) => {
              const exists = prev.some((a) => a.id === msg.payload.account.id);
              if (exists) {
                return prev.map((a) => (a.id === msg.payload.account.id ? msg.payload.account : a));
              }
              return [msg.payload.account, ...prev];
            });
            if (msg.payload.gridConfig) setGridConfig(msg.payload.gridConfig);
            setLastSyncNotice(msg.payload.message);
          } else if (msg.type === 'stream:status') {
            setStreamPaused(msg.payload.streamPaused);
          }
        } catch {
          // ignore malformed frames
        }
      };

      socket.onclose = () => {
        if (isUnmounted) return;
        setWsConnected(false);
        reconnectTimerRef.current = window.setTimeout(connectWebSocket, 1800);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connectWebSocket();

    return () => {
      isUnmounted = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const sendWsMessage = (msg: WsClientMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  };

  const userAccounts = useMemo(() => {
    if (!currentUser) return [];
    const matched = accounts.filter(
      (a) => (a.ownerUserId || '').toLowerCase() === currentUser.toLowerCase()
    );
    return matched.length > 0 ? matched : accounts;
  }, [accounts, currentUser]);

  const activeAccount = useMemo(() => {
    return userAccounts.find((a) => a.id === selectedAccountId) || userAccounts[0] || null;
  }, [userAccounts, selectedAccountId]);

  const filteredDeals = useMemo(() => {
    if (!activeAccount) return [];
    return activeAccount.deals
      .filter((d) => {
        if (symbolFilter !== 'ALL' && d.symbol !== symbolFilter) return false;
        if (sideFilter !== 'ALL' && d.type !== sideFilter) return false;
        if (searchQuery.trim() !== '') {
          const q = searchQuery.toLowerCase();
          const matchTicket = String(d.ticket).includes(q);
          const matchSym = d.symbol.toLowerCase().includes(q);
          const matchComment = d.comment.toLowerCase().includes(q);
          if (!matchTicket && !matchSym && !matchComment) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortField === 'closeTime') {
          cmp = new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime();
        } else if (sortField === 'netProfit') {
          cmp = a.netProfit - b.netProfit;
        } else if (sortField === 'volume') {
          cmp = a.volume - b.volume;
        } else if (sortField === 'pips') {
          cmp = a.pips - b.pips;
        }
        return sortAsc ? cmp : -cmp;
      });
  }, [activeAccount, symbolFilter, sideFilter, searchQuery, sortField, sortAsc]);

  const handleToggleSort = (field: 'closeTime' | 'netProfit' | 'volume' | 'pips') => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const handleExportCsv = () => {
    if (!activeAccount) return;
    const header =
      'Ticket,Symbol,Type,Volume,OpenPrice,ClosePrice,SL,TP,OpenTime,CloseTime,Commission,Swap,Profit,NetProfit,Pips,Comment\n';
    const rows = filteredDeals
      .map(
        (d) =>
          `${d.ticket},${d.symbol},${d.type},${d.volume.toFixed(2)},${d.openPrice},${d.closePrice},${d.sl},${d.tp},${d.openTime},${d.closeTime},${d.commission.toFixed(2)},${d.swap.toFixed(2)},${d.profit.toFixed(2)},${d.netProfit.toFixed(2)},${d.pips.toFixed(1)},"${d.comment}"`
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `MT5_Report_${activeAccount.login}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleClosePosition = (ticket: number) => {
    if (!activeAccount) return;
    // Optimistic removal before server confirmation
    setAccounts((prev) =>
      prev.map((acc) =>
        acc.id === activeAccount.id
          ? { ...acc, positions: acc.positions.filter((p) => p.ticket !== ticket) }
          : acc
      )
    );
    sendWsMessage({
      type: 'position:close',
      payload: { accountId: activeAccount.id, ticket },
    });
  };

  const handleExecuteOrder = (payload: {
    accountId: string;
    symbol: string;
    side: OrderSide;
    volume: number;
    sl: number;
    tp: number;
    comment: string;
  }) => {
    sendWsMessage({
      type: 'position:open',
      payload,
    });
  };

  const handleImportDeals = (deals: Array<Partial<Mt5Deal>>) => {
    if (!activeAccount) return;
    sendWsMessage({
      type: 'deal:import',
      payload: { accountId: activeAccount.id, deals },
    });
  };

  const handleNudgeQuote = (symbol: string, deltaPips: number) => {
    sendWsMessage({
      type: 'quote:nudge',
      payload: { symbol, deltaPips },
    });
  };

  const handleUpdateGridConfig = (payload: {
    enabled?: boolean;
    accountId?: string;
    symbol?: string;
    timeframe?: Mt5Timeframe;
    rsiPeriod?: number;
    trendMode?: GridTrendMode;
    uptrendLotSize?: number;
    uptrendSlPoints?: number;
    uptrendTpPoints?: number;
    downtrendLotSize?: number;
    downtrendSlPoints?: number;
    downtrendTpPoints?: number;
    maxPnlStopPct?: number;
    closeAllOnStop?: boolean;
  }) => {
    sendWsMessage({
      type: 'grid:update_config',
      payload,
    });
  };

  const handleSetGridRsi = (rsi: number) => {
    sendWsMessage({
      type: 'grid:set_rsi',
      payload: { rsi },
    });
  };

  const handleManualGridTier = (tierId: string, action: 'OPEN' | 'CLOSE') => {
    sendWsMessage({
      type: 'grid:manual_tier',
      payload: { tierId, action },
    });
  };

  const handleConnectAccount = (payload: {
    login: number;
    password?: string;
    passwordType?: 'Investor (Read-Only)' | 'Master (Full Execution)';
    server: string;
    name?: string;
    initialDeposit?: number;
    leverage?: number;
    seedSampleData?: boolean;
  }) => {
    const owner = currentUser || 'Sosaka';
    const newId = `acc-${owner.toLowerCase()}-${payload.login}`;
    setSelectedAccountId(newId);
    sendWsMessage({
      type: 'account:connect',
      payload: {
        ...payload,
        ownerUserId: owner,
      },
    });
  };

  const handleAuthenticated = (username: string) => {
    setCurrentUser(username);
    try {
      localStorage.setItem('metapulse_owner_user', username);
      sessionStorage.setItem('metapulse_owner_user', username);
    } catch {
      // ignore storage errors
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    try {
      localStorage.removeItem('metapulse_owner_user');
      sessionStorage.removeItem('metapulse_owner_user');
    } catch {
      // ignore storage errors
    }
  };

  const handleRemoveAccount = (accountId: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    sendWsMessage({
      type: 'account:remove',
      payload: { accountId },
    });
  };

  // Gate entire application behind Owner User ID Login Interface (User: Sosaka / PW: Ominisato)
  if (!currentUser) {
    return <UserLoginScreen onAuthenticated={handleAuthenticated} />;
  }

  // Loading Skeleton while fetching initial snapshot
  if (!initialLoaded) {
    return (
      <div className="min-h-screen bg-[#0B0F17] text-slate-100 p-8">
        <div className="max-w-[1440px] mx-auto space-y-6">
          <div className="h-12 bg-[#111827] border border-[#1E293B] animate-pulse" />
          <div className="grid grid-cols-4 gap-4">
            <div className="h-24 bg-[#111827] border border-[#1E293B] animate-pulse" />
            <div className="h-24 bg-[#111827] border border-[#1E293B] animate-pulse" />
            <div className="h-24 bg-[#111827] border border-[#1E293B] animate-pulse" />
            <div className="h-24 bg-[#111827] border border-[#1E293B] animate-pulse" />
          </div>
          <div className="h-80 bg-[#111827] border border-[#1E293B] animate-pulse" />
        </div>
      </div>
    );
  }

  // Clean Empty State when no default or user MT5 account is connected yet
  if (!activeAccount) {
    return (
      <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
        <header className="flex items-center justify-between px-6 py-3.5 border-b border-[#1E293B] bg-[#0B0F17]">
          <span className="text-lg font-bold tracking-tight text-slate-100">
            MetaPulse MT5
          </span>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-slate-400">
              Owner ID: <span className="text-emerald-400 font-semibold">{currentUser}</span>
            </span>
            <button
              type="button"
              onClick={() => setIsConnectModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Login MT5 Account
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-[#111827] border border-[#1E293B] rounded-lg hover:bg-[#1E293B] transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-lg w-full border border-[#1E293B] bg-[#111827] p-8 text-center space-y-5">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-[#0B0F17] border border-[#1E293B] text-blue-400">
              <KeyRound className="w-6 h-6" />
            </div>
            <div className="space-y-2">
              <div className="text-xs font-mono text-emerald-400">
                Signed in as Owner User ID: {currentUser}
              </div>
              <h1 className="text-xl font-semibold text-slate-100">
                No MT5 Trade Account Connected for {currentUser}
              </h1>
              <p className="text-xs text-slate-400 leading-relaxed">
                Connect your MetaTrader 5 account login and server. Only open orders, trade history, and RSI Grid tiers belonging to User ID <span className="text-slate-200 font-mono">{currentUser}</span> will be displayed.
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setIsConnectModalOpen(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors"
              >
                <KeyRound className="w-4 h-4" />
                Login to Trade Account
              </button>
            </div>
          </div>
        </main>

        <ConnectAccountModal
          isOpen={isConnectModalOpen}
          onClose={() => setIsConnectModalOpen(false)}
          onConnectAccount={handleConnectAccount}
        />
      </div>
    );
  }

  const returnPct =
    activeAccount.initialDeposit > 0
      ? ((activeAccount.equity - activeAccount.initialDeposit) / activeAccount.initialDeposit) * 100
      : 0;

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-[#1E293B] bg-[#0B0F17] sticky top-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('overview');
          }}
          className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap"
        >
          MetaPulse MT5
        </a>

        {/* Zone 2: 6 clean text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'overview'
                ? 'text-slate-100 underline underline-offset-8 decoration-blue-500 decoration-2'
                : 'hover:text-slate-200'
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('grid')}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'grid'
                ? 'text-slate-100 underline underline-offset-8 decoration-blue-500 decoration-2'
                : 'hover:text-slate-200'
            }`}
          >
            RSI Grid Order
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('analytics')}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'analytics'
                ? 'text-slate-100 underline underline-offset-8 decoration-blue-500 decoration-2'
                : 'hover:text-slate-200'
            }`}
          >
            Analytics Matrix
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('positions')}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'positions'
                ? 'text-slate-100 underline underline-offset-8 decoration-blue-500 decoration-2'
                : 'hover:text-slate-200'
            }`}
          >
            Open Positions ({activeAccount.positions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ledger')}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'ledger'
                ? 'text-slate-100 underline underline-offset-8 decoration-blue-500 decoration-2'
                : 'hover:text-slate-200'
            }`}
          >
            Deal Ledger ({activeAccount.deals.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('bridge')}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'bridge'
                ? 'text-slate-100 underline underline-offset-8 decoration-blue-500 decoration-2'
                : 'hover:text-slate-200'
            }`}
          >
            MQL5 Bridge
          </button>
        </nav>

        {/* Zone 3: 2 primary actions */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              sendWsMessage({ type: 'stream:toggle', paused: !streamPaused })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-200 bg-[#111827] border border-[#1E293B] rounded-lg hover:bg-[#1E293B] transition-colors whitespace-nowrap"
          >
            {streamPaused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
            {streamPaused ? 'Resume WS Feed' : 'Pause WS Feed'}
          </button>
          <button
            type="button"
            onClick={() => setIsOrderModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            New MT5 Order
          </button>
        </div>
      </header>

      {/* Main Workspace Container (1440px Desktop Baseline) */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-6 py-6 space-y-6">
        {/* Account Selector & Unboxed Metadata Strip */}
        <section className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#1E293B]">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-mono text-emerald-400 font-semibold">
                Owner ID: {activeAccount.ownerUserId || currentUser}
              </span>
              <span aria-hidden="true">·</span>
              <span>{activeAccount.broker}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-300">{activeAccount.server}</span>
              <span aria-hidden="true">·</span>
              <span>{activeAccount.accountType}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">1:{activeAccount.leverage}</span>
              <span aria-hidden="true">·</span>
              <span className={wsConnected ? 'text-emerald-400' : 'text-amber-400'}>
                {wsConnected
                  ? streamPaused
                    ? 'WebSocket Paused'
                    : 'WebSocket Live Sync Active'
                  : 'Reconnecting WebSocket...'}
              </span>
              <span aria-hidden="true">·</span>
              <span
                className={`font-mono font-semibold ${
                  activeAccount.webhookSyncCount && activeAccount.webhookSyncCount > 0
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                }`}
              >
                {activeAccount.webhookSyncCount && activeAccount.webhookSyncCount > 0
                  ? `MT5 Bridge: CONNECTED (${activeAccount.webhookSyncCount} syncs · Last ${
                      activeAccount.lastWebhookSyncAt
                        ? new Date(activeAccount.lastWebhookSyncAt).toLocaleTimeString()
                        : 'now'
                    })`
                  : 'MT5 Bridge: WAITING FOR EA'}
              </span>
            </div>
            <h1 className="text-2xl font-semibold text-slate-100 mt-1 tracking-tight">
              {activeAccount.name} — Login #{activeAccount.login}
            </h1>
            {lastSyncNotice && (
              <p className="text-xs font-mono text-emerald-400 mt-1">
                Last Sync Event: {lastSyncNotice}
              </p>
            )}
          </div>

          {/* Interactive Account Switcher & Mobile Nav */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#111827] border border-[#1E293B] rounded-lg">
              {userAccounts.map((acc) => (
                <div
                  key={acc.id}
                  className={`inline-flex items-center rounded-md transition-colors font-mono ${
                    acc.id === activeAccount.id
                      ? 'bg-[#1E293B] text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedAccountId(acc.id)}
                    className="px-2.5 py-1.5 text-xs font-medium whitespace-nowrap"
                  >
                    #{acc.login} ({acc.name.split(' ')[0]})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveAccount(acc.id)}
                    title={`Disconnect #${acc.login}`}
                    className="pr-2 py-1.5 text-slate-500 hover:text-rose-400 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <input
              ref={globalFileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleGlobalFileInputChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={handleLinkLocalMt5File}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                isLiveFilePolling || (activeAccount.webhookSyncCount && activeAccount.webhookSyncCount > 0)
                  ? 'text-emerald-200 bg-emerald-900/60 border border-emerald-500/50 hover:bg-emerald-800/60'
                  : 'text-amber-300 bg-amber-950/50 border border-amber-500/40 hover:bg-amber-900/50'
              }`}
            >
              {isLiveFilePolling || (activeAccount.webhookSyncCount && activeAccount.webhookSyncCount > 0) ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  Live 2s Auto-Sync: ON
                </>
              ) : (
                <>
                  <FolderSync className="w-3.5 h-3.5" />
                  Sync Local MT5 File (2s Auto)
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsConnectModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-300 bg-emerald-950/50 border border-emerald-500/40 rounded-lg hover:bg-emerald-900/50 transition-colors whitespace-nowrap"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Login MT5 Account
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-300 bg-[#111827] border border-[#1E293B] rounded-lg hover:bg-[#1E293B] transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Export MT5 CSV
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-[#111827] border border-[#1E293B] rounded-lg hover:bg-[#1E293B] transition-colors whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out ({currentUser})
            </button>
          </div>
        </section>

        {/* High-Density Primary MT5 Account Strip (Single-Elevation Grid with Hairline Dividers) */}
        <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 border border-[#1E293B] bg-[#111827] divide-y md:divide-y-0 md:divide-x divide-[#1E293B]">
          <div className="p-4">
            <div className="text-xs text-slate-400">Account Equity</div>
            <div className="text-xl font-semibold font-mono tabular-nums text-slate-100 mt-1">
              ${activeAccount.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div
              className={`text-xs font-mono tabular-nums mt-1 ${
                returnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {returnPct >= 0 ? '+' : ''}
              {returnPct.toFixed(2)}% vs Initial Deposit
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-400">Closed Balance</div>
            <div className="text-xl font-semibold font-mono tabular-nums text-slate-100 mt-1">
              ${activeAccount.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-400 mt-1">
              Net Profit: +${activeAccount.stats.totalNetProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-400">Floating Open P/L</div>
            <div
              className={`text-xl font-semibold font-mono tabular-nums mt-1 ${
                activeAccount.floatingPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {activeAccount.floatingPnL >= 0 ? '+' : '-'}$
              {Math.abs(activeAccount.floatingPnL).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            <div className="text-xs font-mono text-slate-400 mt-1">
              {activeAccount.positions.length} Open Position(s)
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-400">Profit Factor & Win Rate</div>
            <div className="text-xl font-semibold font-mono tabular-nums text-slate-100 mt-1">
              {activeAccount.stats.profitFactor.toFixed(2)}
            </div>
            <div className="text-xs font-mono text-emerald-400 mt-1">
              Win Rate {activeAccount.stats.profitTradesPct.toFixed(1)}% ({activeAccount.stats.profitTrades}/{activeAccount.stats.totalTrades})
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-400">Maximal Drawdown</div>
            <div className="text-xl font-semibold font-mono tabular-nums text-amber-400 mt-1">
              -{activeAccount.stats.maximalDrawdownPct.toFixed(2)}%
            </div>
            <div className="text-xs font-mono text-slate-400 mt-1">
              Peak-to-Valley ${activeAccount.stats.maximalDrawdownUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-400">Free Margin / Level</div>
            <div className="text-xl font-semibold font-mono tabular-nums text-slate-100 mt-1">
              ${activeAccount.freeMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-xs font-mono text-slate-400 mt-1">
              Margin Level {activeAccount.marginLevelPct > 0 ? `${activeAccount.marginLevelPct.toFixed(1)}%` : 'N/A'}
            </div>
          </div>
        </section>

        {/* Tab View Switcher for Mobile Viewports */}
        <div className="flex md:hidden items-center gap-1 overflow-x-auto p-1 bg-[#111827] border border-[#1E293B] rounded-lg">
          {(['overview', 'grid', 'analytics', 'positions', 'ledger', 'bridge'] as NavTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize whitespace-nowrap ${
                activeTab === t ? 'bg-[#1E293B] text-slate-100' : 'text-slate-400'
              }`}
            >
              {t === 'grid' ? 'RSI Grid' : t}
            </button>
          ))}
        </div>

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Main Focal Anchor: Equity Curve + Live Market Watch */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              <div className="xl:col-span-8">
                <EquityChart
                  data={activeAccount.equityCurve}
                  initialDeposit={activeAccount.initialDeposit}
                />
              </div>

              {/* MT5 Market Watch & Interactive Tick Nudger */}
              <div className="xl:col-span-4 border border-[#1E293B] bg-[#111827] flex flex-col justify-between">
                <div>
                  <div className="px-5 py-4 border-b border-[#1E293B] flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-slate-100">MT5 Market Watch</h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Live ECN quotes · Click +/- pip buttons to stress-test floating equity
                      </p>
                    </div>
                  </div>

                  <div className="divide-y divide-[#1E293B]">
                    {Object.values(quotes).map((q) => (
                      <div
                        key={q.symbol}
                        className="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-[#1E293B]/30 transition-colors"
                      >
                        <div>
                          <div className="text-xs font-mono font-semibold text-slate-100">
                            {q.symbol}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            Spread {q.spreadPips.toFixed(1)}p ·{' '}
                            <span className={q.dailyChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                              {q.dailyChangePct >= 0 ? '+' : ''}
                              {q.dailyChangePct.toFixed(2)}%
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right font-mono tabular-nums">
                            <div className="text-xs text-slate-200">
                              <span className="text-rose-400">{q.bid.toFixed(q.digits)}</span>
                              <span className="text-slate-500 mx-1">/</span>
                              <span className="text-emerald-400">{q.ask.toFixed(q.digits)}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleNudgeQuote(q.symbol, -5)}
                              title={`Move ${q.symbol} down 5 pips`}
                              className="px-1.5 py-1 text-[10px] font-mono bg-[#0B0F17] hover:bg-rose-950/60 text-rose-400 border border-[#1E293B] rounded transition-colors"
                            >
                              -5p
                            </button>
                            <button
                              type="button"
                              onClick={() => handleNudgeQuote(q.symbol, 5)}
                              title={`Move ${q.symbol} up 5 pips`}
                              className="px-1.5 py-1 text-[10px] font-mono bg-[#0B0F17] hover:bg-emerald-950/60 text-emerald-400 border border-[#1E293B] rounded transition-colors"
                            >
                              +5p
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="px-5 py-3 border-t border-[#1E293B] flex items-center justify-between text-xs text-slate-400">
                  <span>Expected Payoff: +${activeAccount.stats.expectedPayoff.toFixed(2)}/deal</span>
                  <span>Sharpe: {activeAccount.stats.sharpeRatio.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Live Open Positions Table */}
            <section className="border border-[#1E293B] bg-[#111827]">
              <div className="px-5 py-4 border-b border-[#1E293B] flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">
                    Active Open Positions ({activeAccount.positions.length})
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Real-time mark-to-market valuation synced via WebSocket · Close any position to commit to Deal Ledger
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOrderModalOpen(true)}
                  className="px-3.5 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors whitespace-nowrap"
                >
                  + Open Market Order
                </button>
              </div>

              {activeAccount.positions.length === 0 ? (
                <div className="p-8 text-center space-y-3">
                  <p className="text-sm text-slate-400">
                    No active positions currently open on Account #{activeAccount.login}.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsOrderModalOpen(true)}
                    className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
                  >
                    Execute First Market Order
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#1E293B] text-[11px] text-slate-400">
                        <th className="py-2.5 px-4 font-medium">Ticket</th>
                        <th className="py-2.5 px-3 font-medium">Symbol</th>
                        <th className="py-2.5 px-3 font-medium">Side</th>
                        <th className="py-2.5 px-3 font-medium text-right">Volume</th>
                        <th className="py-2.5 px-3 font-medium text-right">Open Price</th>
                        <th className="py-2.5 px-3 font-medium text-right">Current</th>
                        <th className="py-2.5 px-3 font-medium text-right">SL / TP</th>
                        <th className="py-2.5 px-3 font-medium text-right">Pips</th>
                        <th className="py-2.5 px-3 font-medium text-right">Floating P/L</th>
                        <th className="py-2.5 px-4 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E293B] text-xs font-mono tabular-nums">
                      {activeAccount.positions.map((pos) => {
                        const q = quotes[pos.symbol];
                        const digits = q ? q.digits : 5;
                        return (
                          <tr key={pos.ticket} className="hover:bg-[#1E293B]/40 transition-colors">
                            <td className="py-2.5 px-4 text-slate-300">#{pos.ticket}</td>
                            <td className="py-2.5 px-3 font-semibold text-slate-100">{pos.symbol}</td>
                            <td
                              className={`py-2.5 px-3 font-semibold ${
                                pos.type === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {pos.type}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-200">
                              {pos.volume.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-300">
                              {pos.openPrice.toFixed(digits)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-100">
                              {pos.currentPrice.toFixed(digits)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-400">
                              {pos.sl > 0 ? pos.sl.toFixed(digits) : '—'} /{' '}
                              {pos.tp > 0 ? pos.tp.toFixed(digits) : '—'}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right ${
                                pos.pips >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {pos.pips >= 0 ? '+' : ''}
                              {pos.pips.toFixed(1)}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-semibold ${
                                pos.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {pos.profit >= 0 ? '+' : '-'}${Math.abs(pos.profit).toFixed(2)}
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <button
                                type="button"
                                onClick={() => handleClosePosition(pos.ticket)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-sans font-medium bg-[#0B0F17] hover:bg-rose-950/80 text-slate-300 hover:text-rose-300 border border-[#1E293B] rounded transition-colors whitespace-nowrap"
                              >
                                <XCircle className="w-3 h-3" />
                                Close
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* RSI Grid Order Engine (Uptrend 0.01 Lot / Downtrend 0.02 Lot) */}
            {gridConfig && (
              <RsiGridPanel
                account={activeAccount}
                quotes={quotes}
                gridConfig={gridConfig}
                onUpdateConfig={handleUpdateGridConfig}
                onSetRsi={handleSetGridRsi}
                onManualTierAction={handleManualGridTier}
              />
            )}

            {/* Quick Summary of Statistical Matrix */}
            <AnalyticsView account={activeAccount} />
          </div>
        )}

        {/* RSI GRID ORDER TAB */}
        {activeTab === 'grid' && gridConfig && (
          <RsiGridPanel
            account={activeAccount}
            quotes={quotes}
            gridConfig={gridConfig}
            onUpdateConfig={handleUpdateGridConfig}
            onSetRsi={handleSetGridRsi}
            onManualTierAction={handleManualGridTier}
          />
        )}

        {/* ANALYTICS MATRIX TAB */}
        {activeTab === 'analytics' && <AnalyticsView account={activeAccount} />}

        {/* OPEN POSITIONS TAB */}
        {activeTab === 'positions' && (
          <section className="border border-[#1E293B] bg-[#111827]">
            <div className="px-5 py-4 border-b border-[#1E293B] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Open Positions Book — Account #{activeAccount.login}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Live floating P/L, swap, commission, and instant market close over WebSocket
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOrderModalOpen(true)}
                className="px-3.5 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors whitespace-nowrap"
              >
                + New Market Order
              </button>
            </div>

            {activeAccount.positions.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <p className="text-sm text-slate-400">
                  No open positions in the order book.
                </p>
                <button
                  type="button"
                  onClick={() => setIsOrderModalOpen(true)}
                  className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
                >
                  Open First Position
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#1E293B] text-[11px] text-slate-400">
                      <th className="py-2.5 px-4 font-medium">Ticket</th>
                      <th className="py-2.5 px-3 font-medium">Open Time (UTC)</th>
                      <th className="py-2.5 px-3 font-medium">Symbol</th>
                      <th className="py-2.5 px-3 font-medium">Type</th>
                      <th className="py-2.5 px-3 font-medium text-right">Volume</th>
                      <th className="py-2.5 px-3 font-medium text-right">Open Price</th>
                      <th className="py-2.5 px-3 font-medium text-right">Current</th>
                      <th className="py-2.5 px-3 font-medium text-right">Comm / Swap</th>
                      <th className="py-2.5 px-3 font-medium text-right">Pips</th>
                      <th className="py-2.5 px-3 font-medium text-right">Floating P/L</th>
                      <th className="py-2.5 px-3 font-medium">EA Comment</th>
                      <th className="py-2.5 px-4 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E293B] text-xs font-mono tabular-nums">
                    {activeAccount.positions.map((pos) => {
                      const q = quotes[pos.symbol];
                      const digits = q ? q.digits : 5;
                      return (
                        <tr key={pos.ticket} className="hover:bg-[#1E293B]/40 transition-colors">
                          <td className="py-2.5 px-4 text-slate-300">#{pos.ticket}</td>
                          <td className="py-2.5 px-3 text-slate-400">
                            {pos.openTime.replace('T', ' ').slice(0, 19)}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-100">{pos.symbol}</td>
                          <td
                            className={`py-2.5 px-3 font-semibold ${
                              pos.type === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {pos.type}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-200">
                            {pos.volume.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-300">
                            {pos.openPrice.toFixed(digits)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-100">
                            {pos.currentPrice.toFixed(digits)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-400">
                            ${pos.commission.toFixed(2)} / ${pos.swap.toFixed(2)}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right ${
                              pos.pips >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {pos.pips >= 0 ? '+' : ''}
                            {pos.pips.toFixed(1)}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right font-semibold ${
                              pos.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {pos.profit >= 0 ? '+' : '-'}${Math.abs(pos.profit).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 truncate max-w-[160px]">
                            {pos.comment}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleClosePosition(pos.ticket)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-sans font-medium bg-[#0B0F17] hover:bg-rose-950/80 text-slate-300 hover:text-rose-300 border border-[#1E293B] rounded transition-colors whitespace-nowrap"
                            >
                              <XCircle className="w-3 h-3" />
                              Close Deal
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* CLOSED DEAL LEDGER TAB */}
        {activeTab === 'ledger' && (
          <section className="border border-[#1E293B] bg-[#111827]">
            <div className="px-5 py-4 border-b border-[#1E293B] flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Historical Closed Deal Ledger ({filteredDeals.length} of {activeAccount.deals.length})
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Audited MT5 deal execution history with commission, swap, net profit, and EA comment
                </p>
              </div>

              {/* Filter Bar */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter ticket, symbol, EA..."
                    className="pl-8 pr-3 py-1.5 bg-[#0B0F17] border border-[#1E293B] text-xs text-slate-100 focus:outline-none focus:border-blue-500 rounded-md"
                  />
                </div>

                <select
                  value={symbolFilter}
                  onChange={(e) => setSymbolFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-[#0B0F17] border border-[#1E293B] text-xs font-mono text-slate-200 rounded-md"
                >
                  <option value="ALL">All Symbols</option>
                  {Object.keys(quotes).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                <div className="flex items-center gap-1 p-0.5 bg-[#0B0F17] border border-[#1E293B] rounded-md">
                  {(['ALL', 'BUY', 'SELL'] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      onClick={() => setSideFilter(side)}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                        sideFilter === side
                          ? 'bg-[#1E293B] text-slate-100'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {side}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filteredDeals.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-sm text-slate-400">No closed deals match the active filter criteria.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSymbolFilter('ALL');
                    setSideFilter('ALL');
                    setSearchQuery('');
                  }}
                  className="px-3 py-1.5 text-xs font-medium bg-[#1E293B] text-slate-200 rounded-md"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#1E293B] text-[11px] text-slate-400">
                      <th className="py-2.5 px-4 font-medium">Deal Ticket</th>
                      <th className="py-2.5 px-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleToggleSort('closeTime')}
                          className="inline-flex items-center gap-1 hover:text-slate-200"
                        >
                          Close Time (UTC)
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="py-2.5 px-3 font-medium">Symbol</th>
                      <th className="py-2.5 px-3 font-medium">Type</th>
                      <th className="py-2.5 px-3 font-medium text-right">
                        <button
                          type="button"
                          onClick={() => handleToggleSort('volume')}
                          className="inline-flex items-center gap-1 hover:text-slate-200"
                        >
                          Lots
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="py-2.5 px-3 font-medium text-right">Open → Close</th>
                      <th className="py-2.5 px-3 font-medium text-right">
                        <button
                          type="button"
                          onClick={() => handleToggleSort('pips')}
                          className="inline-flex items-center gap-1 hover:text-slate-200"
                        >
                          Pips
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="py-2.5 px-3 font-medium text-right">Comm / Swap</th>
                      <th className="py-2.5 px-3 font-medium text-right">
                        <button
                          type="button"
                          onClick={() => handleToggleSort('netProfit')}
                          className="inline-flex items-center gap-1 hover:text-slate-200"
                        >
                          Net Profit
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="py-2.5 px-4 font-medium">EA Comment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E293B] text-xs font-mono tabular-nums">
                    {filteredDeals.map((d) => {
                      const q = quotes[d.symbol];
                      const digits = q ? q.digits : 5;
                      return (
                        <tr key={d.ticket} className="hover:bg-[#1E293B]/40 transition-colors">
                          <td className="py-2.5 px-4 text-slate-300">#{d.ticket}</td>
                          <td className="py-2.5 px-3 text-slate-400">
                            {d.closeTime.replace('T', ' ').slice(0, 19)}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-100">{d.symbol}</td>
                          <td
                            className={`py-2.5 px-3 font-semibold ${
                              d.type === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {d.type}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-200">
                            {d.volume.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-300">
                            {d.openPrice.toFixed(digits)} → {d.closePrice.toFixed(digits)}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right ${
                              d.pips >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {d.pips >= 0 ? '+' : ''}
                            {d.pips.toFixed(1)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-400">
                            ${d.commission.toFixed(2)} / ${d.swap.toFixed(2)}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right font-semibold ${
                              d.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {d.netProfit >= 0 ? '+' : '-'}$
                            {Math.abs(d.netProfit).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-2.5 px-4 text-slate-400 truncate max-w-[180px]">
                            {d.comment}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* MQL5 BRIDGE TAB */}
        {activeTab === 'bridge' && (
          <Mt5BridgeModal
            account={activeAccount}
            onImportDeals={handleImportDeals}
            isLiveFilePolling={isLiveFilePolling}
            fileSyncStatus={fileSyncStatus}
            onLinkLocalMt5File={handleLinkLocalMt5File}
            proxyCookie={proxyCookie}
          />
        )}
      </main>

      {/* Quiet Institutional Footer */}
      <footer className="border-t border-[#1E293B] px-6 py-4 text-xs text-slate-500">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
          <span>MetaPulse MT5 — Institutional Trading Statistics & Real-Time WebSocket Portfolio Sync</span>
          <span>MQL5 WebRequest & WebSocket Protocol Ready</span>
        </div>
      </footer>

      {/* New Order Execution Modal */}
      <NewOrderModal
        isOpen={isOrderModalOpen}
        onClose={() => setIsOrderModalOpen(false)}
        quotes={quotes}
        accountId={activeAccount.id}
        accountLogin={activeAccount.login}
        onExecuteOrder={handleExecuteOrder}
      />

      {/* MT5 Login to Trade Account Modal */}
      <ConnectAccountModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        onConnectAccount={handleConnectAccount}
      />
    </div>
  );
}
