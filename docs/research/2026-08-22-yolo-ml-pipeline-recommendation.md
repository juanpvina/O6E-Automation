# Integracion local/offline de YOLO/ML

Fecha: 2026-08-22

## Recomendacion

Adoptar un **worker local persistente por HTTP sobre loopback**, implementado inicialmente en Python con **ONNX Runtime** y un modelo YOLO exportado a `.onnx`.

- El backend TypeScript solo orquesta: valida la configuracion, encola el paso, envia una solicitud al worker y persiste el resultado.
- El worker mantiene el modelo cargado en memoria, evita el coste de iniciar Python y permite CPU/GPU mediante Execution Providers.
- La API debe escuchar solo en `127.0.0.1`, usar un token generado/gestionado por el orquestador y aceptar un contrato JSON pequeno y versionado.
- El primer nodo debe ser `ml_inference` o `yolo_inference`, no `shell_test`, `code` ni un agente con capacidad de ejecutar comandos arbitrarios.
- Python subprocess es un fallback operativo para instalaciones sin worker persistente o para el primer prototipo, pero no debe ser la ruta de produccion por defecto.
- Docker debe ser una opcion de aislamiento para despliegues controlados, no un prerequisito del uso local en Windows.

## Encaje con el repositorio

El workflow ya es un grafo de pasos y el ejecutor despacha por tipo en `packages/backend/src/services/executor.ts:645-729`. Cada paso mide duracion, emite eventos y persiste `stepOutputs` en `executor.ts:539-637`, por lo que un nodo ML encaja naturalmente en ese mecanismo.

La separacion de dependencias ya existe: `WorkflowExecutor` recibe `IStateStore`, `IOpenCodeRunner`, `IGitProvider` e `ISecretStore` (`executor.ts:28-51`). Debe agregarse una interfaz de capacidad ML equivalente, en lugar de ampliar el runner de OpenCode. El contrato actual de `WorkflowStep.config` es extensible (`packages/shared/src/types.ts:111-116`), pero un nuevo tipo debe actualizar shared, backend, frontend y el editor.

El proyecto exige mantener path isolation, no exponer secretos, serializar ejecuciones por proyecto y no hacer merge automatico (`docs/roadmap.md:153-168`). El contrato de contexto ya incluye `repository_path`, `artifacts` y `previous_results` (`docs/arquitectura-agentes-triggers.md:120-138`), adecuados para que el nodo reciba una imagen/video o un artefacto ya creado.

## Comparacion

| Opcion | Ventajas | Costes/riesgos | Veredicto |
|---|---|---|---|
| Python subprocess | Menor cambio inicial; aprovecha `ultralytics` y su pre/postprocesado; facil de depurar | Recarga modelo por ejecucion; latencia y RAM; gestion compleja de stdout, timeouts y arbol de procesos; convierte cada configuracion en un potencial comando | Prototipo/fallback, con ejecutable y args fijos, nunca shell libre |
| Servicio HTTP local Python | Modelo caliente; desacopla Python/GPU del backend; contrato estable; permite reemplazar Ultralytics por ORT; mejor observabilidad | Hay que gestionar lifecycle, health-check, auth local, versionado y backpressure; localhost no elimina riesgos | **Opcion recomendada** |
| ONNX Runtime embebido en Node | Sin Python ni servicio separado; API Node oficial; CPU y DirectML en Windows | Pre/postprocesado YOLO y NMS son responsabilidad del equipo; la matriz GPU depende de plataforma; el proceso del backend carga librerias nativas y modelo | Buena fase posterior si se estandariza un unico modelo y se acepta mantener el decoder |
| Contenedor | Reproducibilidad, dependencias fijadas y mejor aislamiento; limites CPU/RAM y red | Docker Desktop/WSL, montajes de rutas Windows y GPU complican la instalacion; el acceso NVIDIA requiere drivers y toolkit; mas operaciones | Perfil avanzado/produccion, opcional |

