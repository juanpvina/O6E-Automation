import React, { useEffect, useState } from 'react';
import { Play, RefreshCw } from 'lucide-react';
import { API_ENDPOINTS } from '../lib/constants';

// Interactive API Reference Developer Console.
export const ApiReferenceConsole: React.FC = () => {
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('list-workflows');
  const [payloadInputs, setPayloadInputs] = useState<string>('');
  const [urlParams, setUrlParams] = useState<Record<string, string>>({});
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const endpoints = API_ENDPOINTS;

  const currentEndpoint = endpoints.find(e => e.id === selectedEndpoint) || endpoints[0];

  useEffect(() => {
    setPayloadInputs(currentEndpoint.defaultPayload);
    setApiResponse(null);
    setResponseStatus(null);
    setRequestError(null);
    const initialParams: Record<string, string> = {};
    if (currentEndpoint.params) {
      currentEndpoint.params.forEach(p => {
        initialParams[p] = '';
      });
    }
    setUrlParams(initialParams);
  }, [selectedEndpoint]);

  const handleSendRequest = async () => {
    setIsLoading(true);
    setApiResponse(null);
    setRequestError(null);
    try {
      let url = currentEndpoint.path;
      if (currentEndpoint.params) {
        currentEndpoint.params.forEach(p => {
          url = url.replace(`:${p}`, urlParams[p] || '');
        });
      }

      const options: RequestInit = {
        method: currentEndpoint.method,
        headers: currentEndpoint.headers
      };

      if (['POST', 'PUT'].includes(currentEndpoint.method) && payloadInputs) {
        try {
          JSON.parse(payloadInputs);
        } catch {
          setRequestError('El cuerpo de la solicitud no contiene JSON válido.');
          setIsLoading(false);
          return;
        }
        options.body = payloadInputs;
      }

      const response = await fetch(url, options);
      setResponseStatus(response.status);
      let data;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = { status: response.status, statusText: response.statusText };
      }
      if (!response.ok) {
        setRequestError(`La API respondió ${response.status} ${response.statusText || 'con un error'}.`);
      }
      setApiResponse(data);
    } catch (error: any) {
      setResponseStatus(null);
      setRequestError('No se pudo completar la solicitud. Revisa la API local y los parámetros.');
      setApiResponse({ error: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-left">
      {/* Endpoint Selector Sidebar */}
      <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
        <h3 className="text-base font-bold text-slate-100 mb-1 px-2">Referencia de API</h3>
        <p className="text-sm text-slate-300 mb-3 px-2">Selecciona un endpoint para probar la API local.</p>
        <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
          {endpoints.map(e => {
            const isSelected = selectedEndpoint === e.id;
            let methodBadge = 'bg-blue-500/10 text-blue-400 border-blue-500/20';
            if (e.method === 'POST') methodBadge = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
            if (e.method === 'PUT') methodBadge = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
            if (e.method === 'DELETE') methodBadge = 'bg-rose-500/10 text-rose-400 border-rose-500/20';

            return (
              <button
                key={e.id}
                  type="button"
                  onClick={() => setSelectedEndpoint(e.id)}
                  aria-pressed={isSelected}
                  aria-label={`${e.method} ${e.path}: ${e.description}`}
                className={`w-full text-left p-3 rounded-lg border transition flex flex-col gap-1.5 ${
                  isSelected 
                    ? 'bg-slate-800 border-emerald-500/40 shadow-sm' 
                    : 'bg-slate-950 border-slate-800 hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${methodBadge}`}>
                    {e.method}
                  </span>
                  <span className="font-mono text-xs font-semibold text-slate-300 truncate">{e.path}</span>
                </div>
                <span className="text-[11px] text-slate-500 line-clamp-1">{e.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Endpoint Console / Workspace */}
      <div className="lg:col-span-8 space-y-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          {/* Header */}
          <div className="border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <span className={`px-2.5 py-1 rounded text-xs font-bold border uppercase ${
                currentEndpoint.method === 'POST' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                currentEndpoint.method === 'PUT' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                currentEndpoint.method === 'DELETE' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                'bg-blue-500/10 text-blue-400 border-blue-500/20'
              }`}>
                {currentEndpoint.method}
              </span>
              <h3 className="font-mono text-base font-bold text-slate-100">{currentEndpoint.path}</h3>
            </div>
            <p className="text-sm text-slate-400 mt-2">{currentEndpoint.description}</p>
          </div>

          {/* Request Config */}
          <div className="space-y-4">
             <h4 className="text-base font-bold text-slate-100">Configurar solicitud</h4>
            
            {/* Headers */}
            {Object.keys(currentEndpoint.headers).length > 0 && (
              <div className="space-y-1.5">
                 <span className="text-sm font-semibold text-slate-300 block">Encabezados</span>
                <div className="bg-slate-950 border border-slate-800 p-3 rounded-lg font-mono text-xs text-slate-300">
                  {Object.entries(currentEndpoint.headers).map(([k, v]) => (
                    <div key={k}>{k}: {v}</div>
                  ))}
                </div>
              </div>
            )}

            {/* URL Params */}
            {currentEndpoint.params && currentEndpoint.params.length > 0 && (
              <div className="space-y-3">
                 <span className="text-sm font-semibold text-slate-300 block">Parámetros de la URL</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {currentEndpoint.params.map(p => (
                    <div key={p}>
                       <label htmlFor={`api-param-${p}`} className="block text-sm font-semibold text-slate-300 mb-1 font-mono">:{p}</label>
                      <input
                        type="text"
                         id={`api-param-${p}`} placeholder={`Introduce ${p}`}
                        value={urlParams[p] || ''}
                        onChange={e => setUrlParams({ ...urlParams, [p]: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Request Body Payload */}
            {['POST', 'PUT'].includes(currentEndpoint.method) && (
              <div className="space-y-1.5">
                 <label htmlFor="api-payload" className="text-sm font-semibold text-slate-300 block">Cuerpo de la solicitud (JSON)</label>
                <textarea
                  rows={8}
                   id="api-payload" value={payloadInputs}
                  onChange={e => setPayloadInputs(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>
            )}

            {/* Action button */}
            <div className="flex justify-end pt-2">
              <button
                onClick={handleSendRequest}
                disabled={isLoading}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Ejecutando...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    <span>Enviar solicitud</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* API Response Display */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex justify-between items-center border-b border-slate-800 pb-3">
             <h4 className="text-base font-bold text-slate-100">Respuesta de la API</h4>
            {apiResponse && (
              <span className="text-[10px] bg-slate-950 border border-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">
                 Estado: {responseStatus ?? (apiResponse.error ? 'error' : 'sin estado')}
              </span>
            )}
          </div>

           {requestError && <p role="alert" className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{requestError} {apiResponse?.error ? `Detalle: ${apiResponse.error}` : ''}</p>}
           <div className="bg-black border border-slate-800 rounded-lg p-4 min-h-[150px] overflow-auto max-h-[350px] font-mono text-sm text-slate-300">
            {apiResponse ? (
              <pre className="whitespace-pre-wrap select-text">{JSON.stringify(apiResponse, null, 2)}</pre>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-600 select-none py-10">
                 Configura los parámetros y pulsa «Enviar solicitud» para consultar la API local.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
