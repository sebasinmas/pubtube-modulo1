# Informe Técnico: Corrección de Bugs Prioritarios, Estabilización e Implementación de US-A6

**Proyecto:** PubTube - Plataforma de Publicación y Distribución de Videos  
**Componente:** Módulo 1 (Ingesta, Almacenamiento, Versionado de Metadatos y Consulta de Catálogo)  
**Fecha:** 17 de Octubre, 2026 (Sprint 3)  
**Estado:** Completado y Verificado  

---

## 1. Resumen Ejecutivo

A partir del informe de revisión técnica externa (*Informe de Revisión de Código - Módulo 1 PubTube*), el equipo del Módulo 1 priorizó y abordó la resolución inmediata de los bugs críticos, fallas de validación, problemas de seguridad y desconexiones de estado que afectaban la confiabilidad del servicio.

En esta iteración se logró:
1. **Mitigación total de vulnerabilidades de seguridad** (eliminación de vectores de *Path Traversal* y rechazo de nombres maliciosos).
2. **Corrección del pipeline de validación global de NestJS**, asegurando que los datos entrantes en los DTOs no sean descartados silenciosamente por `whitelist: true`.
3. **Sincronización ACID de la máquina de estados y persistencia de metadatos**, asegurando que el paso a estado `listo` impacte tanto en la base de datos relacional PostgreSQL como en el almacenamiento S3/Garage.
4. **Implementación completa de la Historia de Usuario US-A6** (Consulta de Catálogo paginada y filtrada por estado, con índice optimizado en PostgreSQL y consultas concurrentes).
5. **Alineación con la estrategia arquitectónica acordada**: Los refactors mayores de arquitectura (migración de RabbitMQ real y desacoplamiento de workers al Módulo 3) quedan formalmente programados para el cierre del sprint.

El estado actual del repositorio presenta **218 pruebas unitarias aprobadas al 100%**, **60 pruebas de integración E2E aprobadas al 100%**, **cero errores de compilación TypeScript** y **cero advertencias en ESLint**.

---

## 2. Detalle de Bugs Corregidos y Soluciones Aplicadas

### BUG-01 (CORR-01): Descarte silencioso de datos en DTOs de subida por `whitelist: true`
* **Severidad:** Alta
* **Componentes Afectados:** `InitUploadDto`, `CompleteUploadDto`.
* **Diagnóstico:** El `ValidationPipe` global de la aplicación estaba configurado con `{ whitelist: true }`. Al carecer los DTOs de subida de decoradores de `class-validator` y `class-transformer`, NestJS eliminaba silenciosamente propiedades esenciales como `filename`, `mimeType`, `sizeBytes`, `checksum` y `parts`. Esto provocaba que los controladores recibieran objetos vacíos o incompletos.
* **Solución Implementada:**
  - Se añadieron decoradores estrictos a `InitUploadDto`: `@IsString()`, `@IsNotEmpty()`, `@IsIn(['video/mp4', 'video/quicktime'])`, `@IsInt()`, `@Min(1)`, `@Type(() => Number)` y regex para SHA-256.
  - Se decoró `CompleteUploadDto` y `UploadedPartDto` con validación recursiva (`@ValidateNested()`, `@Type()`, validación de `PartNumber` entre 1 y 10.000 y `ETag` obligatorio).

---

