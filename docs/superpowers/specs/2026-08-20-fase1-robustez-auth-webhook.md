# Spec Fase 1 — Cimientos de robustez + Auth de webhook configurable

**Fecha:** 2026-08-20
**Proyecto:** OpenCode Orchestrator
**Roadmap:** ver `docs/roadmap.md` (Fase 1)
**Estado:** Aprobado — listo para implementar

---

## 1. Objetivo

Poner cimientos de robustez en el backend y añadir autenticación de webhook configurable. Esta fase es la base de todo el rework; no debe romper el contrato de datos de la UI y debe mantener retrocompatibilidad Bearer en webhooks.

## 2. Alcance

| ID | Mejora | Archivos |
|----|--------|----------|
| A1 | Idempotencia de webhooks (dedup por clave de evento con TTL) | `executor.ts`, `server.ts` |
| A2 | Reintentos configurables por nodo + política de error por paso | `executor.ts`, `types.ts` |
| A4 | Recuperación tras reinicio (`recoverStale`) | `queue.ts`, `index.ts`, `executor.ts` |
| A5 | Kill de procesos hijos en timeout (sin solapamiento) | `queue.ts`, `runner.ts` |
| A6 | Escritura atómica en store (write-to-temp + rename) | `store.ts` |
| A7 | Operaciones atómicas / CAS con versión | `store.ts` |
| B1 | Auth de webhook configurable: Bearer \| HMAC (timestamp+nonce) \| token rotado | `server.ts`, `types.ts` |

## 3. Diseño técnico

### A1 — Idempotencia de webhooks
- `WorkflowExecutor.createExecution` recibe un parámetro opcional `idempotencyKey?: string`.
- Cuando se proporciona, antes de crear la ejecución se consulta el store por `executions` cuyo `idempotencyKey` coincida (nuevo campo opcional en `Execution`). Si existe, devuelve su `id` sin crear otra.
- El webhook (`server.ts`) calcula la clave: `sha256(connectionId + ':' + canonical(JSON.stringify(req.body)))`. Para soportar reintentos de proveedor (p.ej. header `X-GitHub-Event` + `X-GitHub-Delivery`), si el header `X-Idempotency-Key` viene, se usa ese; si no, el hash del body.
- TTL: opcional por configuración de conexión (default 24h). El dedup solo aplica a ejecuciones recientes.

### A2 — Reintentos por paso
- Nuevo campo opcional en `WorkflowStep.config`: `retries?: number`, `retryDelayMs?: number`.
- En `runExecution`, envolver `executeStep` en un lazo: reintenta hasta `retries` veces ante excepción, con `retryDelayMs` de espera.
- Política de error: al agotar reintentos, el paso falla igual que hoy (aborta el workflow) salvo `config.onError?: 'fail' | 'continue'`. Con `continue`, se registra un log warn y se avanza por `nextStepIds[0]`.
- No cambiar el comportamiento por defecto (fail) para no alterar flujos existentes.

### A4 — Recuperación tras reinicio
- Nuevo método `ProjectQueueManager.recoverStale(store, executor, projectId)` o función en `index.ts` al arrancar: lista ejecuciones con `status` en `('queued','running')` sin `completedAt`, y las re-encola o las marca `failed` con mensaje "recuperada tras reinicio" según política.
- Simplicidad: las ejecuciones `queued`/`running` huérfanas se re-encolan vía `executor` para que el flujo normal las procese. Se registra un log.
- Llamar desde `index.ts` después de `createServer`.

### A5 — Kill de procesos hijos en timeout
- En `queue.ts`, reemplazar `Promise.race` con `setTimeout` que, además de rechazar, dispare un `AbortController`.
- El `runCallback` debe aceptar una señal de cancelación. `WorkflowExecutor.runExecution` recibe `signal?: AbortSignal` y la propaga a `runner.run` y `executeShell`.
- `runner.ts`: usar `AbortSignal` para matar el proceso `opencode` (tree-kill: en Windows `taskkill /pid <pid> /T /F`; en POSIX kill al grupo). 
- `executeShell` (en `executor.ts`): al abortar, matar el proceso hijo y el árbol.

### A6 — Escritura atómica en store
- `FileStateStore.set`: escribir a `{filePath}.tmp` y luego `fs.rename` (atómico en el mismo volumen). 
- `get`: si el JSON está corrupto (parse falla), retornar `null` con un log warn en vez de lanzar (evita que una ejecución muera por un archivo corrupto).
- `delete`: mantener.

### A7 — Operaciones atómicas / CAS
- Añadir a `IStateStore` (en `types.ts`) un método opcional:
  `compareAndSwap<T>(collection, docId, expectedVersion, data): Promise<boolean>`.
- `FileStateStore` lo implementa leyendo, comparando `data.version`, y escribiendo atómicamente con `version + 1`.
- `Execution` recibe un campo opcional `version?: number` incrementado en cada `set`/`update`.
- Uso en transiciones de estado del executor (p.ej. `approveExecution` para evitar doble resume). Mínimo viable: implementar la primitiva y usarla donde hoy hay read-modify-write sensible.

### B1 — Auth de webhook configurable
- Nuevo campo en `Connection`: `authType?: 'bearer' | 'hmac'`.
  - `bearer` (default, retrocompatible): comportamiento actual (tokenHash).
  - `hmac`: la conexión guarda `secretHash` (hash de un secreto compartido). El webhook valida una firma HMAC-SHA256 sobre el body usando el secreto, con `X-Timestamp` (ventana de ±5 min) y `X-Nonce` (protección anti-replay).
- El secreto compartido se genera al crear la conexión y se devuelve una sola vez como `rawSecret` (nunca se vuelve a exponer).
- `syncWorkflowTriggers` y `POST /api/connections` aceptan `authType` desde el config del step/body.
- El webhook `POST /webhooks/:connectionId` despacha según `connection.authType`.
- Token rotado por conexión: mantener `regenerateToken`/`regenerateSecret` para rotar.

## 4. Contrato de datos (shared)

Cambios en `packages/shared/src/types.ts`:

```typescript
// En Execution
idempotencyKey?: string;
version?: number;

// En WorkflowStep.config (documentado, no tipado estricto)
// retries?, retryDelayMs?, onError?: 'fail' | 'continue'

// En Connection
authType?: 'bearer' | 'hmac';
secretHash?: string;

// IStateStore
compareAndSwap?<T>(collection: string, docId: string, expectedVersion: number, data: T): Promise<boolean>;
```

Todos los campos nuevos son **opcionales** para no romper la lectura de documentos existentes ni la UI.

## 5. Aceptación

- `npm run build` sin errores.
- Un webhook duplicado (mismo body + misma connectionId) crea una única ejecución (A1).
- Un paso con `retries: 2` que falla la primera vez y acierta la segunda completa con éxito (A2).
- Ejecuciones `running`/`queued` huérfanas se reconcilian al reiniciar (A4).
- Un comando que excede el timeout termina y su proceso hijo es matado (A5).
- No hay archivo JSON corrupto tras un corte simulado en `set` (A6).
- `POST /webhooks/:id` funciona con Bearer (sin cambios) y con HMAC + timestamp + nonce (B1); firmas viejas o repetidas son rechazadas.

## 6. Notas de implementación

- Desplegar los subagentes F1a-F1d en paralelo sobre archivos disjuntos (ver roadmap).
- Orden interno recomendado si hay solapamiento: A6/A7 (store) primero, luego A1/A2/A4/A5 (executor/queue), luego B1 (server).
- Mantener la retrocompatibilidad Bearer por defecto en todo momento.
