import React from 'react';
import type { Mt5Account } from '../types/mt5';

interface AnalyticsViewProps {
  account: Mt5Account;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ account }) => {
  const { stats, symbolBreakdown, sessionBreakdown } = account;

  const statPairs: Array<{
    labelLeft: string;
    valueLeft: string;
    toneLeft?: 'pos' | 'neg' | 'neutral';
    labelRight: string;
    valueRight: string;
    toneRight?: 'pos' | 'neg' | 'neutral';
  }> = [
    {
      labelLeft: 'Total Net Profit',
      valueLeft: `${stats.totalNetProfit >= 0 ? '+' : '-'}$${Math.abs(stats.totalNetProfit).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      toneLeft: stats.totalNetProfit >= 0 ? 'pos' : 'neg',
      labelRight: 'Gross Profit / Gross Loss',
      valueRight: `+$${stats.grossProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })} · -$${stats.grossLoss.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      toneRight: 'neutral',
    },
    {
      labelLeft: 'Profit Factor',
      valueLeft: stats.profitFactor.toFixed(2),
      toneLeft: stats.profitFactor >= 1.5 ? 'pos' : 'neutral',
      labelRight: 'Expected Payoff (Per Deal)',
      valueRight: `${stats.expectedPayoff >= 0 ? '+' : '-'}$${Math.abs(stats.expectedPayoff).toFixed(2)}`,
      toneRight: stats.expectedPayoff >= 0 ? 'pos' : 'neg',
    },
    {
      labelLeft: 'Recovery Factor',
      valueLeft: stats.recoveryFactor.toFixed(2),
      toneLeft: stats.recoveryFactor >= 2 ? 'pos' : 'neutral',
      labelRight: 'Sharpe Ratio / Sortino Ratio',
      valueRight: `${stats.sharpeRatio.toFixed(2)} · ${stats.sortinoRatio.toFixed(2)}`,
      toneRight: 'pos',
    },
    {
      labelLeft: 'Maximal Drawdown',
      valueLeft: `$${stats.maximalDrawdownUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${stats.maximalDrawdownPct.toFixed(2)}%)`,
      toneLeft: 'neg',
      labelRight: 'Absolute / Relative Drawdown',
      valueRight: `$${stats.absoluteDrawdown.toFixed(2)} · ${stats.relativeDrawdownPct.toFixed(2)}% ($${stats.relativeDrawdownUsd.toFixed(2)})`,
      toneRight: 'neutral',
    },
    {
      labelLeft: 'Total Closed Deals',
      valueLeft: `${stats.totalTrades}`,
      toneLeft: 'neutral',
      labelRight: 'AHPR / GHPR (Holding Return)',
      valueRight: `${stats.ahprPct >= 0 ? '+' : ''}${stats.ahprPct.toFixed(2)}% · ${stats.ghprPct >= 0 ? '+' : ''}${stats.ghprPct.toFixed(2)}%`,
      toneRight: 'pos',
    },
    {
      labelLeft: 'Profit Trades (% of Total)',
      valueLeft: `${stats.profitTrades} (${stats.profitTradesPct.toFixed(1)}%)`,
      toneLeft: 'pos',
      labelRight: 'Loss Trades (% of Total)',
      valueRight: `${stats.lossTrades} (${stats.lossTradesPct.toFixed(1)}%)`,
      toneRight: 'neg',
    },
    {
      labelLeft: 'Long Trades (Won %)',
      valueLeft: `${stats.longTrades} (${stats.longTradesWonPct.toFixed(1)}%)`,
      toneLeft: 'neutral',
      labelRight: 'Short Trades (Won %)',
      valueRight: `${stats.shortTrades} (${stats.shortTradesWonPct.toFixed(1)}%)`,
      toneRight: 'neutral',
    },
    {
      labelLeft: 'Largest Profit / Loss Trade',
      valueLeft: `+$${stats.largestProfitTrade.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      toneLeft: 'pos',
      labelRight: 'Largest Loss Trade',
      valueRight: `-$${Math.abs(stats.largestLossTrade).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      toneRight: 'neg',
    },
    {
      labelLeft: 'Average Profit Trade',
      valueLeft: `+$${stats.avgProfitTrade.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      toneLeft: 'pos',
      labelRight: 'Average Loss Trade',
      valueRight: `-$${Math.abs(stats.avgLossTrade).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      toneRight: 'neg',
    },
    {
      labelLeft: 'Max Consecutive Wins',
      valueLeft: `${stats.maxConsecutiveWinsCount} deals (+$${stats.maxConsecutiveWinsUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})`,
      toneLeft: 'pos',
      labelRight: 'Max Consecutive Losses',
      valueRight: `${stats.maxConsecutiveLossesCount} deals (-$${stats.maxConsecutiveLossesUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})`,
      toneRight: 'neg',
    },
    {
      labelLeft: 'Z-Score (Serial Dependence)',
      valueLeft: `${stats.zScore.toFixed(2)} (${stats.zScoreConfidencePct.toFixed(1)}% conf.)`,
      toneLeft: 'neutral',
      labelRight: 'Margin Level / Leverage',
      valueRight: `${account.marginLevelPct > 0 ? `${account.marginLevelPct.toFixed(1)}%` : 'No Margin Used'} · 1:${account.leverage}`,
      toneRight: 'neutral',
    },
  ];

  const getToneClass = (tone?: 'pos' | 'neg' | 'neutral') => {
    if (tone === 'pos') return 'text-emerald-400';
    if (tone === 'neg') return 'text-rose-400';
    return 'text-slate-100';
  };

  return (
    <div className="space-y-6">
      {/* Official MT5 Report Statistical Matrix */}
      <section className="border border-[#1E293B] bg-[#111827]">
        <div className="px-5 py-4 border-b border-[#1E293B] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              MetaTrader 5 Strategy & Account Statistical Matrix
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Recalculated in real time on every WebSocket deal execution and live tick mark-to-market
            </p>
          </div>
          <div className="text-xs text-slate-400 font-mono">
            Account {account.login} · {account.server} · {account.currency}
          </div>
        </div>

        <div className="divide-y divide-[#1E293B]">
          {statPairs.map((row, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#1E293B]"
            >
              <div className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[#1E293B]/30 transition-colors">
                <span className="text-xs text-slate-400">{row.labelLeft}</span>
                <span className={`text-xs font-mono tabular-nums font-medium ${getToneClass(row.toneLeft)}`}>
                  {row.valueLeft}
                </span>
              </div>
              <div className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[#1E293B]/30 transition-colors">
                <span className="text-xs text-slate-400">{row.labelRight}</span>
                <span className={`text-xs font-mono tabular-nums font-medium ${getToneClass(row.toneRight)}`}>
                  {row.valueRight}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Symbol Breakdown & Session Attribution */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section className="xl:col-span-7 border border-[#1E293B] bg-[#111827]">
          <div className="px-5 py-4 border-b border-[#1E293B]">
            <h3 className="text-base font-semibold text-slate-100">Instrument Attribution & Profit Factor</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Net realized P/L, lot volume, win rate, and expectancy grouped by MT5 symbol
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#1E293B] text-[11px] text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Symbol</th>
                  <th className="py-2.5 px-3 font-medium text-right">Deals (L/S)</th>
                  <th className="py-2.5 px-3 font-medium text-right">Lots</th>
                  <th className="py-2.5 px-3 font-medium text-right">Win Rate</th>
                  <th className="py-2.5 px-3 font-medium text-right">Profit Factor</th>
                  <th className="py-2.5 px-3 font-medium text-right">Expectancy</th>
                  <th className="py-2.5 px-4 font-medium text-right">Net Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E293B] text-xs font-mono tabular-nums">
                {symbolBreakdown.map((sym) => (
                  <tr key={sym.symbol} className="hover:bg-[#1E293B]/40 transition-colors">
                    <td className="py-2.5 px-4 font-semibold text-slate-100">{sym.symbol}</td>
                    <td className="py-2.5 px-3 text-right text-slate-300">
                      {sym.trades} ({sym.longTrades}L/{sym.shortTrades}S)
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-300">{sym.lots.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right text-slate-200">{sym.winRatePct.toFixed(1)}%</td>
                    <td className="py-2.5 px-3 text-right text-slate-200">{sym.profitFactor.toFixed(2)}</td>
                    <td
                      className={`py-2.5 px-3 text-right ${
                        sym.expectancy >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {sym.expectancy >= 0 ? '+' : '-'}${Math.abs(sym.expectancy).toFixed(2)}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-semibold ${
                        sym.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {sym.netProfit >= 0 ? '+' : '-'}$
                      {Math.abs(sym.netProfit).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="xl:col-span-5 border border-[#1E293B] bg-[#111827]">
          <div className="px-5 py-4 border-b border-[#1E293B]">
            <h3 className="text-base font-semibold text-slate-100">UTC Session Liquidity Performance</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Execution edge segmented by Asian, London, Overlap, and New York market hours
            </p>
          </div>
          <div className="divide-y divide-[#1E293B]">
            {sessionBreakdown.map((s) => (
              <div key={s.session} className="px-5 py-3.5 hover:bg-[#1E293B]/30 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-100">{s.session}</div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      {s.hoursUtc} · {s.trades} deals · Avg {s.avgPips >= 0 ? '+' : ''}
                      {s.avgPips} pips
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    <div
                      className={`text-sm font-semibold ${
                        s.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {s.netProfit >= 0 ? '+' : '-'}$
                      {Math.abs(s.netProfit).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">Win {s.winRatePct.toFixed(1)}%</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
