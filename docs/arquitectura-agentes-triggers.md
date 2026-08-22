# Arquitectura de agentes y triggers para OpenCode

**Estado:** arquitectura aprobada — diseño, sin implementación  
**Alcance inicial:** ejecución local en Windows, con portabilidad futura a VPS, otro servidor local o Google Cloud Run.

## 1. Objetivo

Construir una plataforma local que permita registrar proyectos, conexiones y workflows de agentes. Un webhook o una tarea cron inicia un workflow que trabaja exclusivamente sobre el repositorio/carpeta configurado, produce resultados y deja trazabilidad.

El sistema debe permitir que un agente diagnostique un error, modifique código, cree una rama, haga commit y abra un Pull Request en GitHub, pero **nunca haga merge automáticamente**.

## 2. Decisiones principales

- **Proyecto:** un repositorio y una carpeta local.
- **Ejecución inicial:** local, mediante un servicio orquestador y un runner de OpenCode.
- **Triggers iniciales:** webhook entrante y cron.
- **Webhook MVP:** autenticación Bearer por conexión. Antes de exponer el sistema fuera de localhost debe migrarse a HMAC con timestamp y protección contra replay.
- **Cron:** expresión cron estándar de cinco campos y zona horaria local.
- **Workflow:** composición de varios agentes especializados, no un agente monolítico.
- **Modelo:** modelo fijo por agente, configurable por workflow.
- **Concurrencia:** una ejecución activa por proyecto; las siguientes quedan en cola.
- **Autonomía:** branch, commit, tests y PR automáticos; merge siempre manual.
- **Acciones sensibles:** comandos destructivos requieren aprobación explícita.
- **Historial:** persistencia local y reintento manual.
- **Configuración de OpenCode V1:** terminal local interactiva por proyecto; la configuración se conserva, pero no se persiste ni reutiliza la sesión conversacional.
- **Frontend:** panel local con constructor visual de workflows.
- **Salidas:** GitHub, archivos locales, Firebase y webhooks/notificaciones mediante adaptadores.

## 3. Arquitectura lógica

```text
                    ┌─────────────────────────┐
                    │ Frontend localhost       │
                    │ proyectos · conexiones   │
                    │ workflows · ejecuciones  │
                    └────────────┬────────────┘
                                 │ API
┌──────────────┐       ┌─────────▼─────────┐       ┌──────────────────┐
│ Webhooks     ├──────►│ Orquestador       │◄──────┤ Scheduler / cron │
│ externos     │       │                  │       │                  │
└──────────────┘       │ auth · routing    │       └──────────────────┘
                       │ cola por proyecto │
                       │ workflow runner   │
                       └───────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │ Runner OpenCode     │
                    │ sesiones · agentes  │
                    │ permisos · eventos  │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼─────────────────────┐
          ▼                    ▼                     ▼
   Repositorio local     GitHub adapter       Output adapters
   branch/worktree       branch/commit/PR     archivo · Firebase
                                                webhook/notificación

          ┌─────────────────────────────────────────┐
          │ Store local: proyectos, workflows,       │
          │ triggers, ejecuciones, logs y secretos   │
          └─────────────────────────────────────────┘
```

### 3.1 Orquestador

Es la autoridad del sistema. No debe contener lógica específica de un cliente ni de un proveedor de webhook. Sus responsabilidades son:

1. recibir y autenticar eventos;
2. resolver la conexión y el proyecto;
3. seleccionar el workflow;
4. crear una ejecución idempotente;
5. encolar por proyecto;
6. invocar OpenCode con el agente y modelo configurados;
7. guardar eventos, resultados y errores;
8. ejecutar adaptadores de salida;
9. exponer estado al frontend.

### 3.2 Registro de proyectos

Cada proyecto contiene:

- identificador y nombre visible;
- ruta absoluta de la carpeta local;
- URL y proveedor del repositorio remoto;
- rama base;
- adaptador de GitHub asociado;
- workflows habilitados;
- política de concurrencia;
- política de permisos y comandos permitidos;
- destinos de salida autorizados.

El runner debe rechazar cualquier path que no sea la carpeta del proyecto o una ruta explícitamente permitida. No debe aceptar la carpeta desde el payload del webhook.

### 3.3 Conexiones

Una conexión vincula un origen externo con un proyecto y un workflow. Ejemplos:

- `platform-a-errors` → proyecto `cliente-a` → workflow `diagnose-and-pr`;
- `client-site-review` → proyecto `cliente-a` → workflow `site-review`;
- `weekly-health` → proyecto `cliente-b` → workflow `health-check`.

La conexión debe tener un secreto Bearer almacenado fuera del frontend y nunca devolverlo en respuestas API. La identificación de conexión debe ser un ID o ruta pública opaca; no debe depender de nombres sensibles.

## 4. Modelo de workflows

Un workflow se representa como un grafo dirigido de pasos. El constructor visual edita este grafo, pero el motor ejecuta una versión validada e inmutable de la definición.

