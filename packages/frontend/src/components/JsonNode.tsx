import React, { useState } from 'react';
import { Copy } from 'lucide-react';

export interface JsonNodeProps {
  label: string;
  value: any;
  path: string;
  stepId: string;
  isLast?: boolean;
  onCopy: (text: string) => void;
}

// Interactive JSON node with copyable `{{context.stepOutputs...}}` paths.
export const JsonNode: React.FC<JsonNodeProps> = ({ label, value, path, stepId, isLast = true, onCopy }) => {
  const [isOpen, setIsOpen] = useState(true);
  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);

  const fullPath = `{{context.stepOutputs.${stepId}.${path}}}`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    onCopy(text);
  };

  if (isObject) {
    const keys = Object.keys(value);
    const bracketOpen = isArray ? '[' : '{';
    const bracketClose = isArray ? ']' : '}';

    return (
      <div className="font-mono text-xs pl-4 my-0.5 text-left">
        <div className="flex items-center gap-1.5 group select-none">
          <button 
            type="button" 
            onClick={() => setIsOpen(!isOpen)} 
            className="text-slate-500 hover:text-slate-300 font-semibold"
          >
            {isOpen ? '▼' : '▶'}
          </button>
          <span className="text-purple-400 font-semibold">"{label}":</span>
          <span className="text-slate-400">{bracketOpen}</span>
          <button
            type="button"
            onClick={() => copyToClipboard(fullPath)}
            className="opacity-0 group-hover:opacity-100 text-[10px] text-slate-400 hover:text-emerald-400 bg-slate-900 border border-slate-800 px-1 py-0.5 rounded transition flex items-center gap-1 ml-2"
            title={`Copy path: ${fullPath}`}
          >
            <Copy className="h-2.5 w-2.5" />
            <span>Copy Path</span>
          </button>
        </div>
        
        {isOpen && (
          <div className="border-l border-slate-800 my-0.5 ml-2">
            {keys.map((key, index) => (
              <JsonNode
                key={key}
                label={key}
                value={value[key]}
                path={path ? `${path}.${key}` : key}
                stepId={stepId}
                isLast={index === keys.length - 1}
                onCopy={onCopy}
              />
            ))}
          </div>
        )}
        <div className="text-slate-400 pl-4">
          {bracketClose}{!isLast && ','}
        </div>
      </div>
    );
  }

  let valDisplay = JSON.stringify(value);
  let valClass = 'text-amber-300';
  if (typeof value === 'number') valClass = 'text-sky-300';
  if (typeof value === 'boolean') valClass = 'text-emerald-400';
  if (value === null) valClass = 'text-slate-500';

  return (
    <div className="font-mono text-xs pl-8 py-0.5 flex items-center gap-1.5 group hover:bg-slate-900/40 rounded transition text-left">
      <span className="text-blue-400 font-semibold">"{label}":</span>
      <span className={valClass}>{valDisplay}</span>
      {!isLast && <span className="text-slate-500">,</span>}
      
      <button
        type="button"
        onClick={() => copyToClipboard(fullPath)}
        className="opacity-0 group-hover:opacity-100 text-[10px] text-slate-400 hover:text-emerald-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded transition flex items-center gap-1 ml-2"
        title={`Copy path: ${fullPath}`}
      >
        <Copy className="h-2.5 w-2.5" />
        <span>Copy Path</span>
      </button>
    </div>
  );
};