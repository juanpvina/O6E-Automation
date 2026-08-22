# Spec Fase 3 — Funcionalidad de workflows

**Fecha:** 2026-08-20 | **Proyecto:** OpenCode Orchestrator | **Roadmap:** Fase 3
**Estado:** Aprobado — listo para implementar

## 1. Objetivo
Ampliar el motor de ejecución y los adaptadores de salida. Toca el contrato de `shared` y la UI del editor.

## 2. Alcance

| ID | Mejora | Archivos |
|----|--------|----------|
| C1 | Nodos `parallel` (fork/join), `loop`, `retry`, `wait` | `executor.ts`, `types.ts`, `App.tsx` |
| C2 | Expresiones más ricas (ternarios, transformaciones) | `executor.ts`, `App.tsx` |
| C3 | Output adapters reales (webhook saliente, Firebase, notificaciones) | `executor.ts`, `types.ts`, `App.tsx` |

## 3. Diseño

### C1 — Nuevos tipos de paso
Añadir a `StepType` (opcional, sin romper existentes):
- `'parallel'` — config: `{ branches?: string[] }` o usa `nextStepIds` como ramas; ejecuta los siguientes en paralelo (`Promise.all`), con join al final.
- `'loop'` — config: `{ itemsExpr?, itemVar?, maxIterations? }`; itera sobre una lista del contexto ejecutando el subgrafo apuntado.
- `'retry'` — envoltorio: aplica reintentos a un paso hijo (relacionado con A2 de Fase 1).
- `'wait'` — config: `{ durationMs? }`; pausa determinística.

El ejecutor debe mantener el bucle actual pero soportar estos nodos. La UI del editor agrega los nuevos tipos a la paleta e inspectores.

### C2 — Expresiones
- Ampliar `evaluateExpression`/`interpolateString` para soportar ternarios (`{{ cond ? a : b }}`) y operadores de transformación básicos (uppercase, length, json).
- Mantener la sintaxis `{{...}}` existente para no romper plantillas previas.

### C3 — Output adapters
- `outputType: 'webhook'/'http'`: ya existe con fetch; asegurar soporte a secreto en headers (referencia `{{secrets.KEY}}` redactado en logs).
- `outputType: 'firebase'`: implementar un adaptador real configurado por secretos (`firebase_key`, service account), escribiendo un documento versionado en una colección controlada (nunca acceso arbitrario).
- `outputType: 'notification'`: enviar notificación (p.ej. a un webhook de chat) con resumen.
- Cada adaptador debe respetar path isolation y redacción de secretos.

## 4. Aceptación
- Un workflow con `parallel` ejecuta ramas en paralelo y une resultados.
- Un `loop` itera sobre una lista de contexto.
- Un `wait` pausa por `durationMs`.
- Plantillas con ternarios se interpolar correctamente.
- Output a webhook externo y Firebase funcionan end-to-end.
- `npm run build` sin errores; flujos previos siguen funcionando.
