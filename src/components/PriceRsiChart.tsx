import React, { useEffect, useState } from 'react';
import type { MarketSymbolQuote, Mt5Position, Mt5Timeframe } from '../types/mt5';

interface PriceRsiChartProps {
  symbol: string;
  timeframe: Mt5Timeframe;
  rsiPeriod: number;
  quote: MarketSymbolQuote | undefined;
  currentRsi: number;
  positions: Mt5Position[];
}

interface PriceRsiTickPoint {
  id: number;
  timeLabel: string;
  bid: number;
  ask: number;
  rsi: number;
}

const MAX_POINTS = 60;
const RSI_GRID_LEVELS = [90, 80, 70, 60, 50, 40, 30, 20, 10, 5];

export const PriceRsiChart: React.FC<PriceRsiChartProps> = ({
  symbol,
  timeframe,
  rsiPeriod,
  quote,
  currentRsi,
  positions,
}) => {
  const [history, setHistory] = useState<PriceRsiTickPoint[]>([]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const digits = quote?.digits ?? 2;
  const currentBid = quote?.bid ?? 2658.4;
  const currentAsk = quote?.ask ?? 2658.62;

  // Reset and seed initial 40 historical ticks when symbol changes
  useEffect(() => {
    const now = Date.now();
    const stepPrice = symbol === 'XAUUSD' ? 0.65 : symbol === 'NAS100' ? 4.5 : symbol.includes('JPY') ? 0.035 : 0.00025;
    const seeded: PriceRsiTickPoint[] = [];
    let pBid = currentBid - stepPrice * 4;
    let pRsi = Math.max(8, Math.min(92, currentRsi - 3));
    const spread = Math.max(0.00005, currentAsk - currentBid);

    for (let i = 39; i >= 1; i--) {
      const t = new Date(now - i * 1100);
      const timeLabel = t.toISOString().slice(11, 19);
      const wave = Math.sin(i * 0.35) * stepPrice * 0.8 + (Math.cos(i * 0.19) * stepPrice * 0.4);
      pBid = Number((currentBid - wave).toFixed(digits));
      const pAsk = Number((pBid + spread).toFixed(digits));
      pRsi = Number(
        Math.max(3, Math.min(97, currentRsi - Math.sin(i * 0.3) * 14)).toFixed(1)
      );
      seeded.push({
        id: now - i * 1100,
        timeLabel,
        bid: pBid,
        ask: pAsk,
        rsi: pRsi,
      });
    }

    seeded.push({
      id: now,
      timeLabel: new Date(now).toISOString().slice(11, 19),
      bid: currentBid,
      ask: currentAsk,
      rsi: currentRsi,
    });

    setHistory(seeded);
    setHoverIdx(null);
  }, [symbol]);

  // Append incoming WebSocket quote & RSI updates in real time
  useEffect(() => {
    if (!quote) return;
    setHistory((prev) => {
      const now = Date.now();
      const timeLabel = new Date(now).toISOString().slice(11, 19);
      const last = prev[prev.length - 1];
      if (
        last &&
        last.bid === quote.bid &&
        last.ask === quote.ask &&
        Math.abs(last.rsi - currentRsi) < 0.05
      ) {
        return prev;
      }
      const next = [
        ...prev,
        {
          id: now,
          timeLabel,
          bid: quote.bid,
          ask: quote.ask,
          rsi: currentRsi,
        },
      ];
      return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
    });
  }, [quote?.bid, quote?.ask, currentRsi]);

  if (history.length < 2) return null;

  const symbolPositions = positions.filter((p) => p.symbol === symbol);

  // SVG coordinate system
  const width = 1000;
  const height = 390;
  const padLeft = 18;
  const padRight = 84;
  const plotW = width - padLeft - padRight;

  // Top Pane: Live Price (Bid / Ask + Open Grid Order Price Lines)
  const priceTop = 16;
  const priceBottom = 212;
  const priceH = priceBottom - priceTop;

  // Bottom Pane: Synchronized RSI (0..100) Line with 9-Tier Levels (5..90)
  const rsiTop = 242;
  const rsiBottom = 368;
  const rsiH = rsiBottom - rsiTop;

  const allPrices: number[] = [];
  history.forEach((pt) => {
    allPrices.push(pt.bid, pt.ask);
  });
  symbolPositions.forEach((pos) => {
    allPrices.push(pos.openPrice);
  });

  const rawMinP = Math.min(...allPrices);
  const rawMaxP = Math.max(...allPrices);
  const priceMargin = Math.max((rawMaxP - rawMinP) * 0.15, Math.pow(10, -digits) * 15);
  const minPrice = rawMinP - priceMargin;
  const maxPrice = rawMaxP + priceMargin;
  const priceRange = Math.max(maxPrice - minPrice, 0.00001);

  const getX = (idx: number) =>
    padLeft + (idx / Math.max(1, history.length - 1)) * plotW;

  const getPriceY = (price: number) =>
    priceTop + (1 - (price - minPrice) / priceRange) * priceH;

  const getRsiY = (rsiVal: number) =>
    rsiTop + (1 - Math.max(0, Math.min(100, rsiVal)) / 100) * rsiH;

  const bidPath = history
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getPriceY(pt.bid).toFixed(1)}`)
    .join(' ');

  const askPath = history
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getPriceY(pt.ask).toFixed(1)}`)
    .join(' ');

  const bidAreaPath = `${bidPath} L ${getX(history.length - 1).toFixed(1)} ${priceBottom} L ${padLeft} ${priceBottom} Z`;

  const rsiPath = history
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getRsiY(pt.rsi).toFixed(1)}`)
    .join(' ');

  const rsiAreaPath = `${rsiPath} L ${getX(history.length - 1).toFixed(1)} ${rsiBottom} L ${padLeft} ${rsiBottom} Z`;

  const inspectedIndex = hoverIdx !== null && hoverIdx < history.length ? hoverIdx : history.length - 1;
  const inspectedPoint = history[inspectedIndex];
  const latestPoint = history[history.length - 1];

  const priceTicks = [0, 0.25, 0.5, 0.75, 1].map(
    (t) => maxPrice - t * priceRange
  );

  return (
    <section className="border border-[#1E293B] bg-[#111827] p-5 space-y-3">
      {/* Header Bar with Live Price & RSI Readout */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[#1E293B]">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-100">
            {symbol} Live Price &amp; Synchronized RSI ({rsiPeriod}) Chart
          </h3>
          <span className="text-xs font-mono text-blue-400">
            Timeframe: {timeframe}
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-xs font-mono text-slate-400">
            Entry Rule: <span className="text-slate-200">RSI = XX.x</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
          <span className="text-slate-400">
            Time: <span className="text-slate-200">{inspectedPoint.timeLabel} UTC</span>
          </span>
          <span>
            Bid:{' '}
            <span className="text-blue-400 font-semibold">
              {inspectedPoint.bid.toFixed(digits)}
            </span>
          </span>
          <span>
            Ask:{' '}
            <span className="text-emerald-400 font-semibold">
              {inspectedPoint.ask.toFixed(digits)}
            </span>
          </span>
          <span>
            RSI({rsiPeriod}):{' '}
            <span className="text-amber-400 font-bold">
              {inspectedPoint.rsi.toFixed(1)} (RSI={Math.floor(inspectedPoint.rsi)}.x)
            </span>
          </span>
        </div>
      </div>

      {/* Dual-Pane Synchronized SVG Canvas */}
      <div className="relative w-full overflow-hidden bg-[#0B0F17] border border-[#1E293B]">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-[360px] select-none cursor-crosshair"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = ((e.clientX - rect.left) / rect.width) * width;
            const ratio = Math.max(0, Math.min(1, (relX - padLeft) / plotW));
            const idx = Math.round(ratio * (history.length - 1));
            setHoverIdx(idx);
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="priceFillGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="rsiFillGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.20" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* ================= TOP PANE: LIVE MARKET PRICE ================= */}
          <text
            x={padLeft + 6}
            y={priceTop + 12}
            fill="#94A3B8"
            fontSize="10"
            fontFamily="JetBrains Mono, monospace"
          >
            {symbol} PRICE (BID / ASK)
          </text>

          {/* Horizontal Price Grid Lines & Right Axis Labels */}
          {priceTicks.map((pVal, idx) => {
            const y = getPriceY(pVal);
            return (
              <g key={idx}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#1E293B"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={width - padRight + 6}
                  y={y + 3}
                  fill="#64748B"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {pVal.toFixed(digits)}
                </text>
              </g>
            );
          })}

          {/* Active Open Grid Positions Entry Price Lines */}
          {symbolPositions.map((pos) => {
            const y = getPriceY(pos.openPrice);
            if (y < priceTop || y > priceBottom) return null;
            const isBuy = pos.type === 'BUY';
            return (
              <g key={pos.ticket}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke={isBuy ? '#10B981' : '#F43F5E'}
                  strokeDasharray="4 2"
                  strokeWidth="1.2"
                />
                <text
                  x={padLeft + 8}
                  y={y - 4}
                  fill={isBuy ? '#10B981' : '#F43F5E'}
                  fontSize="9.5"
                  fontFamily="JetBrains Mono, monospace"
                >
                  #{pos.ticket} {pos.type} {pos.volume.toFixed(2)} @ {pos.openPrice.toFixed(digits)} ({pos.profit >= 0 ? '+' : ''}${pos.profit.toFixed(2)})
                </text>
              </g>
            );
          })}

          {/* Price Area & Bid/Ask Curves */}
          <path d={bidAreaPath} fill="url(#priceFillGrad)" />
          <path
            d={askPath}
            fill="none"
            stroke="#10B981"
            strokeWidth="1.25"
            strokeDasharray="2 2"
            opacity="0.85"
          />
          <path d={bidPath} fill="none" stroke="#3B82F6" strokeWidth="2" />

          {/* Live Bid Price Tag on Right Axis */}
          <g transform={`translate(${width - padRight}, ${getPriceY(latestPoint.bid)})`}>
            <rect x="2" y="-9" width={padRight - 4} height="18" fill="#2563EB" rx="2" />
            <text
              x="6"
              y="3"
              fill="#FFFFFF"
              fontSize="10"
              fontWeight="600"
              fontFamily="JetBrains Mono, monospace"
            >
              {latestPoint.bid.toFixed(digits)}
            </text>
          </g>

          {/* Pane Divider */}
          <line
            x1={0}
            y1={(priceBottom + rsiTop) / 2}
            x2={width}
            y2={(priceBottom + rsiTop) / 2}
            stroke="#1E293B"
            strokeWidth="1.5"
          />

          {/* ================= BOTTOM PANE: RSI LINE & 9-TIER LEVELS ================= */}
          <text
            x={padLeft + 6}
            y={rsiTop + 11}
            fill="#F59E0B"
            fontSize="10"
            fontFamily="JetBrains Mono, monospace"
          >
            RSI ({rsiPeriod}) LINE · 9 GRID TIERS (5, 10, 20, 30, 40, 50, 60, 70, 80, 90)
          </text>

          {/* RSI Grid Threshold Lines (5..90) */}
          {RSI_GRID_LEVELS.map((lvl) => {
            const y = getRsiY(lvl);
            const isMajor = lvl === 70 || lvl === 50 || lvl === 30;
            const isMatchingFloor = Math.floor(latestPoint.rsi) === lvl;
            return (
              <g key={lvl}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke={isMatchingFloor ? '#F59E0B' : isMajor ? '#334155' : '#1E293B'}
                  strokeDasharray={isMajor ? 'none' : '2 3'}
                  strokeWidth={isMatchingFloor ? '1.3' : '0.8'}
                />
                <text
                  x={width - padRight + 6}
                  y={y + 3}
                  fill={isMatchingFloor ? '#FBBF24' : '#64748B'}
                  fontSize="9.5"
                  fontFamily="JetBrains Mono, monospace"
                >
                  RSI {lvl}
                </text>
              </g>
            );
          })}

          {/* RSI Area & RSI Line */}
          <path d={rsiAreaPath} fill="url(#rsiFillGrad)" />
          <path d={rsiPath} fill="none" stroke="#F59E0B" strokeWidth="2" />

          {/* Live RSI Value Tag on Right Axis */}
          <g transform={`translate(${width - padRight}, ${getRsiY(latestPoint.rsi)})`}>
            <rect x="2" y="-9" width={padRight - 4} height="18" fill="#D97706" rx="2" />
            <text
              x="6"
              y="3"
              fill="#FFFFFF"
              fontSize="10"
              fontWeight="600"
              fontFamily="JetBrains Mono, monospace"
            >
              RSI {latestPoint.rsi.toFixed(1)}
            </text>
          </g>

          {/* Synchronized Hover Crosshair Across Both Price & RSI Panes */}
          {inspectedPoint && (
            <g>
              <line
                x1={getX(inspectedIndex)}
                y1={priceTop}
                x2={getX(inspectedIndex)}
                y2={rsiBottom}
                stroke="#64748B"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <circle
                cx={getX(inspectedIndex)}
                cy={getPriceY(inspectedPoint.bid)}
                r="4"
                fill="#3B82F6"
                stroke="#0B0F17"
                strokeWidth="1.5"
              />
              <circle
                cx={getX(inspectedIndex)}
                cy={getRsiY(inspectedPoint.rsi)}
                r="4"
                fill="#F59E0B"
                stroke="#0B0F17"
                strokeWidth="1.5"
              />
            </g>
          )}
        </svg>
      </div>
    </section>
  );
};
