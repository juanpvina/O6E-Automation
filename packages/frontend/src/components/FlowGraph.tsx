import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { StepType, WorkflowStep } from '@opencode/shared';

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'waiting_approval';

export interface FlowGraphProps {
  steps: WorkflowStep[];
  selectedStepId: string | null;
  onSelectStep: (stepId: string) => void;
  stepStatuses?: Record<string, StepStatus>;
  onAddNodeBetween?: (fromStepId: string, toStepId: string, edgeLabel: 'T' | 'F' | null) => void;
  onDeleteStepDirect?: (stepId: string) => void;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 64;
const H_GAP = 90;
const V_GAP = 28;
const PAD = 48;

const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const TYPE_STROKE: Record<StepType, string> = {
  trigger: '#10b981',
  normalizer: '#06b6d4',
  agent: '#a855f7',
  condition: '#f59e0b',
  shell_test: '#94a3b8',
  git: '#3b82f6',
  pr: '#6366f1',
  transform: '#ec4899',
  output: '#14b8a6',
  approval: '#f97316',
  nosql: '#10b981',
  http_request: '#0ea5e9',
  code: '#84cc16',
  parallel: '#0ea5e9',
  loop: '#8b5cf6',
  retry: '#f43f5e',
  wait: '#eab308',
  discord_notify: '#6366f1',
  google_sheets: '#10b981',
  python: '#f59e0b',
  json_parser: '#38bdf8'
};

const STATUS_COLOR: Record<StepStatus, string> = {
  pending: '#64748b',
  running: '#3b82f6',
  succeeded: '#10b981',
  failed: '#f43f5e',
  waiting_approval: '#f59e0b'
};

const STATUS_GLYPH: Record<StepStatus, string> = {
  pending: '',
  running: '⟳',
  succeeded: '✓',
  failed: '✕',
  waiting_approval: '⚠'
};

interface GraphEdge {
  from: string;
  to: string;
  label: 'T' | 'F' | null;
  color: string;
  isBackEdge?: boolean;
}

interface GraphLayout {
  positions: Map<string, { x: number; y: number }>;
  edges: GraphEdge[];
  width: number;
  height: number;
}

const getTargets = (step: WorkflowStep): GraphEdge[] => {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const id of step.nextStepIds) {
    if (!seen.has(`next:${id}`)) {
      seen.add(`next:${id}`);
      edges.push({ from: step.id, to: id, label: null, color: '#475569' });
    }
  }
  if (step.type === 'condition') {
    const onTrue = step.config?.onTrue;
    const onFalse = step.config?.onFalse;
    if (onTrue && !seen.has(`true:${onTrue}`)) {
      seen.add(`true:${onTrue}`);
      edges.push({ from: step.id, to: onTrue, label: 'T', color: '#10b981' });
    }
    if (onFalse && !seen.has(`false:${onFalse}`)) {
      seen.add(`false:${onFalse}`);
      edges.push({ from: step.id, to: onFalse, label: 'F', color: '#f43f5e' });
    }
  }
  return edges;
};

