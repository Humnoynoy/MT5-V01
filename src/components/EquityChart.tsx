import React, { useState } from 'react';
import type { EquityPoint } from '../types/mt5';

interface EquityChartProps {
  data: EquityPoint[];
  initialDeposit: number;
}

type ChartMode = 'equity' | 'drawdown' | 'daily';

export const EquityChart: React.FC<EquityChartProps> = ({ data, initialDeposit }) => {
  const [mode, setMode] = useState<ChartMode>('equity');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center border border-[#1E293B] bg-[#111827] text-sm text-slate-400">
        No equity history points available.
      </div>
    );
  }

  const width = 920;
  const height = 270;
  const padLeft = 68;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 32;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const activePoint = hoverIndex !== null && data[hoverIndex] ? data[hoverIndex] : data[data.length - 1];

  // Scales for Equity/Balance mode
  const allValues = data.flatMap((d) => [d.balance, d.equity]);
  const minVal = Math.min(...allValues, initialDeposit) * 0.996;
  const maxVal = Math.max(...allValues, initialDeposit) * 1.004;
  const valRange = Math.max(1, maxVal - minVal);

  // Scales for Drawdown mode
  const maxDd = Math.max(...data.map((d) => d.drawdownPct), 2.5) * 1.15;

  // Scales for Daily PnL mode
  const maxAbsPnl = Math.max(...data.map((d) => Math.abs(d.dailyPnL)), 500) * 1.15;

  const getX = (idx: number) =>
    data.length <= 1 ? padLeft + plotW / 2 : padLeft + (idx / (data.length - 1)) * plotW;

  const getYValue = (v: number) => padTop + plotH - ((v - minVal) / valRange) * plotH;
  const getYDrawdown = (dd: number) => padTop + (dd / maxDd) * plotH;
  const getYPnl = (pnl: number) => padTop + plotH / 2 - (pnl / maxAbsPnl) * (plotH / 2);

  const balancePoints = data.map((d, i) => `${getX(i)},${getYValue(d.balance)}`).join(' ');
  const equityPoints = data.map((d, i) => `${getX(i)},${getYValue(d.equity)}`).join(' ');
  const equityArea = `${padLeft},${padTop + plotH} ${equityPoints} ${getX(data.length - 1)},${padTop + plotH}`;

  const ddPoints = data.map((d, i) => `${getX(i)},${getYDrawdown(d.drawdownPct)}`).join(' ');
  const ddArea = `${padLeft},${padTop} ${ddPoints} ${getX(data.length - 1)},${padTop}`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="border border-[#1E293B] bg-[#111827] p-5">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#1E293B]">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Real-Time Curve Telemetry</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{activePoint.label}</span>
            <span aria-hidden="true">·</span>
            <span>Baseline Deposit ${initialDeposit.toLocaleString('en-US')}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-6">
            <div>
              <span className="text-xs text-slate-400 mr-2">Equity</span>
              <span className="text-lg font-semibold font-mono tabular-nums text-slate-100">
                ${activePoint.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-xs text-slate-400 mr-2">Balance</span>
              <span className="text-base font-medium font-mono tabular-nums text-blue-400">
                ${activePoint.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-xs text-slate-400 mr-2">Drawdown</span>
              <span className="text-sm font-mono tabular-nums text-amber-400">
                -{activePoint.drawdownPct.toFixed(2)}%
              </span>
            </div>
            <div>
              <span className="text-xs text-slate-400 mr-2">Delta P/L</span>
              <span
                className={`text-sm font-mono tabular-nums ${
                  activePoint.dailyPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {activePoint.dailyPnL >= 0 ? '+' : '-'}$
                {Math.abs(activePoint.dailyPnL).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Interactive Chart Mode Segmented Filter */}
        <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-[#1E293B] rounded-lg">
          <button
            type="button"
            onClick={() => setMode('equity')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'equity'
                ? 'bg-[#1E293B] text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Equity & Balance
          </button>
          <button
            type="button"
            onClick={() => setMode('drawdown')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'drawdown'
                ? 'bg-[#1E293B] text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Underwater Drawdown
          </button>
          <button
            type="button"
            onClick={() => setMode('daily')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'daily'
                ? 'bg-[#1E293B] text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Deal P/L Impulse
          </button>
        </div>
      </div>

      <div className="relative mt-4 select-none">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-64 overflow-visible"
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#EF4444" stopOpacity="0.28" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid Lines & Y-Axis Labels */}
          {yTicks.map((t, idx) => {
            const y = padTop + t * plotH;
            let label = '';
            if (mode === 'equity') {
              const val = maxVal - t * valRange;
              label = `$${(val / 1000).toFixed(1)}k`;
            } else if (mode === 'drawdown') {
              const dd = t * maxDd;
              label = `-${dd.toFixed(1)}%`;
            } else {
              const pnl = maxAbsPnl - t * (maxAbsPnl * 2);
              label = `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(0)}`;
            }

            return (
              <g key={idx}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#1E293B"
                  strokeDasharray={t === 0.5 && mode === 'daily' ? 'none' : '3 3'}
                  strokeWidth={t === 0.5 && mode === 'daily' ? 1.5 : 1}
                />
                <text
                  x={padLeft - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-500 text-[10px] font-mono"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {mode === 'equity' && (
            <>
              <polygon points={equityArea} fill="url(#equityFill)" />
              <polyline
                fill="none"
                stroke="#3B82F6"
                strokeWidth="1.75"
                strokeDasharray="4 3"
                points={balancePoints}
              />
              <polyline
                fill="none"
                stroke="#10B981"
                strokeWidth="2.25"
                points={equityPoints}
              />
            </>
          )}

          {mode === 'drawdown' && (
            <>
              <polygon points={ddArea} fill="url(#ddFill)" />
              <polyline
                fill="none"
                stroke="#F59E0B"
                strokeWidth="2"
                points={ddPoints}
              />
            </>
          )}

          {mode === 'daily' &&
            data.map((d, i) => {
              const x = getX(i);
              const zeroY = padTop + plotH / 2;
              const y = getYPnl(d.dailyPnL);
              const barW = Math.max(6, Math.min(24, plotW / data.length - 6));
              const top = Math.min(zeroY, y);
              const barH = Math.max(2, Math.abs(y - zeroY));
              return (
                <rect
                  key={i}
                  x={x - barW / 2}
                  y={top}
                  width={barW}
                  height={barH}
                  fill={d.dailyPnL >= 0 ? '#10B981' : '#EF4444'}
                  opacity={hoverIndex === i ? 1 : 0.8}
                  rx={1}
                />
              );
            })}

          {/* Hover Crosshair & Active Point */}
          {hoverIndex !== null && data[hoverIndex] && (
            <g>
              <line
                x1={getX(hoverIndex)}
                y1={padTop}
                x2={getX(hoverIndex)}
                y2={padTop + plotH}
                stroke="#64748B"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              {mode === 'equity' && (
                <>
                  <circle
                    cx={getX(hoverIndex)}
                    cy={getYValue(data[hoverIndex].equity)}
                    r="4"
                    fill="#10B981"
                    stroke="#0B0F17"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx={getX(hoverIndex)}
                    cy={getYValue(data[hoverIndex].balance)}
                    r="3.5"
                    fill="#3B82F6"
                    stroke="#0B0F17"
                    strokeWidth="1.5"
                  />
                </>
              )}
              {mode === 'drawdown' && (
                <circle
                  cx={getX(hoverIndex)}
                  cy={getYDrawdown(data[hoverIndex].drawdownPct)}
                  r="4"
                  fill="#F59E0B"
                  stroke="#0B0F17"
                  strokeWidth="1.5"
                />
              )}
            </g>
          )}

          {/* X-axis Labels */}
          {data.map((d, i) => {
            const step = Math.max(1, Math.ceil(data.length / 7));
            if (i % step !== 0 && i !== data.length - 1) return null;
            return (
              <text
                key={i}
                x={getX(i)}
                y={height - 8}
                textAnchor="middle"
                className="fill-slate-400 text-[10px] font-mono"
              >
                {d.label}
              </text>
            );
          })}

          {/* Invisible Interactive Hit Columns */}
          {data.map((_, i) => {
            const colW = plotW / Math.max(1, data.length);
            return (
              <rect
                key={i}
                x={getX(i) - colW / 2}
                y={padTop}
                width={colW}
                height={plotH}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoverIndex(i)}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
};
