import React, { useEffect, useState } from 'react';
import { Database, Plus, Trash2, FolderPlus, Edit3, X, Check, RefreshCw } from 'lucide-react';

interface DatabasesViewProps {
  onShowNotification: (message: string, type?: 'success' | 'error' | 'info') => void;
}

interface SafeDeleteButtonProps {
  onDelete: () => void;
  title?: string;
  className?: string;
  label?: string;
}

const SafeDeleteButton: React.FC<SafeDeleteButtonProps> = ({
  onDelete,
  title,
  className = '',
  label
}) => {
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (!isConfirming) return;
    const timer = setTimeout(() => {
      setIsConfirming(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [isConfirming]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isConfirming) {
      setIsConfirming(false);
      onDelete();
    } else {
      setIsConfirming(true);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`transition-all duration-300 ease-out flex items-center justify-center gap-1.5 rounded-lg border font-semibold select-none ${
        isConfirming
          ? 'bg-rose-600 border-rose-500 text-white px-2 py-1 text-xs scale-105 shadow-lg shadow-rose-900/40 animate-pulse'
          : className || 'text-slate-500 hover:text-rose-500 p-1.5 bg-slate-900 hover:bg-rose-500/10 border-slate-800'
      }`}
      title={isConfirming ? 'Haz clic de nuevo para confirmar' : title}
    >
      <Trash2 className={`transition-transform duration-300 ${isConfirming ? 'scale-110 rotate-12 h-3.5 w-3.5' : 'h-3.5 w-3.5'}`} />
      {label && !isConfirming && <span className="font-sans text-[11px] tracking-tight">{label}</span>}
      {isConfirming && <span className="font-sans text-[10px] tracking-tight">Confirmar?</span>}
    </button>
  );
};

interface CollectionDeleteButtonProps {
  coll: string;
  onDelete: (collName: string) => void;
}

const CollectionDeleteButton: React.FC<CollectionDeleteButtonProps> = ({ coll, onDelete }) => {
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (!isConfirming) return;
    const timer = setTimeout(() => setIsConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [isConfirming]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isConfirming) {
      setIsConfirming(false);
      onDelete(coll);
    } else {
      setIsConfirming(true);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={isConfirming ? `Confirmar eliminación de ${coll}` : `Eliminar colección ${coll}`}
      className={`icon-btn h-11 w-11 text-[10px] rounded font-sans transition-all duration-200 font-bold ${
        isConfirming ? 'bg-rose-600 text-white animate-pulse' : 'text-slate-500 hover:text-rose-500'
      }`}
      title={isConfirming ? 'Haz clic de nuevo para eliminar' : 'Eliminar colección'}
    >
      {isConfirming ? 'Confirmar?' : '×'}
    </button>
  );
};

export const DatabasesView: React.FC<DatabasesViewProps> = ({ onShowNotification }) => {
  const [databases, setDatabases] = useState<any[]>([]);
  const [selectedDbId, setSelectedDbId] = useState<string | null>(null);
  const [selectedDb, setSelectedDb] = useState<any | null>(null);

  // New DB Form Modal State
  const [isNewDbModalOpen, setIsNewDbModalOpen] = useState(false);
  const [newDbId, setNewDbId] = useState('');
  const [newDbName, setNewDbName] = useState('');

  // Collection and Document state
  const [newCollName, setNewCollName] = useState('');
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [localCollections, setLocalCollections] = useState<string[]>([]);
  const [activeColDocs, setActiveColDocs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [collectionError, setCollectionError] = useState<string | null>(null);

  // Add Document state
  const [isAddDocOpen, setIsAddDocOpen] = useState(false);
  const [docIdInput, setDocIdInput] = useState('');
  const [docJsonInput, setDocJsonInput] = useState('{\n  "name": "example",\n  "value": true\n}');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Edit Document state
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingJsonText, setEditingJsonText] = useState('');
  const [editJsonError, setEditJsonError] = useState<string | null>(null);

  const fetchDatabases = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/databases');
      if (!res.ok) throw new Error(`No se pudieron cargar las bases (${res.status}).`);
      const data = await res.json();
      setDatabases(data);
      setLastUpdated(new Date());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudieron cargar las bases de datos.');
      console.error('Error fetching databases:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDatabaseDetail = async (id: string) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/databases/${id}`);
      if (!res.ok) throw new Error(`No se pudo cargar la base (${res.status}).`);
      const data = await res.json();
      setSelectedDb(data);
      setLastUpdated(new Date());
        // Determine active collection if none is set
        const colls = data.collections ? Object.keys(data.collections) : [];
        if (colls.length > 0 && !activeCollection) {
          setActiveCollection(colls[0]);
        }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudo cargar la base de datos.');
      console.error('Error fetching database detail:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDatabases();
  }, []);

  useEffect(() => {
    if (selectedDbId) {
      fetchDatabaseDetail(selectedDbId);
    } else {
      setSelectedDb(null);
      setActiveCollection(null);
      setLocalCollections([]);
    }
  }, [selectedDbId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedDbId || !activeCollection) {
      setActiveColDocs([]);
      return () => { cancelled = true; };
    }

    fetch(`/api/databases/${selectedDbId}/collections/${activeCollection}`)
      .then(res => res.ok ? res.json() : Promise.reject(new Error(`collection: ${res.status}`)))
      .then(documents => {
        if (!cancelled) { setActiveColDocs(Array.isArray(documents) ? documents : []); setCollectionError(null); }
      })
      .catch(err => {
        if (!cancelled) {
          setActiveColDocs([]);
          setCollectionError('No se pudieron cargar los documentos de esta colección.');
          console.error('Error fetching collection documents:', err);
        }
      });

    return () => { cancelled = true; };
  }, [selectedDbId, activeCollection]);

  // Clean up editing state when active collection changes
  useEffect(() => {
    setEditingDocId(null);
  }, [activeCollection]);

  const handleCreateDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = newDbId.trim();
    const name = newDbName.trim();
    if (!id || !name) {
      onShowNotification('Completa el ID y el nombre de la base.', 'error');
      return;
    }

    try {
      setIsRequesting(true);
      const res = await fetch('/api/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name })
      });
      if (res.ok) {
        const created = await res.json();
        onShowNotification(`Base de datos "${name}" creada.`, 'success');
        setIsNewDbModalOpen(false);
        setNewDbId('');
        setNewDbName('');
        await fetchDatabases();
        setSelectedDbId(created.id);
      } else {
        const err = await res.json();
        onShowNotification(err.error || 'Error al crear la base de datos.', 'error');
      }
    } catch (err: any) {
      onShowNotification(err.message || 'Error al crear la base de datos.', 'error');
    } finally {
      setIsRequesting(false);
    }
  };

  const handleDeleteDatabase = async (id: string) => {
    if (!window.confirm('¿Eliminar esta base de datos y todos sus documentos?')) return;
    try {
      setIsRequesting(true);
      const res = await fetch(`/api/databases/${id}`, { method: 'DELETE' });
      if (res.status === 204 || res.ok) {
        onShowNotification('Base de datos eliminada.', 'success');
        setSelectedDbId(null);
        setSelectedDb(null);
        await fetchDatabases();
      } else {
        onShowNotification('Error al eliminar la base de datos.', 'error');
      }
    } catch (err: any) {
      onShowNotification(err.message || 'Error de red.', 'error');
    } finally {
      setIsRequesting(false);
    }
  };

  const handleAddCollection = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCollName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!name) return;

    const existingColls = selectedDb?.collections ? Object.keys(selectedDb.collections) : [];
    if (existingColls.includes(name) || localCollections.includes(name)) {
      onShowNotification('La colección ya existe.', 'error');
      return;
    }

    setLocalCollections(prev => [...prev, name]);
    setActiveCollection(name);
    setNewCollName('');
    onShowNotification(`Colección "${name}" creada (local). Agrega un documento para guardarla.`, 'info');
  };

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDbId || !activeCollection) return;

    try {
      const parsed = JSON.parse(docJsonInput);
      if (docIdInput.trim()) {
        parsed.id = docIdInput.trim();
      }

      const res = await fetch(`/api/databases/${selectedDbId}/collections/${activeCollection}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });

      if (res.ok) {
        onShowNotification('Documento guardado con éxito.', 'success');
        setIsAddDocOpen(false);
        setDocIdInput('');
        setDocJsonInput('{\n  "name": "example",\n  "value": true\n}');
        setJsonError(null);
        
        // Remove from local collection if it is now persisted
        setLocalCollections(prev => prev.filter(c => c !== activeCollection));

        await fetchDatabaseDetail(selectedDbId);
      } else {
        onShowNotification('Error al guardar el documento.', 'error');
      }
    } catch (err: any) {
      setJsonError('JSON Inválido: ' + err.message);
    }
  };

  const handleSaveEditDocument = async (docId: string) => {
    if (!selectedDbId || !activeCollection) return;

    try {
      const parsed = JSON.parse(editingJsonText);
      parsed.id = docId; // Ensure ID matches

      const res = await fetch(`/api/databases/${selectedDbId}/collections/${activeCollection}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });

      if (res.ok) {
        onShowNotification('Documento actualizado con éxito.', 'success');
        setEditingDocId(null);
        setEditJsonError(null);
        await fetchDatabaseDetail(selectedDbId);
      } else {
        onShowNotification('Error al actualizar el documento.', 'error');
      }
    } catch (err: any) {
      setEditJsonError('JSON Inválido: ' + err.message);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!selectedDbId || !activeCollection) return;

    try {
      const res = await fetch(`/api/databases/${selectedDbId}/collections/${activeCollection}/${docId}`, {
        method: 'DELETE'
      });

      if (res.status === 204 || res.ok) {
        onShowNotification('Documento eliminado.', 'success');
        await fetchDatabaseDetail(selectedDbId);
      } else {
        onShowNotification('Error al eliminar el documento.', 'error');
      }
    } catch (err: any) {
      onShowNotification(err.message || 'Error al eliminar el documento.', 'error');
    }
  };

  const handleDeleteCollection = async (collName: string) => {
    if (!selectedDb || !selectedDbId) return;

    try {
      // If it's a local collection not yet persisted, just remove it from local state
      const isLocalOnly = !selectedDb.collections?.[collName];
      if (isLocalOnly) {
        setLocalCollections(prev => prev.filter(c => c !== collName));
        onShowNotification(`Colección "${collName}" eliminada.`, 'success');
        const remaining = Object.keys(selectedDb.collections || {}).filter(c => c !== collName);
        setActiveCollection(remaining.length > 0 ? remaining[0] : null);
        return;
      }

      const res = await fetch(`/api/databases/${selectedDbId}/collections/${collName}`, {
        method: 'DELETE'
      });

      if (res.ok || res.status === 204) {
        setLocalCollections(prev => prev.filter(c => c !== collName));
        onShowNotification(`Colección "${collName}" eliminada con sus documentos.`, 'success');
        
        const remaining = Object.keys(selectedDb.collections || {}).filter(c => c !== collName);
        setActiveCollection(remaining.length > 0 ? remaining[0] : null);
        await fetchDatabaseDetail(selectedDbId);
      } else {
        onShowNotification('Error al eliminar la colección.', 'error');
      }
    } catch (err: any) {
      onShowNotification(err.message || 'Error al eliminar la colección.', 'error');
    }
  };

  const validateJson = (val: string, isEdit: boolean) => {
    try {
      JSON.parse(val);
      if (isEdit) setEditJsonError(null);
      else setJsonError(null);
    } catch (err: any) {
      if (isEdit) setEditJsonError(err.message);
      else setJsonError(err.message);
    }
  };

  const dbCollections = selectedDb?.collections ? Object.keys(selectedDb.collections) : [];
  const allCollections = Array.from(new Set([...dbCollections, ...localCollections]));
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Database aria-hidden="true" className="h-5 w-5 text-emerald-400" /> Bases de datos locales
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Explora colecciones y documentos JSON locales sin cambiar el modelo de datos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsNewDbModalOpen(true)}
          disabled={isRequesting}
          className="btn-base bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm px-4 rounded-lg border border-emerald-500/30 transition flex items-center gap-1.5"
        >
          <Plus aria-hidden="true" className="h-4 w-4" /> Nueva base de datos
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300" role="status">
        <span>{databases.length} {databases.length === 1 ? 'base disponible' : 'bases disponibles'}</span>
        <span>{lastUpdated ? `Actualizado ${lastUpdated.toLocaleTimeString()}` : 'Aún no actualizado'}</span>
        <button type="button" onClick={fetchDatabases} disabled={isLoading || isRequesting} className="btn-base border border-slate-700 px-3 text-sm hover:bg-slate-800 disabled:opacity-50"><RefreshCw aria-hidden="true" className={`mr-2 inline h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />{isLoading ? 'Actualizando...' : 'Actualizar'}</button>
      </div>
      {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200"><span>{loadError}</span><button type="button" onClick={fetchDatabases} className="btn-base border border-rose-400/50 px-3 text-sm hover:bg-rose-500/20">Reintentar</button></div>}
      {isLoading && <p className="text-sm text-slate-300" role="status">Cargando bases de datos...</p>}

      {/* Floating DB Registration Modal */}
      {isNewDbModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={() => !isRequesting && setIsNewDbModalOpen(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => !isRequesting && setIsNewDbModalOpen(false)}
              aria-label="Cerrar formulario de base de datos"
              className="icon-btn absolute right-3 top-3 text-slate-400 hover:text-slate-100 text-xl font-bold"
            >
              &times;
            </button>
            <h3 className="text-base font-bold text-slate-200 mb-4 border-b border-slate-800 pb-3">Registrar Nueva Base de Datos</h3>
            <form onSubmit={handleCreateDatabase} className="space-y-4">
              <div>
                <label htmlFor="database-id" className="block text-sm font-semibold text-slate-300 mb-1">ID único (minúsculas, sin espacios) *</label>
                <input
                  type="text"
                  id="database-id" placeholder="p. ej. ecommerce_db"
                  value={newDbId}
                  onChange={e => setNewDbId(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                  className="control-base w-full p-2 text-sm font-mono"
                  required
                />
              </div>
              <div>
                <label htmlFor="database-name" className="block text-sm font-semibold text-slate-300 mb-1">Nombre descriptivo *</label>
                <input
                  type="text"
                  id="database-name" placeholder="p. ej. Catálogo"
                  value={newDbName}
                  onChange={e => setNewDbName(e.target.value)}
                  className="control-base w-full p-2 text-sm"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => !isRequesting && setIsNewDbModalOpen(false)}
                  className="btn-base bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 text-sm font-semibold transition"
                >
                  Cancelar
                </button>
                <button type="submit" disabled={isRequesting} className="btn-base bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 text-sm font-semibold transition">
                  {isRequesting ? 'Creando...' : 'Crear base'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {databases.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center flex flex-col items-center">
          <Database className="h-12 w-12 mb-3 opacity-20 text-slate-400" />
          <p className="text-base font-semibold text-slate-200">No hay bases de datos creadas</p>
          <p className="text-sm text-slate-500 mt-1">Haz clic en el botón de arriba para crear una base de datos local JSON.</p>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* Databases Grid Panel */}
          <div className="w-full lg:w-72 shrink-0 space-y-3">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block">Seleccionar DB</span>
            <div className="grid grid-cols-1 gap-2.5">
              {databases.map(db => (
                <button
                  key={db.id}
                  onClick={() => setSelectedDbId(db.id)}
                  className={`p-4 rounded-xl text-left border transition shadow-sm w-full flex items-center justify-between group ${
                    selectedDbId === db.id
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-slate-900 text-slate-300 border-slate-850 hover:bg-slate-800/50 hover:border-slate-800'
                  }`}
                >
                  <div className="min-w-0">
                    <span className="font-bold text-sm block truncate">{db.name}</span>
                    <span className="font-mono text-[10px] text-slate-500 block mt-1 truncate">{db.id}</span>
                  </div>
                  <Database className={`h-4 w-4 shrink-0 transition-transform ${selectedDbId === db.id ? 'scale-110' : 'opacity-40'}`} />
                </button>
              ))}
            </div>
          </div>

          {/* Database Editor Panel */}
          <div className="flex-1 w-full min-w-0 bg-slate-900 border border-slate-850 rounded-xl p-6 shadow-md min-h-[500px] flex flex-col justify-between">
            {selectedDb ? (
              <div className="space-y-6">
                {/* DB Header */}
                <div className="flex justify-between items-start gap-4 pb-5 border-b border-slate-850">
                  <div>
                    <h4 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                      {selectedDb.name}
                      <span className="text-xs text-slate-500 font-mono bg-slate-955 px-2 py-0.5 rounded">ID: {selectedDb.id}</span>
                    </h4>
                     <p className="mt-1 text-sm text-slate-300">
                       Creada: {new Date(selectedDb.createdAt).toLocaleString()} · Actualizada: {new Date(selectedDb.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <SafeDeleteButton
                    onDelete={() => handleDeleteDatabase(selectedDb.id)}
                    className="bg-rose-600/10 hover:bg-rose-600 hover:text-white text-rose-500 text-xs px-3 py-1.5 rounded-lg border border-rose-500/30 transition flex items-center gap-1 font-semibold"
                    label="Eliminar DB"
                    title="Eliminar base de datos completa"
                  />
                </div>

                {/* Collections Manager */}
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Colecciones</span>
                    <form onSubmit={handleAddCollection} className="flex items-center gap-2 max-w-xs w-full">
                      <input
                        type="text"
                        placeholder="Nueva colección"
                        value={newCollName}
                        onChange={e => setNewCollName(e.target.value)}
                        aria-label="Nombre de nueva colección"
                        className="control-base min-h-11 flex-1 p-1.5 text-xs font-mono"
                      />
                      <button
                        type="submit"
                        disabled={isRequesting}
                        className="btn-base bg-slate-850 hover:bg-slate-800 disabled:opacity-50 text-slate-200 text-xs px-3 border border-slate-700 transition flex items-center gap-1 shrink-0 font-semibold"
                      >
                        <FolderPlus className="h-3.5 w-3.5" /> Crear
                      </button>
                    </form>
                  </div>

                  {/* Collection Tabs */}
                  {allCollections.length === 0 ? (
                    <div className="bg-slate-955/50 border border-slate-850 rounded-lg p-6 text-center text-xs text-slate-500 italic">
                      No hay colecciones creadas. Usa el formulario de arriba para crear una.
                    </div>
                  ) : (
                    <div className="border-b border-slate-800">
                      <div className="flex flex-wrap -mb-px">
                        {allCollections.map(coll => (
                          <button
                            key={coll}
                            onClick={() => setActiveCollection(coll)}
                            className={`px-4 py-2 border-b-2 font-mono text-xs font-semibold transition-all flex items-center gap-2 ${
                              activeCollection === coll
                                ? 'border-emerald-500 text-emerald-450 bg-emerald-500/5'
                                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-800'
                            }`}
                          >
                            {coll}
                            <CollectionDeleteButton coll={coll} onDelete={handleDeleteCollection} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Documents Viewer */}
                {activeCollection && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-slate-955/50 p-3 rounded-lg border border-slate-850">
                       <span className="text-sm font-bold text-slate-300">
                         Colección activa: <span className="font-mono text-emerald-300">"{activeCollection}"</span> · {activeColDocs.length} documentos
                      </span>
                         <button
                           type="button"
                           onClick={() => setIsAddDocOpen(true)}
                           className="btn-base bg-emerald-600/10 hover:bg-emerald-600 hover:text-white text-emerald-400 text-xs px-3 border border-emerald-500/30 transition flex items-center gap-1 font-semibold"
                      >
                        <Plus className="h-3.5 w-3.5" /> Agregar Documento
                      </button>
                    </div>

                    {/* Add Document panel */}
                    {isAddDocOpen && (
                      <div className="bg-slate-955 border border-slate-800 rounded-lg p-4 space-y-3">
                        <div className="flex justify-between items-center pb-2 border-b border-slate-850">
                          <span className="text-xs font-bold text-slate-350">Nuevo Documento JSON</span>
                           <button type="button" onClick={() => { if (window.confirm('¿Descartar el documento en edición?')) setIsAddDocOpen(false); }} aria-label="Descartar documento" className="icon-btn text-slate-400 hover:text-slate-200">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <form onSubmit={handleAddDocument} className="space-y-3">
                          <div>
                             <label htmlFor="document-id" className="block text-sm font-semibold text-slate-300 mb-1">ID del documento (opcional)</label>
                            <input
                              type="text"
                               id="document-id" placeholder="p. ej. doc_1234"
                              value={docIdInput}
                              onChange={e => setDocIdInput(e.target.value)}
                               className="control-base w-full p-1.5 text-xs font-mono"
                            />
                          </div>
                          <div>
                             <label htmlFor="document-json" className="block text-sm font-semibold text-slate-300 mb-1">Documento JSON</label>
                            <textarea
                               id="document-json" rows={8} aria-invalid={!!jsonError} aria-describedby={jsonError ? 'document-json-error' : undefined}
                              value={docJsonInput}
                              onChange={e => {
                                setDocJsonInput(e.target.value);
                                validateJson(e.target.value, false);
                              }}
                               className="control-base w-full p-2 text-sm leading-6 font-mono"
                            />
                            {jsonError && (
                               <p id="document-json-error" role="alert" className="mt-1 text-sm text-rose-300 font-mono">JSON inválido: {jsonError}</p>
                            )}
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setIsAddDocOpen(false)}
                              className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-semibold transition"
                            >
                              Cancelar
                            </button>
                            <button
                              type="submit"
                               disabled={!!jsonError || isRequesting}
                              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-3 py-1.5 rounded text-xs font-semibold transition"
                            >
                              Guardar
                            </button>
                          </div>
                        </form>
                      </div>
                    )}

                     {collectionError && <div role="alert" className="flex items-center justify-between gap-3 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200"><span>{collectionError}</span><button type="button" onClick={() => selectedDbId && activeCollection && fetch(`/api/databases/${selectedDbId}/collections/${activeCollection}`).then(response => response.json()).then(setActiveColDocs)} className="btn-base border border-rose-400/50 px-3 text-sm">Reintentar</button></div>}

                     {/* Document cards */}
                    {activeColDocs.length === 0 ? (
                      <div className="bg-slate-955/50 border border-slate-850 rounded-lg p-8 text-center text-xs text-slate-500 italic">
                        No hay documentos en esta colección.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {activeColDocs.map((doc: any) => {
                          const isEditing = editingDocId === doc.id;
                          const jsonText = JSON.stringify(doc, null, 2);

                          return (
                            <div key={doc.id} className="bg-slate-955 border border-slate-850 p-4 rounded-xl flex flex-col justify-between shadow-sm relative group">
                              <div className="flex justify-between items-center mb-2.5 pb-2 border-b border-slate-800">
                                <span className="font-mono text-xs font-bold text-emerald-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800 select-all">
                                  {doc.id}
                                </span>
                                <div className="flex items-center gap-1">
                                  {isEditing ? (
                                    <>
                                      <button
                                        onClick={() => handleSaveEditDocument(doc.id)}
                                        disabled={!!editJsonError}
                                        className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded transition border border-transparent hover:border-emerald-500/20"
                                        title="Guardar cambios"
                                      >
                                        <Check className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        onClick={() => {
                                          setEditingDocId(null);
                                          setEditJsonError(null);
                                        }}
                                        className="p-1 text-slate-400 hover:bg-slate-800 rounded transition border border-transparent hover:border-slate-700"
                                        title="Cancelar"
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        onClick={() => {
                                          setEditingDocId(doc.id);
                                          setEditingJsonText(jsonText);
                                          setEditJsonError(null);
                                        }}
                                        className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition border border-transparent hover:border-slate-700"
                                        title="Editar documento"
                                      >
                                        <Edit3 className="h-3.5 w-3.5" />
                                      </button>
                                       <SafeDeleteButton
                                          onDelete={() => handleDeleteDocument(doc.id)}
                                          className="p-1 text-slate-505 hover:text-rose-500 hover:bg-rose-500/10 rounded transition border border-transparent hover:border-rose-500/20"
                                          title="Eliminar documento"
                                       />
                                    </>
                                  )}
                                </div>
                              </div>

                              {isEditing ? (
                                <div className="space-y-2 flex-1">
                                  <textarea
                                    rows={8}
                                    value={editingJsonText}
                                    onChange={e => {
                                      setEditingJsonText(e.target.value);
                                      validateJson(e.target.value, true);
                                    }}
                                     id={`edit-json-${doc.id}`} aria-label={`Editar JSON del documento ${doc.id}`} aria-invalid={!!editJsonError} className="control-base w-full p-2 text-sm leading-6 font-mono"
                                  />
                                  {editJsonError && (
                                     <p role="alert" className="mt-1 text-sm text-rose-300 font-mono">JSON inválido: {editJsonError}</p>
                                  )}
                                </div>
                              ) : (
                                <pre className="bg-slate-900 border border-slate-800 p-3 rounded-lg font-mono text-[11px] overflow-auto max-h-48 text-emerald-500/90 whitespace-pre-wrap select-all flex-1">
                                  {jsonText}
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-20">
                <Database className="h-16 w-16 mb-4 text-slate-700 opacity-50" />
                <p className="text-slate-400 font-semibold">Ninguna Base de Datos Seleccionada</p>
                <p className="text-xs text-slate-505 mt-1 max-w-[280px]">
                  Elige una base de datos de la lista de la izquierda para explorar sus colecciones y documentos en tiempo real.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