### Tipos de nodo

- **Trigger:** webhook o cron.
- **Normalizador:** convierte payloads externos a un evento interno común.
- **Agente:** ejecuta una tarea de OpenCode con un rol y modelo fijo.
- **Condición:** decide según resultado, severidad o campos del evento.
- **Shell/test:** ejecuta comandos preautorizados.
- **Git:** crea branch y commit mediante una política controlada.
- **Pull Request:** publica PR en GitHub.
- **Transformador:** genera JSON, Markdown u otro formato.
- **Salida:** archivo local, Firebase, webhook o notificación.
- **Aprobación:** pausa el workflow para intervención humana.

### Contrato de contexto

Cada nodo recibe un contexto estructurado, no solo texto libre:

```text
execution_id
project_id
workflow_id
trigger_type
trigger_payload
repository_path
base_branch
current_branch
artifacts
previous_results
policy
```

Los agentes deben recibir solo los campos necesarios. Los secretos, tokens y credenciales nunca deben incluirse en el prompt ni en los logs.

### Versionado

Cada ejecución debe apuntar a una versión concreta del workflow. Editar un workflow no debe alterar ejecuciones históricas ni ejecuciones ya en cola.

## 5. Flujo de ejecución

1. Llega un webhook o vence un cron.
2. El receptor valida Bearer, tamaño, método y esquema mínimo.
3. El normalizador crea un evento interno.
4. El router resuelve proyecto, conexión y workflow.
5. Se calcula una clave de idempotencia. Un mismo evento no debe crear dos PRs por reintentos del proveedor.
6. La ejecución se coloca en la cola del proyecto.
7. El worker adquiere el lock del proyecto y ejecuta un `opencode run` nuevo con la configuración del proyecto; no reutiliza la sesión conversacional de la terminal de configuración.
8. Los agentes ejecutan diagnóstico, cambios y pruebas según el grafo.
9. Si se requieren comandos destructivos, la ejecución queda `waiting_approval`.
10. El nodo Git crea una rama con nombre generado por política.
11. Se crea el commit y el PR, sin merge.
12. Los adaptadores publican resultados adicionales, por ejemplo un archivo JSON en Firebase.
13. La ejecución queda `succeeded`, `failed`, `cancelled` o `waiting_approval`.
14. El frontend muestra estado, logs, diff, PR y artefactos.

## 6. Workflows de referencia

### 6.1 Error de plataforma → diagnóstico → PR

```text
Webhook de error
  → validar y normalizar
  → agente triage: clasificar severidad y componente
  → agente diagnóstico: localizar causa y proponer solución
  → condición: ¿hay evidencia suficiente?
      no → informe + notificación
      sí → agente implementación
          → tests preautorizados
          → agente revisión
          → branch + commit
          → Pull Request GitHub
          → notificación con resumen y enlaces
```

El workflow no debe hacer merge. Si las pruebas fallan, puede actualizar el informe o dejar la ejecución fallida; no debe abrir PR automáticamente salvo que la política lo permita.

### 6.2 Cron de revisión de salud

```text
Cron semanal, zona local
  → checkout/estado controlado
  → agente health-check
  → ejecutar tests y comprobaciones permitidas
  → generar informe Markdown/JSON
  → guardar archivo local
  → notificar resumen
```

Por defecto este workflow no modifica código.

### 6.3 Cron de crítica de sitio → Firebase

```text
Cron por cliente
  → visitar el sitio mediante una capacidad explícita y limitada
  → agente UX/contenido/técnico
  → agente editor: convertir hallazgos a esquema estructurado
  → validar JSON contra contrato
  → adaptar y escribir en Firebase
  → notificar resultado y guardar copia local
```

La salida a Firebase debe usar un documento versionado, con `project_id`, `client_id`, `execution_id`, fecha, severidad, hallazgos y estado. El agente no debe poder escribir arbitrariamente en toda la base: el adaptador debe imponer colección, campos y permisos.

## 7. OpenCode dentro del sistema

OpenCode se trata como un runtime de agentes, no como el receptor de webhooks. El orquestador puede:

- abrir en V1 una terminal local interactiva asociada al `localPath` validado para que el operador configure el entorno del proyecto;
- iniciar `opencode serve` local con autenticación;
- crear sesiones y enviar prompts mediante la API/SDK;
- escuchar eventos SSE;
- ejecutar `opencode run` para tareas no interactivas;
- seleccionar un agente y su modelo fijo;
- imponer permisos y usar `--auto` solo en workers con políticas explícitas.

La terminal interactiva de V1 es una herramienta de configuración, no una sesión compartida con los workflows. Cada ejecución automática crea una sesión nueva de OpenCode. Se persisten los datos del orquestador —ejecuciones, logs, resultados y artefactos—, pero no se persiste `sessionId` para reanudar conversaciones. El diseño completo está en `docs/superpowers/specs/2026-08-22-opencode-configured-terminal-v1-design.md`.

