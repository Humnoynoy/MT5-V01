import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { MarketSymbolQuote, OrderSide } from '../types/mt5';

interface NewOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  quotes: Record<string, MarketSymbolQuote>;
  accountId: string;
  accountLogin: number;
  onExecuteOrder: (payload: {
    accountId: string;
    symbol: string;
    side: OrderSide;
    volume: number;
    sl: number;
    tp: number;
    comment: string;
  }) => void;
}

export const NewOrderModal: React.FC<NewOrderModalProps> = ({
  isOpen,
  onClose,
  quotes,
  accountId,
  accountLogin,
  onExecuteOrder,
}) => {
  const symbols = Object.keys(quotes);
  const [symbol, setSymbol] = useState<string>(symbols[0] || 'EURUSD');
  const [volume, setVolume] = useState<string>('0.01');
  const [leverage, setLeverage] = useState<number>(1000);
  const [sl, setSl] = useState<string>('0');
  const [tp, setTp] = useState<string>('0');
  const [comment, setComment] = useState<string>('MT5_WebTerminal_Exec');

  if (!isOpen) return null;

  const activeQuote = quotes[symbol] || quotes.EURUSD;
  const volNum = Math.max(0.01, parseFloat(volume) || 0.01);
  const contractUnits = volNum * (activeQuote.contractSize || 100000);
  const notionalUsd =
    activeQuote.symbol.startsWith('USD')
      ? contractUnits
      : contractUnits * activeQuote.ask;
  const requiredMargin = notionalUsd / leverage;

  const handleOrder = (side: OrderSide) => {
    onExecuteOrder({
      accountId,
      symbol: activeQuote.symbol,
      side,
      volume: volNum,
      sl: parseFloat(sl) || 0,
      tp: parseFloat(tp) || 0,
      comment: comment.trim() || 'MT5_Direct_Order',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md border border-[#1E293B] bg-[#111827] p-6">
        <div className="flex items-center justify-between pb-4 border-b border-[#1E293B]">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              MT5 Instant Execution — Account {accountLogin}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Direct WebSocket order dispatch (`position:open`)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-100 transition-colors"
            aria-label="Close Order Window"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Symbol</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full px-3 py-2 bg-[#0B0F17] border border-[#1E293B] text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
            >
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s} — {quotes[s].description}
                </option>
              ))}
            </select>
          </div>

          {/* Live Bid / Ask Readout */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-[#0B0F17] border border-[#1E293B]">
            <div>
              <div className="text-[11px] text-slate-400">Live Bid (SELL)</div>
              <div className="text-lg font-mono font-semibold text-rose-400 tabular-nums">
                {activeQuote.bid.toFixed(activeQuote.digits)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-slate-400">Live Ask (BUY)</div>
              <div className="text-lg font-mono font-semibold text-emerald-400 tabular-nums">
                {activeQuote.ask.toFixed(activeQuote.digits)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Volume (Lots)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                className="w-full px-3 py-2 bg-[#0B0F17] border border-[#1E293B] text-xs font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Stop Loss</label>
              <input
                type="number"
                step="any"
                value={sl}
                onChange={(e) => setSl(e.target.value)}
                className="w-full px-3 py-2 bg-[#0B0F17] border border-[#1E293B] text-xs font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Take Profit</label>
              <input
                type="number"
                step="any"
                value={tp}
                onChange={(e) => setTp(e.target.value)}
                className="w-full px-3 py-2 bg-[#0B0F17] border border-[#1E293B] text-xs font-mono text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 items-center p-2.5 bg-[#0B0F17] border border-[#1E293B]">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Execution Leverage</label>
              <select
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-[#111827] border border-[#1E293B] text-xs font-mono text-emerald-400"
              >
                <option value={100}>1:100</option>
                <option value={500}>1:500</option>
                <option value={1000}>1:1000 (Micro Balance)</option>
                <option value={2000}>1:2000 (Low Margin)</option>
              </select>
            </div>
            <div className="text-right font-mono">
              <div className="text-[11px] text-slate-400">Est. Margin Required</div>
              <div className="text-sm font-semibold text-emerald-400">
                ${requiredMargin.toFixed(2)}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">MT5 Order Comment</label>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full px-3 py-2 bg-[#0B0F17] border border-[#1E293B] text-xs font-mono text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={() => handleOrder('SELL')}
              className="py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-md transition-colors font-mono whitespace-nowrap"
            >
              SELL BY MARKET @ {activeQuote.bid.toFixed(activeQuote.digits)}
            </button>
            <button
              type="button"
              onClick={() => handleOrder('BUY')}
              className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-md transition-colors font-mono whitespace-nowrap"
            >
              BUY BY MARKET @ {activeQuote.ask.toFixed(activeQuote.digits)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
