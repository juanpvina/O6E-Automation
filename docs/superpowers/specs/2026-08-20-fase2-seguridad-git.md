# Spec Fase 2 — Seguridad restante + git endurecido

**Fecha:** 2026-08-20 | **Proyecto:** OpenCode Orchestrator | **Roadmap:** Fase 2
**Estado:** Aprobado — listo para implementar

## 1. Objetivo
Cerrar huecos de seguridad y endurecer el acceso a git. No altera el contrato de la UI salvo lo indicado.

## 2. Alcance

| ID | Mejora | Archivos |
|----|--------|----------|
| B2 | Auth de la API `/api/*` (token de acceso local) | `server.ts`, `index.ts` |
| B3 | Sandbox de condiciones (sin `new Function` con globals peligrosos) | `executor.ts` |
| B4 | Redacción completa de secretos (shell/git/errores + caché) | `executor.ts`, `secrets.ts` |
| B5 | git.ts endurecido (spawn con args, sin mock, errores explícitos) | `git.ts` |

## 3. Diseño

### B2 — Auth de API
- Token de acceso local: se lee de `process.env.ORCHESTRATOR_API_TOKEN`. Si está definido, `GET/POST/PUT/DELETE /api/*` exigen `Authorization: Bearer <token>` (middleware Express antes de las rutas `/api`). El webhook `/webhooks/:connectionId` queda excluido (usa su propia auth).
- El frontend añade el header cuando el token está configurado (solo si `VITE_ORCHESTRATOR_API_TOKEN` está definido). Si no hay token configurado, la API sigue abierta en localhost (retrocompatible).

### B3 — Sandbox de condiciones
- Reemplazar `evaluateJSExpression` (`executor.ts:669-678`) por un evaluador que construye una función con `new Function` **sin** exponer globals peligrosos: definir un sandbox que provea únicamente `context` y helpers whitelist (p.ej. `includes`, `length`, operadores de comparación), sin `process`, `require`, `global`, `fetch`, `eval`.
- Fallback: si la expresión referencia identificadores no permitidos, la condición evalúa a `false` con log warn.

### B4 — Redacción completa de secretos
- Extraer la redacción a un helper reutilizable con caché de secretos descifrados por proyecto (evita `list`+decrypt por cada línea).
- Aplicar redacción en: logs del paso `agent` (ya existe), logs de `shell_test`, logs de `git`/`pr`, y en el mensaje de error de los pasos (`errorMessage`).
- Umbral de longitud mínima revisado (hoy `> 5`); mantener mínimo para no redactar valores triviales.

### B5 — git.ts endurecido
- `runCommand`: quitar `shell: true`; pasar args como array estructurado. Ajustar la invocación de `gh` para no interpolar comillas en title/body (pasarlos como argumentos separados).
- `push`: en lugar de ignorar el error con warning, lanzar si falla (salvo flag `allowFailure` para mocks locales).
- `createPullRequest`: quitar el PR mock por defecto; añadir flag `allowMock` (default false). Si `gh` falla y `allowMock` es false, lanzar error explícito.
- No revertir el comportamiento local de desarrollo cuando el entorno lo exige (controlarlo por flags).

## 4. Aceptación
- Con `ORCHESTRATOR_API_TOKEN` definido, `/api/*` rechaza sin token; sin él, sigue abierto.
- Una condición con `process.exit` o `fetch` evalúa a `false` y loguea warn, no ejecuta.
- Los secretos no aparecen en logs de shell/git ni en `errorMessage`.
- `git push` fallido lanza error; `gh pr create` fallido no genera un PR falso.
- `npm run build` sin errores.