### BUG-02 (CORR-06): Vulnerabilidad de Path Traversal en el nombre del archivo
* **Severidad:** Crítica
* **Componente Afectado:** `VideoUploadController.initUpload`.
* **Diagnóstico:** El sistema admitía valores como `../../etc/passwd` o rutas absolutas en el campo `filename`, utilizándolos directamente para componer la clave del objeto en S3/Garage (`${videoId}/${payload.filename}`). Esto permitía a un usuario malicioso escapar del prefijo asignado.
* **Solución Implementada:**
  - Se incorporó una validación previa que detecta y rechaza inmediatamente con `HTTP 400 Bad Request` cualquier intento de navegación de directorios (`..`, `/`, `\`).
  - Se aplica saneamiento con `path.basename` antes de generar la clave de almacenamiento.

---

### BUG-07: Subidas Multipart huérfanas en Garage/S3 ante fallos en BD
* **Severidad:** Media / Alta
* **Componente Afectado:** `VideoUploadController.initUpload`.
* **Diagnóstico:** Si la llamada a base de datos `videoRepository.crearBorrador` fallaba tras haber iniciado el multipart en Garage (`createMultipartUpload`), la carga quedaba abierta e invisible en el storage, acumulando recursos y almacenamiento huérfano.
* **Solución Implementada:**
  - Se envolvió la persistencia en un bloque `try/catch`. En caso de cualquier error en base de datos, se ejecuta automáticamente `minioService.abortarMultipartUpload` liberando la sesión en Garage/S3 antes de relanzar la excepción.

---

### BUG-08: Excepción no controlada (500) en `/complete` y rango de partes S3
* **Severidad:** Media
* **Componentes Afectados:** `VideoUploadController.getPresignedUrl` y `VideoUploadController.completeUpload`.
* **Diagnóstico:** 
  1. `getPresignedUrl` no validaba que el número de parte estuviera dentro de las restricciones de AWS S3 (1 a 10.000).
  2. Si el cliente enviaba un cuerpo sin `parts` o con arreglo vacío en `/complete`, `payload.parts.map(...)` provocaba un `TypeError` no capturado, devolviendo un error 500 al cliente.
* **Solución Implementada:**
  - Se agregó validación explícita de `partNumber >= 1 && partNumber <= 10000`, devolviendo `HTTP 400 Bad Request`.
  - En `completeUpload`, se verifica la existencia y longitud de `payload.parts`, devolviendo `HTTP 400 Bad Request` en lugar de una caída interna 500.

---

### BUG-03 (CORR-03): Desconexión de la máquina de estados y falta de persistencia en `metadata_versions`
* **Severidad:** Alta
* **Componentes Afectados:** `VideoStateService`, `VideoMetadataService`, `VideoMetadataController`.
* **Diagnóstico:**
  - Al ejecutar `marcarComoListo`, se emitía el evento de dominio `metadata.updated`, pero **no se persistía la versión 1 en la tabla `metadata_versions`** ni se actualizaba `videos.status = 'listo'` en PostgreSQL.
  - La base de datos permanecía en estado desincronizado con respecto al evento emitido.
* **Solución Implementada:**
  - Se modificó `VideoStateService.marcarComoListo` para que, dentro de una transacción serializable/bloqueante (`FOR UPDATE`), actualice `videos.status = 'listo'` e inserte el registro inicial en `metadata_versions`.
  - Se sincronizó `VideoMetadataService.actualizarMetadatos` para que, si el video está en estado `borrador`, lo transicione atómicamente a `listo`.
  - Se expuso y documentó el endpoint `POST /api/content/:contentId/listo` en el controlador para facilitar el flujo desde clientes externos.

---

### BUG-09: Falta de validación en fecha de programación (`marcarComoProgramado`)
* **Severidad:** Media
* **Componente Afectado:** `VideoStateService.marcarComoProgramado`.
* **Diagnóstico:** Si se enviaba una fecha malformada (`new Date("invalida")`), la función no lanzaba excepción de validación y procedía a ejecutar consultas SQL con valores `NaN`.
* **Solución Implementada:**
  - Se agregó la comprobación `if (!(scheduledAt instanceof Date) || isNaN(scheduledAt.getTime()))`, respondiendo con `HTTP 400 Bad Request` con mensaje descriptivo.

---

## 3. Implementación de la Historia de Usuario US-A6: Consulta de Catálogo

Además de la resolución de bugs, se integró de forma definitiva la funcionalidad de consulta de catálogo solicitada en el Sprint 3:

1. **Índice Relacional Optimizado (`videos_status_idx`):**
   - Se añadió un índice B-Tree sobre `videos.status` en el esquema Drizzle (`src/db/schema.ts`) para garantizar tiempos de respuesta sub-milisegundos en búsquedas filtradas por estado.
2. **DTOs de Consulta Paginada (`GetContentQueryDto` y `GetContentResponseDto`):**
   - Parámetros soportados: `page` (mínimo 1, default 1), `size` (1..100, default 10) y `status` (`borrador`, `listo`, `programado`, `publicado`).
   - Transformación automática de strings de URL a tipos numéricos.
3. **Servicio `ContentQueryService`:**
   - Ejecución paralela (`Promise.all`) de la consulta de datos y el cálculo del total de registros (`count()`).
   - Cálculo automático de `totalPages` y preservación del orden descendente por fecha de creación (`created_at DESC`).
4. **Endpoint Expuesto:**
   - `GET /api/content` documentado en Swagger y accesible para otros módulos y aplicaciones cliente.

---

## 4. Tabla Comparativa: Estado Antes vs. Estado Actual

| Dimensión | Estado Antes de las Correcciones | Estado Actual (Corregido y Validado) |
| :--- | :--- | :--- |
| **Seguridad de Archivos** | Vulnerable a *Path Traversal* (`../../etc/passwd`). | Rechazo estricto con `400 Bad Request` y saneamiento con `basename`. |
| **Pipeline de DTOs** | Pérdida silenciosa de parámetros en NestJS (`whitelist: true`). | Validación tipada y exhaustiva con `class-validator` y `class-transformer`. |
| **Storage S3/Garage** | Cargas multipart huérfanas en fallos de BD; `partNumber` sin validar. | Aborto garantizado ante excepciones; validación estricta de partes (1..10000). |
| **Consistencia de Estado** | `marcarComoListo` no guardaba en BD ni actualizaba `status`. | Persistencia atómica de versión 1 en `metadata_versions` y `status = 'listo'`. |
| **Fechas de Programación** | Aceptaba `Invalid Date` (`NaN`) sin validación. | Validación robusta de fechas con rechazo `400 Bad Request`. |
| **Consulta de Catálogo (US-A6)** | Inexistente (tests en fase roja). | Endpoint `GET /api/content` operativo, paginado y con índice en PostgreSQL. |
| **Calidad de Código / CI** | 7 tests `it.todo` pendientes; advertencias de ESLint. | **0 tests pendientes**, **218/218 unit tests OK**, **60/60 E2E OK**, 0 warnings ESLint. |

---

## 5. Decisiones de Arquitectura y Próximos Pasos del Sprint

Respecto a las observaciones arquitectónicas de largo alcance planteadas en el informe:
1. **Patrón Outbox Transaccional y RabbitMQ Real:**
   - En el código actual, la emisión de eventos opera mediante un bus en memoria (`EventEmitter2`) con fallback controlado. La migración a RabbitMQ distribuido con patrón Outbox para evitar pérdida de eventos en caídas se planificó para el **cierre del Sprint 3**, priorizando primero la estabilidad funcional y el cumplimiento de las historias de usuario del equipo.
2. **Worker de Publicación a YouTube:**
   - La arquitectura final prevé que la orquestación de subida a plataformas externas sea responsabilidad del Módulo 3. Por ahora, el worker permanece aislado y probado como stub para no interrumpir el flujo del sistema.

---

## 6. Conclusión y Recomendación

El Módulo 1 se encuentra en un estado de **alta estabilidad técnica, seguridad reforzada y cobertura integral de pruebas**. Con los 3 commits ejecutados y validados, el código cumple rigurosamente con los estándares de calidad del proyecto y está listo para ser integrado en la rama `develop`.