OpenCode no aporta por sí mismo un webhook entrante genérico ni un scheduler de workflows. Esas responsabilidades pertenecen al orquestador y sus adaptadores.

## 8. Frontend

El frontend localhost tendrá estas áreas:

1. **Proyectos:** ruta local, repositorio, rama base, estado y cola.
2. **Conexiones:** origen, proyecto, workflow, estado y rotación del secreto.
3. **Workflows:** lista, versión, editor visual y validación.
4. **Agentes:** rol, prompt, modelo, permisos y límites.
5. **Consola OpenCode:** terminal local por proyecto para configuración interactiva de proveedores, modelos, agentes, skills y MCP.
6. **Schedules:** expresión cron, zona horaria, próxima ejecución y pausa.
7. **Ejecuciones:** estado, timeline, logs, eventos, diff, artefactos y PR.
8. **Aprobaciones:** comandos sensibles pendientes y acción solicitada.
9. **Salidas:** configuración de GitHub, Firebase, archivos y notificaciones.

El frontend no debe ejecutar comandos directamente. Solo solicita cambios al orquestador, que valida políticas y los delega al worker.

## 9. Estados y errores

Estados mínimos de ejecución:

```text
queued
running
waiting_approval
succeeded
failed
cancelled
```

Cada transición debe guardar timestamp, causa y actor (`system`, `agent`, `user`). Los errores deben clasificarse como:

- autenticación del trigger;
- payload inválido;
- proyecto no disponible;
- conflicto de cola/lock;
- fallo de OpenCode/modelo;
- permiso rechazado;
- test fallido;
- GitHub/API externo;
- salida externa;
- error inesperado.

El MVP permite reintento manual. El reintento debe crear una nueva ejecución relacionada con la anterior, no reabrirla silenciosamente.

## 10. Seguridad

### Obligatorio para la versión local

- Escuchar solo en `127.0.0.1` salvo necesidad explícita.
- Proteger el servidor OpenCode con `OPENCODE_SERVER_PASSWORD`.
- No usar `--auto` sin políticas de deny explícitas.
- No permitir `edit` o `bash` fuera del proyecto.
- Mantener merge fuera de las capacidades del worker.
- Guardar secretos en almacenamiento protegido del sistema, no en prompts ni repositorios.
- Redactar tokens, cookies y payloads sensibles en logs.
- Validar tamaño y esquema de webhooks.
- Usar idempotencia y expiración de eventos.

### Antes de migrar fuera de localhost

- reemplazar Bearer por HMAC con timestamp y nonce;
- autenticación del frontend;
- autorización por proyecto y rol;
- HTTPS y firewall/reverse proxy;
- rotación de secretos;
- aislamiento de workers;
- límites de red y egress;
- auditoría de comandos y artefactos;
- almacenamiento externo de estado.

## 11. Portabilidad futura

Las siguientes fronteras deben ser interfaces, aunque inicialmente tengan implementación local:

- `TriggerAdapter`: webhook y cron;
- `ProjectRegistry`: carpetas locales y futuros volúmenes/remotos;
- `OpenCodeRunner`: servidor local, VPS o worker remoto;
- `Queue`: cola en memoria/local y futura cola distribuida;
- `StateStore`: SQLite/archivos locales y futura base de datos;
- `GitProvider`: GitHub y futuros GitLab/Bitbucket;
- `OutputAdapter`: archivo, Firebase, webhook y otros destinos;
- `SecretStore`: almacenamiento local protegido y futuro Secret Manager.

En Cloud Run, el frontend/orquestador puede ser stateless, pero el scheduler, la cola, el almacenamiento de ejecuciones y el acceso al repositorio deben resolverse explícitamente. Un contenedor efímero no debe ser la única fuente de verdad.

## 12. Fuera de alcance inicial

- Merge automático.
- Multiusuario y roles completos.
- GitLab/Bitbucket.
- Worktrees paralelos.
- Reintentos automáticos.
- Constructor visual colaborativo.
- Exposición pública sin autenticación fuerte.
- Scheduler distribuido.
- Agente con capacidad irrestricta sobre el sistema operativo.

## 13. Criterios de aceptación arquitectónicos

La arquitectura se considera lista para implementación cuando pueda demostrarse que:

1. un webhook solo puede activar el workflow y proyecto configurados;
2. dos eventos del mismo proyecto se serializan;
3. un workflow produce una ejecución trazable de principio a fin;
4. un agente puede crear branch, commit y PR, pero no merge;
5. un comando destructivo pausa la ejecución para aprobación;
6. el cron respeta la zona horaria local;
7. el resultado puede escribirse por un adaptador en archivo o Firebase;
8. el frontend permite inspeccionar y reintentar una ejecución;
9. los secretos no aparecen en prompts, respuestas ni logs;
10. las interfaces permiten sustituir componentes locales por servicios remotos más adelante.
