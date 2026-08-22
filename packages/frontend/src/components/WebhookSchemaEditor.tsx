import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { SchemaNode, SchemaNodeType } from '@opencode/shared';
import { SCHEMA_TYPES } from '../lib/constants';
import { inferSchemaFromJson } from '../lib/helpers';

export interface WebhookSchemaEditorProps {
  schema: SchemaNode[];
  onChange: (schema: SchemaNode[]) => void;
}

// Interactive payload schema editor for webhook triggers.
export const WebhookSchemaEditor: React.FC<WebhookSchemaEditorProps> = ({ schema, onChange }) => {
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const updateNode = (index: number, patch: Partial<SchemaNode>) => {
    onChange(schema.map((n, i) => (i === index ? { ...n, ...patch } : n)));
  };

  const addField = () => {
    const base = 'field';
    let key = base;
    let counter = 1;
    while (schema.some(n => n.key === key)) {
      key = `${base}_${counter}`;
      counter++;
    }
    onChange([...schema, { key, type: 'string', required: true }]);
  };

  const removeField = (index: number) => {
    onChange(schema.filter((_, i) => i !== index));
  };

  const handleImport = () => {
    setImportError(null);
    let parsed: any;
    try {
      parsed = JSON.parse(importText);
    } catch (e) {
      setImportError('Invalid JSON. Please paste a valid JSON object.');
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setImportError('Please provide a JSON object to infer the schema from.');
      return;
    }
    onChange(inferSchemaFromJson(parsed));
    setImportOpen(false);
    setImportText('');
  };

  const renderNodeRows = (nodes: SchemaNode[], depth: number): React.ReactNode => {
    return nodes.map((node, index) => (
      <div key={`${depth}-${index}`} className="space-y-1">
        <div
          className="grid gap-2 items-center"
          style={{ gridTemplateColumns: `${1.5 + depth * 1.5}rem 1fr 7rem 5rem 1fr 2rem` }}
        >
          <span className="text-slate-600 text-xs select-none" style={{ paddingLeft: depth * 0.5 }}>
            {depth > 0 ? '└' : ''}
          </span>
          <input
            type="text"
            value={node.key}
            onChange={e => updateNode(index, { key: e.target.value })}
            className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
            placeholder="field name"
          />
          <select
            value={node.type}
            onChange={e => updateNode(index, { type: e.target.value as SchemaNodeType })}
            className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            {SCHEMA_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <label className="flex items-center justify-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={node.required}
              onChange={e => updateNode(index, { required: e.target.checked })}
              className="accent-emerald-500 h-3.5 w-3.5"
            />
            <span className="text-[10px] text-slate-500">req</span>
          </label>
          <input
            type="text"
            value={node.description || ''}
            onChange={e => updateNode(index, { description: e.target.value })}
            className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            placeholder="description"
          />
          <button
            type="button"
            onClick={() => removeField(index)}
            className="text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-slate-800 transition"
            title="Remove field"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {node.type === 'array' && (
          <div className="pl-8">
            <label className="block text-[10px] text-slate-500 mb-1">Item Type</label>
            <select
              value={node.itemsType || 'string'}
              onChange={e => updateNode(index, { itemsType: e.target.value as SchemaNodeType })}
              className="w-full max-w-[10rem] bg-slate-900 border border-slate-800 rounded p-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              {SCHEMA_TYPES.filter(t => t !== 'array').map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        )}
        {node.type === 'object' && node.children && node.children.length > 0 && (
          <div className="pl-4 space-y-1">
            {renderNodeRows(node.children, depth + 1)}
          </div>
        )}
      </div>
    ));
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-3 space-y-3 font-sans">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-300">Payload Schema</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setImportOpen(v => !v);
              setImportError(null);
            }}
            className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded border border-slate-700 transition"
          >
            {importOpen ? 'Cancel' : 'Import JSON'}
          </button>
          <button
            type="button"
            onClick={addField}
            className="text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded transition flex items-center gap-1"
          >
            <Plus className="h-3 w-3" />
            Add Field
          </button>
        </div>
      </div>

      {importOpen && (
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
          <span className="text-[10px] text-slate-400 block">
            Paste a sample JSON payload to infer the schema from it.
          </span>
          <textarea
            rows={5}
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder='{ "message": "Build failed", "exitCode": 1, "failed": true }'
            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
          />
          {importError && <span className="text-[10px] text-rose-400">{importError}</span>}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleImport}
              className="text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded transition font-semibold"
            >
              Infer Schema
            </button>
          </div>
        </div>
      )}

      {schema.length === 0 ? (
        <p className="text-[10px] text-slate-500 italic">
          No schema defined. Add fields manually or paste a sample JSON to infer one.
        </p>
      ) : (
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg overflow-x-auto">
          <div
            className="grid gap-2 px-2 py-1.5 border-b border-slate-800 text-[9px] uppercase tracking-wider text-slate-500 font-bold"
            style={{ gridTemplateColumns: `1.5rem 1fr 7rem 5rem 1fr 2rem` }}
          >
            <span />
            <span>Key</span>
            <span>Type</span>
            <span>Required</span>
            <span>Description</span>
            <span />
          </div>
          <div className="p-2 space-y-1">{renderNodeRows(schema, 0)}</div>
        </div>
      )}
    </div>
  );
};