La documentacion oficial de ONNX Runtime describe Execution Providers intercambiables y prioridad, por ejemplo CUDA seguido de CPU; tambien lista DirectML para Windows y OpenVINO/XNNPACK para otros escenarios ([ORT Execution Providers](https://onnxruntime.ai/docs/execution-providers/)). El binding Node precompilado soporta CPU en Windows x64 y DirectML, pero no CUDA en Windows ([ORT Node.js](https://onnxruntime.ai/docs/get-started/with-javascript/node.html)). Esto hace especialmente atractiva la ruta Python+ORT si se necesita NVIDIA en una maquina Windows, sin impedir un fallback CPU.

## Modelos y artefactos

El registro local debe tratar los modelos como artefactos versionados, no como nombres descargables en tiempo de ejecucion.

Manifest minimo:

```json
{
  "id": "site-defects-v1",
  "format": "onnx",
  "sha256": "...",
  "task": "detect",
  "classes": ["defect-a", "defect-b"],
  "input": {"width": 640, "height": 640, "layout": "NCHW", "color": "RGB", "dtype": "float32"},
  "output": {"schema": "boxes-v1", "nms": "embedded"},
  "license": "recorded-out-of-band"
}
```

Requisitos y decisiones:

- Preferir `.onnx` exportado y verificado a partir del checkpoint aprobado. Ultralytics documenta export a ONNX, `imgsz`, `dynamic`, `opset`, NMS y cuantizacion FP16/INT8 ([Export](https://docs.ultralytics.com/modes/export/)).
- Fijar inicialmente `imgsz`, batch 1, tarea y esquema de salida. El input debe normalizarse exactamente como el entrenamiento/exportacion; si el grafo no incorpora NMS, el worker debe aplicar una version conocida.
- Registrar `class names`, threshold por defecto, IoU, `max_det`, version de runtime y dispositivo. No inferir clases desde el nombre del archivo.
- Validar el modelo offline: hash, formato, dimensiones, nombres de inputs/outputs, opset soportado y una imagen fixture con resultado esperado. No descargar pesos ni datasets durante una ejecucion.
- Para videos o lotes, usar streaming y limites de frames/tamano. La documentacion de predict recomienda `stream=True` para evitar acumular resultados en memoria ([Predict](https://docs.ultralytics.com/modes/predict/)).
- Revisar la licencia del checkpoint, dataset y runtime por separado. El repositorio Ultralytics mantiene el codigo bajo AGPL-3.0 en su licencia ([LICENSE](https://github.com/ultralytics/ultralytics/blob/main/LICENSE)); el uso de modelos y cualquier licencia comercial debe ser validado legalmente antes de distribuir una integracion cerrada. No asumir que exportar a ONNX elimina obligaciones.

## Contrato recomendado del worker

Endpoints loopback:

- `GET /health`: runtime, modelos cargados, providers disponibles, version del protocolo.
- `POST /v1/infer`: `modelId`, `sourceArtifactId` o ruta ya autorizada, `task`, `conf`, `iou`, `imgsz`, `device`, `saveVisualization`.
- `POST /v1/models/:id/load` solo para administracion local autenticada, nunca desde payloads de webhook.

Respuesta acotada:

```json
{
  "protocolVersion": 1,
  "modelId": "site-defects-v1",
  "task": "detect",
  "detections": [{"classId": 0, "label": "defect-a", "confidence": 0.91, "box": [12, 20, 80, 100]}],
  "artifacts": ["relative/path/to/annotated.jpg"],
  "metrics": {"preprocessMs": 4, "inferenceMs": 18, "postprocessMs": 2, "device": "CPUExecutionProvider"}
}
```

El backend debe mapear el resultado a `stepOutputs[stepId]`, emitir `StepEvent`, guardar timing y permitir que un `condition` posterior use una expresion sobre conteos/confianzas. Los bytes de imagen no deben viajar por logs ni por la API del frontend.

## Seguridad y aislamiento

- No aceptar `modelPath`, `sourcePath` ni `command` arbitrarios desde el webhook. Resolverlos por IDs registrados y comprobar que la ruta canonica esta dentro de `Project.localPath` o de un directorio de artefactos dedicado.
- No usar shell. La documentacion de Python recomienda secuencias de argumentos y advierte que `shell=True` hace responsabilidad de la aplicacion evitar shell injection ([subprocess Security Considerations](https://docs.python.org/3/library/subprocess.html#security-considerations)). El backend actual usa `shell:true` para OpenCode en Windows (`runner.ts:28-33`), pero eso no debe replicarse para ML.
- Desactivar URLs, webcams, RTSP y cualquier descarga por defecto. El worker debe aceptar solo archivos locales previamente creados o payloads binarios con limite estricto.
- Aplicar limites de bytes, dimensiones, frames, batch, tiempo, memoria y concurrencia. La cola por proyecto ya serializa workflows; el worker debe tener ademas una capacidad global para no saturar CPU/GPU.
- Redactar rutas sensibles y payloads en logs; persistir solo resultados estructurados, metricas y referencias de artefactos. Nunca incluir tokens en el request ni en el prompt del agente.
- Firmar/hash de modelos y mantener un catalogo administrado. No permitir que un workflow no confiable elija un modelo nuevo o cargue plugins/custom ops.
- Servicio: bind `127.0.0.1`, token aleatorio fuera de los workflows, CORS inexistente/no necesario y timeout del cliente. En contenedor: filesystem de solo lectura, usuario no root, sin red por defecto, volumen de modelos de solo lectura, capacidades Linux minimizadas y sin secretos.
- Ante timeout, cancelar la solicitud y terminar el proceso/worker si no responde. El proyecto ya reconoce el problema de procesos hijos no terminados en `docs/roadmap.md:31-34`.

Docker documenta que los contenedores no tienen limites por defecto y recomienda fijar memoria/CPU para evitar que un OOM afecte al host ([resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)). Para GPU NVIDIA se requiere soporte del host y NVIDIA Container Toolkit; por ello no debe ser requisito del perfil Windows local basico.

## Configuracion y UX

Configuracion global del orquestador:

- `ML_ENABLED=false` por defecto.
- `ML_WORKER_URL=http://127.0.0.1:<port>` y secreto local generado, nunca almacenado en un workflow.
- `ML_WORKER_MODE=service|subprocess|container`.
- `ML_MODELS_DIR` fuera del repositorio de codigo, con permisos de usuario.
- `ML_DEFAULT_DEVICE=auto`, `ML_MAX_CONCURRENCY=1`, timeouts y limites de input.
- `ML_ALLOW_NETWORK=false` y version/protocolo requeridos.

UX del editor:

- Nodo visible **YOLO / Inferencia ML**, con selector de modelo registrado y badge de tarea/licencia/device.
- Fuente seleccionable desde `triggerPayload`, artefacto previo o archivo relativo validado; nunca un path absoluto editable sin validacion.
- Campos `confidence`, `IoU`, `imgsz`, `maxDet`, `device`, `guardar visualizacion` y limite de frames, con defaults explicados.
- Preflight antes de activar/ejecutar: worker disponible, modelo/hash valido, provider instalado, fixture valida y rutas permitidas.
- En ejecucion: estado `loading model`, `running inference`, conteo de detecciones, latencias, provider usado y enlace a imagen anotada. Mostrar errores accionables: modelo ausente, provider no disponible, input excede limite, timeout.
- No mostrar imagenes sensibles por defecto en logs o respuestas generales; la vista de ejecucion puede requerir una accion explicita para abrir el artefacto.

El catalogo actual del frontend (`packages/frontend/src/components/StepCatalogModal.tsx:89-132`) ya separa IA de codigo/datos; el nodo ML deberia aparecer como capacidad determinista de vision, distinto de `Agente OpenCode` y de `Script de Código`.

## Plan por etapas, sin cambiar aun el contrato publico

1. Prototipo: worker Python local con ORT CPU, un modelo ONNX aprobado, una imagen fixture, contrato JSON y prueba manual end-to-end.
2. Integracion: interfaz `IMLRunner` inyectable, nodo dedicado, persistencia de salida/metricas y preflight. Mantener subprocess como adapter alternativo.
3. Rendimiento: worker persistente, cache de sesiones, provider `DirectML`/CUDA segun host, limites y health-check.
4. Aislamiento opcional: imagen Docker reproducible con modelo montado read-only y perfil sin red; documentar que GPU requiere host preparado.
5. Extension: segmentacion/pose/video solo despues de estabilizar `boxes-v1`; cada tarea debe tener un esquema de salida distinto y fixtures propias.

## Fuentes primarias consultadas

- Repositorio: `docs/roadmap.md`, `docs/arquitectura-agentes-triggers.md`, `packages/shared/src/types.ts`, `packages/backend/src/services/executor.ts`, `packages/backend/src/services/runner.ts`, `packages/frontend/src/components/StepCatalogModal.tsx`.
- Ultralytics, [Predict mode](https://docs.ultralytics.com/modes/predict/), consultado 2026-08-22.
- Ultralytics, [Export mode](https://docs.ultralytics.com/modes/export/), consultado 2026-08-22.
- Ultralytics, [AGPL-3.0 LICENSE](https://github.com/ultralytics/ultralytics/blob/main/LICENSE), consultado 2026-08-22.
- Microsoft ONNX Runtime, [Execution Providers](https://onnxruntime.ai/docs/execution-providers/), [Python](https://onnxruntime.ai/docs/get-started/with-python.html) y [Node.js binding](https://onnxruntime.ai/docs/get-started/with-javascript/node.html), consultados 2026-08-22.
- Python Software Foundation, [subprocess Security Considerations](https://docs.python.org/3/library/subprocess.html#security-considerations), consultado 2026-08-22.
- Docker, [Resource constraints](https://docs.docker.com/engine/containers/resource_constraints/), consultado 2026-08-22.
