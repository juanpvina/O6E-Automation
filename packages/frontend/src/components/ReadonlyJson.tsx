import React from 'react';

// Read-only JSON tree renderer for the step detail panel. Compact and safe for
// arbitrary execution outputs (strings, objects, arrays, primitives).
export const ReadonlyJson: React.FC<{ data: any }> = ({ data }) => {
  const renderValue = (value: any, depth: number): React.ReactNode => {
    const indent = { paddingLeft: `${depth * 14}px` };
    if (value === null) return <span className="text-slate-500">null</span>;
    if (value === undefined) return <span className="text-slate-500">undefined</span>;
    if (typeof value === 'string') return <span className="text-emerald-400 break-all">"{value}"</span>;
    if (typeof value === 'number' || typeof value === 'boolean') return <span className="text-amber-300">{String(value)}</span>;
    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-slate-500">[]</span>;
      return (
        <div>
          <span className="text-slate-400">[</span>
          <div style={indent}>
            {value.map((item, i) => (
              <div key={i} className="text-left">
                <span className="text-slate-600">{i}: </span>
                {renderValue(item, depth + 1)}
              </div>
            ))}
          </div>
          <div style={{ paddingLeft: `${(depth - 1) * 14}px` }} className="text-slate-400">]</div>
        </div>
      );
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 0) return <span className="text-slate-500">{'{}'}</span>;
      return (
        <div>
          <span className="text-slate-400">{'{'}</span>
          <div style={indent}>
            {keys.map(k => (
              <div key={k} className="text-left">
                <span className="text-sky-400">"{k}"</span>
                <span className="text-slate-500">: </span>
                {renderValue(value[k], depth + 1)}
              </div>
            ))}
          </div>
          <div style={{ paddingLeft: `${(depth - 1) * 14}px` }} className="text-slate-400">{'}'}</div>
        </div>
      );
    }
    return <span>{String(value)}</span>;
  };

  if (data === undefined) return <span className="text-slate-500">Sin datos</span>;
  return <div className="font-mono text-xs text-slate-300 leading-relaxed">{renderValue(data, 0)}</div>;
};