const buildGraph = (steps: WorkflowStep[]): GraphLayout => {
  const positions = new Map<string, { x: number; y: number }>();
  const edges: GraphEdge[] = [];

  if (steps.length === 0) {
    return { positions, edges, width: PAD * 2, height: PAD * 2 };
  }

  const ids = new Set(steps.map(s => s.id));
  const stepsById = new Map(steps.map(step => [step.id, step]));
  const targetsById = new Map<string, GraphEdge[]>();
  const depth = new Map<string, number>();
  const incoming = new Map<string, number>();
  steps.forEach(s => {
    depth.set(s.id, 0);
    incoming.set(s.id, 0);
  });

  for (const s of steps) {
    const targets = getTargets(s);
    targetsById.set(s.id, targets);
    for (const e of targets) {
      edges.push(e);
      if (ids.has(e.to)) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    }
  }

  let hasRoot = false;
  for (const s of steps) {
    if ((incoming.get(s.id) ?? 0) === 0) {
      depth.set(s.id, 0);
      hasRoot = true;
    }
  }
  if (!hasRoot) depth.set(steps[0].id, 0);

  // DFS Cycle detection: Identify back-edges before longest-path relaxation
  const visitedState = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: visited
  steps.forEach(s => visitedState.set(s.id, 0));
  const backEdges = new Set<string>();

  const dfs = (u: string) => {
    visitedState.set(u, 1);
    const stepObj = stepsById.get(u);
    if (stepObj) {
       for (const e of targetsById.get(stepObj.id) ?? []) {
        if (!ids.has(e.to)) continue;
        const state = visitedState.get(e.to) ?? 0;
        if (state === 1) {
          backEdges.add(`${u}->${e.to}`);
        } else if (state === 0) {
          dfs(e.to);
        }
      }
    }
    visitedState.set(u, 2);
  };

  steps.forEach(s => {
    if ((incoming.get(s.id) ?? 0) === 0 && visitedState.get(s.id) === 0) {
      dfs(s.id);
    }
  });

  steps.forEach(s => {
    if (visitedState.get(s.id) === 0) {
      dfs(s.id);
    }
  });

  // Longest-path relaxation: robust even when the trigger is not the first step.
  let changed = true;
  let guard = 0;
  while (changed && guard < steps.length * steps.length + 1) {
    changed = false;
    guard++;
    for (const s of steps) {
      const sd = depth.get(s.id) ?? 0;
       for (const e of targetsById.get(s.id) ?? []) {
        if (!ids.has(e.to)) continue;
        // Omit back-edges to prevent infinite depth increments in nodes with cycles
        if (backEdges.has(`${s.id}->${e.to}`)) continue;

        if ((depth.get(e.to) ?? 0) < sd + 1) {
          depth.set(e.to, sd + 1);
          changed = true;
        }
      }
    }
  }

  // Group steps into columns by depth.
  const columns = new Map<number, string[]>();
  for (const s of steps) {
    const d = depth.get(s.id) ?? 0;
    const arr = columns.get(d);
    if (arr) {
      arr.push(s.id);
    } else {
      columns.set(d, [s.id]);
    }
  }

  let maxColHeight = 0;
  const colHeights = new Map<number, number>();
  for (const [d, arr] of columns) {
    const h = (arr.length - 1) * (NODE_HEIGHT + V_GAP);
    colHeights.set(d, h);
    maxColHeight = Math.max(maxColHeight, h);
  }

  // Vertically center each column so the DAG stays balanced.
  for (const [d, arr] of columns) {
    const offsetY = (maxColHeight - (colHeights.get(d) ?? 0)) / 2;
    arr.forEach((id, i) => {
      positions.set(id, {
        x: PAD + d * (NODE_WIDTH + H_GAP),
        y: PAD + offsetY + i * (NODE_HEIGHT + V_GAP)
      });
    });
  }

  let maxDepth = 0;
  for (const d of depth.values()) {
    if (d > maxDepth) maxDepth = d;
  }
  const numCols = maxDepth + 1;
  const width = numCols * NODE_WIDTH + (numCols - 1) * H_GAP + PAD * 2;
  const height = maxColHeight + NODE_HEIGHT + PAD * 2;

  const finalEdges = edges.map(e => ({
    ...e,
    isBackEdge: backEdges.has(`${e.from}->${e.to}`)
  }));

  return { positions, edges: finalEdges, width, height };
};

