import React, { useState, useMemo } from 'react';

interface PortfolioCardProps {
  portfolioId: string;
  name: string;
  currentValue: number;
  history7Day: number[]; // e.g., [10200, 10150, 10300, 10100, 10400, 10250, 10500]
  allocations: { [asset: string]: number };
}

export const PortfolioCard: React.FC<PortfolioCardProps> = ({
  name,
  currentValue,
  history7Day,
  allocations,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Normalize history data: slice to ensure max of 7 points, and fallback to currentValue for flat arrays
  const normalizedHistory = useMemo(() => {
    if (!history7Day || history7Day.length < 7) return Array(7).fill(currentValue);
    return history7Day.slice(-7);
  }, [history7Day, currentValue]);

  const hasHistory = history7Day && history7Day.length >= 7;

  // Limits calculation using strict greater-than comparison for trend flags
  const { min, max, isUpTrend } = useMemo(() => {
    const minVal = Math.min(...normalizedHistory);
    const maxVal = Math.max(...normalizedHistory);
    const initial = normalizedHistory[0];
    const current = normalizedHistory[normalizedHistory.length - 1];
    
    return { min: minVal, max: maxVal, isUpTrend: current > initial };
  }, [normalizedHistory]);

  const width = 120;
  const height = 36;
  const padding = 2;

  // Build the SVG custom points mapping string dynamically
  const points = useMemo(() => {
    const totalPoints = normalizedHistory.length;
    const valueRange = max - min;

    return normalizedHistory.map((val, index) => {
      const x = (index / (totalPoints - 1)) * (width - padding * 2) + padding;
      if (valueRange === 0) return { x, y: height / 2, val };
      const y = height - padding - ((val - min) / valueRange) * (height - padding * 2);
      return { x, y, val };
    });
  }, [normalizedHistory, min, max]);

  const pathData = useMemo(() => {
    if (points.length === 0) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  }, [points]);

  // Accessibility descriptive compliance text
  const trendDescription = useMemo(() => {
    if (!hasHistory) return "Portfolio value history flat line due to insufficient tracking timeline data.";
    return `Portfolio value history sparkline over 7 days showing an ${isUpTrend ? 'upward' : 'downward'} trend from $${normalizedHistory[0].toFixed(2)} to $${normalizedHistory[normalizedHistory.length - 1].toFixed(2)}.`;
  }, [hasHistory, isUpTrend, normalizedHistory]);

  const strokeColor = isUpTrend ? '#22c55e' : '#ef4444'; // Green if strictly greater, Red otherwise

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-lg flex flex-col justify-between w-full max-w-sm transition-all hover:border-slate-600">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-slate-200 text-lg font-semibold tracking-wide">{name}</h3>
          <p className="text-2xl font-bold text-white mt-1">
            ${currentValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
        </div>

        {/* --- Sparkline Block Component --- */}
        <div 
          className="relative flex items-center justify-center pt-2"
          aria-label={trendDescription}
          role="img"
        >
          <svg 
            width={width} 
            height={height} 
            className="overflow-visible"
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <path
              d={pathData}
              fill="none"
              stroke={strokeColor}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((pt, idx) => (
              <g key={idx}>
                <rect
                  x={idx === 0 ? 0 : points[idx - 1].x + (pt.x - points[idx - 1].x) / 2}
                  y={0}
                  width={idx === points.length - 1 ? width / points.length : (points[idx + 1]?.x - pt.x)}
                  height={height}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIndex(idx)}
                />
                {hoveredIndex === idx && (
                  <circle cx={pt.x} cy={pt.y} r="4" fill={strokeColor} className="pointer-events-none" />
                )}
              </g>
            ))}
          </svg>

          {/* Interactive Mouse Hover Tooltip */}
          {hoveredIndex !== null && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-1.5 py-0.5 rounded shadow-md border border-slate-700 font-mono pointer-events-none z-10 whitespace-nowrap">
              ${points[hoveredIndex].val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}
        </div>
        {/* ---------------------------------- */}
      </div>

      {/* Mini target token overview lists */}
      <div className="border-t border-slate-700/50 pt-3 mt-2">
        <div className="flex flex-wrap gap-2">
          {Object.entries(allocations).map(([asset, percentage]) => (
            <span key={asset} className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-md font-medium">
              {asset}: {percentage}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};