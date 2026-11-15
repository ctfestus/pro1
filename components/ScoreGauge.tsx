import React from 'react';

// Half-dial (semicircle) score gauge with a pass-mark tick. Shared by the certification result
// screen and the course completion screen so both present results the same way. Colours are props
// so it works on light or dark surfaces.
interface ScoreGaugeProps {
  score: number;              // 0-100 overall score (green fill)
  passmark: number;           // 0-100 pass mark, drawn as a tick on the arc
  passed: boolean;            // green fill when passed, red otherwise
  track?: string;             // arc track colour
  scoreColor?: string;        // big % number colour
  mutedColor?: string;        // "Overall score" label colour
  tickColor?: string;         // pass-mark tick colour
  width?: number;             // rendered width in px (default 200)
  failColor?: string;         // fill when not passed (the player's one red; lighter on dark)
}

const R = 82, STROKE = 14, CX = 108, CY = 108;
const ARC = Math.PI * R;
const PATH = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;

export function ScoreGauge({
  score, passmark, passed,
  track = 'rgba(0,0,0,0.10)', scoreColor = '#111', mutedColor = '#6b7280', tickColor = '#111', width = 200, failColor = '#D93025',
}: ScoreGaugeProps) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const fill = passed ? '#16a34a' : failColor;
  const pf = Math.max(0, Math.min(100, passmark)) / 100;
  const pcos = Math.cos(pf * Math.PI), psin = Math.sin(pf * Math.PI);
  const tickIn = R - STROKE / 2 - 2, tickOut = R + STROKE / 2 + 2;
  const height = Math.round((width * 118) / 216);
  return (
    <div style={{ position: 'relative', width, height }}>
      <svg width={width} height={height} viewBox="0 0 216 118" style={{ width: '100%', height: '100%' }}>
        <path d={PATH} fill="none" stroke={track} strokeWidth={STROKE} strokeLinecap="round" />
        <path d={PATH} fill="none" stroke={fill} strokeWidth={STROKE} strokeLinecap="round" strokeDasharray={`${(s / 100) * ARC} ${ARC}`} />
        <line x1={CX - tickIn * pcos} y1={CY - tickIn * psin} x2={CX - tickOut * pcos} y2={CY - tickOut * psin} stroke={tickColor} strokeWidth={3} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 2, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ fontSize: Math.round(width * 0.16), fontWeight: 800, lineHeight: 1, color: scoreColor }}>{s}%</span>
        <span style={{ fontSize: 11.5, color: mutedColor, marginTop: 3 }}>Overall score</span>
      </div>
    </div>
  );
}