export const FlowGraph: React.FC<FlowGraphProps> = ({
  steps,
  selectedStepId,
  onSelectStep,
  stepStatuses,
  onAddNodeBetween,
  onDeleteStepDirect
}) => {
  const layout = useMemo(() => buildGraph(steps), [steps]);
  const { width, height } = layout;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; viewX: number; viewY: number; scale: number } | null>(null);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView(prev => {
      const vw = width / prev.k;
      const vh = height / prev.k;
      const wx = prev.x + (mx / rect.width) * vw;
      const wy = prev.y + (my / rect.height) * vh;
      const k = Math.min(2.5, Math.max(0.3, prev.k * Math.exp(-e.deltaY * 0.0015)));
      return {
        k,
        x: wx - (mx / rect.width) * (width / k),
        y: wy - (my / rect.height) * (height / k)
      };
    });
  }, [width, height]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const resetView = useCallback(() => setView({ k: 1, x: 0, y: 0 }), []);

  const zoomBy = useCallback((factor: number) => {
    setView(prev => {
      const k = Math.min(2.5, Math.max(0.3, prev.k * factor));
      const vw = width / prev.k;
      const vh = height / prev.k;
      const cx = prev.x + vw / 2;
      const cy = prev.y + vh / 2;
      return {
        k,
        x: cx - (width / k) / 2,
        y: cy - (height / k) / 2
      };
    });
  }, [width, height]);

  if (steps.length === 0) {
    return (
      <div className="w-full h-full min-h-[320px] flex items-center justify-center text-slate-500 text-sm font-sans">
        No hay pasos para mostrar.
      </div>
    );
  }

  const viewBox = `${view.x} ${view.y} ${width / view.k} ${height / view.k}`;

  return (
    <div
      className="relative w-full h-full min-h-[360px] select-none touch-none overflow-hidden bg-slate-900/20 font-sans"
      style={{ touchAction: 'none' }}
    >
      <style>{`
        @keyframes flow-dash {
          to {
            stroke-dashoffset: -20;
          }
        }
        .node-running {
          stroke-dasharray: 6 4;
          animation: flow-dash 1.2s linear infinite;
        }
         .node-card {
           transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s ease-in-out;
        }
        .node-card:hover {
          transform: scale(1.03);
          filter: drop-shadow(0 0 8px rgba(16, 185, 129, 0.2));
        }
      `}</style>
      <svg
        ref={svgRef}
        className={`w-full h-full ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={e => {
          if ((e.target as Element).closest('[data-node]')) return;
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect || rect.width <= 0) return;
          setDragging(true);
          dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            viewX: view.x,
            viewY: view.y,
            scale: (width / view.k) / rect.width
          };
        }}
        onPointerMove={e => {
          const drag = dragRef.current;
          if (!drag) return;
          setView(prev => ({
            ...prev,
            x: drag.viewX - (e.clientX - drag.startX) * drag.scale,
            y: drag.viewY - (e.clientY - drag.startY) * drag.scale
          }));
        }}
        onPointerUp={() => {
          setDragging(false);
          dragRef.current = null;
        }}
        onPointerLeave={() => {
          setDragging(false);
          dragRef.current = null;
        }}
      >
        <defs>
          <marker id="flow-edge-default" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
          </marker>
          <marker id="flow-edge-true" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
          </marker>
          <marker id="flow-edge-false" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#f43f5e" />
          </marker>
          <marker id="flow-edge-loopback" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#d946ef" />
          </marker>
        </defs>

        {layout.edges.map(edge => {
          const from = layout.positions.get(edge.from);
          const to = layout.positions.get(edge.to);
          if (!from || !to) return null;
          const sx = from.x + NODE_WIDTH;
          const sy = from.y + NODE_HEIGHT / 2;
          const tx = to.x;
          const ty = to.y + NODE_HEIGHT / 2;
          const dx = Math.abs(tx - sx);
          const bend = Math.max(36, dx * 0.55);
          
          const isBack = !!edge.isBackEdge;
          const pathD = isBack
            ? `M ${sx} ${sy} C ${sx + 60} ${sy - 80}, ${tx - 60} ${ty - 80}, ${tx} ${ty}`
            : `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
          
          const markerEnd = isBack
            ? 'url(#flow-edge-loopback)'
            : edge.label === 'T'
              ? 'url(#flow-edge-true)'
              : edge.label === 'F'
                ? 'url(#flow-edge-false)'
                : 'url(#flow-edge-default)';
          
          const strokeColor = isBack ? '#d946ef' : edge.color;
          const key = `${edge.from}->${edge.to}${edge.label ? ':' + edge.label : ''}`;
          
          const mx = (sx + tx) / 2;
          const my = isBack ? (sy + ty) / 2 - 50 : (sy + ty) / 2;
          
          return (
            <g key={key}>
              <path
                d={pathD}
                fill="none"
                stroke={strokeColor}
                strokeWidth={1.5}
                strokeDasharray={isBack ? "4 4" : undefined}
                markerEnd={markerEnd}
                opacity={0.9}
              />
              {edge.label && (
                <g transform={`translate(${mx}, ${my})`}>
                  <rect x={-7} y={-8} width={14} height={16} rx={3} fill="#0f172a" stroke={strokeColor} strokeWidth={1} />
                  <text textAnchor="middle" dy={4} fontSize={9} fontWeight={700} fill={strokeColor} fontFamily={MONO_FONT}>
                    {edge.label}
                  </text>
                </g>
              )}
              {isBack && (
                <g transform={`translate(${mx}, ${my - 12})`}>
                  <rect x={-26} y={-8} width={52} height={15} rx={3} fill="#0f172a" stroke="#d946ef" strokeWidth={1} />
                  <text textAnchor="middle" dy={3.5} fontSize={8} fontWeight={700} fill="#d946ef" fontFamily={MONO_FONT}>
                    Loopback
                  </text>
                </g>
              )}
              {!isBack && onAddNodeBetween && (
                <g
                  className="cursor-pointer group"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddNodeBetween(edge.from, edge.to, edge.label);
                  }}
                >
                  <circle
                    cx={edge.label ? mx + 16 : mx}
                    cy={my}
                    r={9}
                    fill="#0f172a"
                    stroke="#10b981"
                    strokeWidth={1.5}
                    className="group-hover:stroke-emerald-400 group-hover:fill-emerald-950 transition-colors"
                  />
                  <text
                    x={edge.label ? mx + 16 : mx}
                    y={my + 3.5}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight="bold"
                    fill="#10b981"
                    className="group-hover:fill-emerald-400 select-none transition-colors"
                  >
                    +
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {steps.map(step => {
          const pos = layout.positions.get(step.id);
          if (!pos) return null;
          const stroke = TYPE_STROKE[step.type] ?? '#64748b';
          const isSelected = step.id === selectedStepId;
          const rawName = String(step.config?.name || step.id);
          const name = rawName.length > 26 ? `${rawName.slice(0, 25)}…` : rawName;
          const typeLabel = step.type.toUpperCase();
          const badgeW = 14 + typeLabel.length * 6.4;
          const status = stepStatuses?.[step.id];
          const statusColor = status ? STATUS_COLOR[status] : null;
          const statusGlyph = status ? STATUS_GLYPH[status] : '';
          return (
             <g
               key={step.id}
               data-node={step.id}
               transform={`translate(${pos.x}, ${pos.y})`}
               onClick={() => onSelectStep(step.id)}
               tabIndex={0}
               role="button"
               aria-label={`${rawName}, tipo ${typeLabel}, estado ${status || 'pendiente'}`}
               aria-pressed={isSelected}
               onKeyDown={event => {
                 if (event.key === 'Enter' || event.key === ' ') {
                   event.preventDefault();
                   onSelectStep(step.id);
                 }
               }}
               className="cursor-pointer"
             >
              <g className="node-card">
                {isSelected && (
                  <rect x={-3} y={-3} width={NODE_WIDTH + 6} height={NODE_HEIGHT + 6} rx={12} fill="none" stroke="#10b981" strokeWidth={2} />
                )}
                <rect
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx={10}
                  fill={isSelected ? '#1e293b' : '#0f172a'}
                  stroke={stroke}
                  strokeWidth={isSelected ? 2 : 1.5}
                  opacity={isSelected ? 1 : 0.92}
                  className={status === 'running' ? 'node-running' : ''}
                />
                <rect x={10} y={9} width={badgeW} height={16} rx={4} fill={stroke} opacity={0.16} />
                <text x={16} y={20.5} fontSize={9.5} fontWeight={700} letterSpacing={1.2} fill={stroke} fontFamily={MONO_FONT}>
                  {typeLabel}
                </text>
                <text x={12} y={46} fontSize={12.5} fontWeight={600} fill="#e2e8f0" fontFamily={MONO_FONT}>
                  {name}
                </text>
                {status && statusColor && (
                  <g transform={`translate(${NODE_WIDTH - 17}, 15)`}>
                    <circle r={8} fill={statusColor} />
                    <text textAnchor="middle" dy={3} fontSize={10} fontWeight={700} fill="#0f172a" fontFamily={MONO_FONT}>
                      {statusGlyph}
                    </text>
                  </g>
                )}
                {onDeleteStepDirect && (
                  <g
                    className="cursor-pointer group/trash"
                    transform={`translate(${NODE_WIDTH - 8}, -8)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteStepDirect(step.id);
                    }}
                  >
                    <circle
                      r={7}
                      fill="#0f172a"
                      stroke="#ef4444"
                      strokeWidth={1.5}
                      className="group-hover/trash:fill-red-950 transition-colors"
                    />
                    <text
                      textAnchor="middle"
                      dy={2.5}
                      fontSize={9}
                      fontWeight="bold"
                      fill="#ef4444"
                      className="group-hover/trash:fill-red-400 select-none transition-colors"
                    >
                      ×
                    </text>
                  </g>
                )}
              </g>
            </g>
          );
        })}
      </svg>

      <div className="absolute top-2 right-2 flex items-center gap-0.5 bg-slate-900/95 border border-slate-800 rounded-lg px-1.5 py-1 shadow-lg">
         <button type="button" onClick={() => zoomBy(1.25)} className="icon-btn text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition" title="Acercar" aria-label="Acercar grafo">
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
         <button type="button" onClick={() => zoomBy(0.8)} className="icon-btn text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition" title="Alejar" aria-label="Alejar grafo">
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
         <button type="button" onClick={resetView} className="icon-btn text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition" title="Restablecer vista" aria-label="Restablecer vista del grafo">
          <Maximize className="h-3.5 w-3.5" />
        </button>
        <span className="text-[10px] font-mono text-slate-500 pl-1 pr-0.5">{Math.round(view.k * 100)}%</span>
      </div>

      <div className="absolute bottom-2 left-2 text-[10px] font-mono text-slate-500 bg-slate-900/90 border border-slate-800 rounded px-2 py-1">
         Usa rueda o los botones para zoom. Arrastra para mover. Tab y Enter seleccionan nodos.
      </div>
    </div>
  );
};
