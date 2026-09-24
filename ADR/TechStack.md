# ADR 01: Tech Stack para PubTube

> **Nota:** Se utilizó Inteligencia Artificial (IA) como apoyo en la redacción de este documento. Todas las decisiones arquitectónicas y técnicas aquí reflejadas fueron debidamente sopesadas por el equipo y discutidas previamente en clases.

## Contexto

PubTube es una plataforma de gestión y publicación de video que requiere alta disponibilidad, tolerancia a fallos en cargas de gran tamaño, consistencia en la gestión de metadatos y comunicación asíncrona entre servicios.



## Tabla de Decisiones Tecnológicas y Trade-offs

| Componente / Capa | Tecnología Elegida | Justificación y Trade-offs |
| :--- | :--- | :--- |
| **Backend / API** | Node.js + NestJS | Proporciona alta escalabilidad basada en I/O asíncrono y tipado estricto con TypeScript. La arquitectura modular de NestJS (controladores, servicios, inyección de dependencias) obliga a estructurar el código de forma ordenada, desacoplada y mantenible. **Trade-off:** Mayor curva de aprendizaje y *boilerplate* inicial comparado con FastAPI + Python, pero previene deuda técnica y facilita la escalabilidad en equipo. |
| **Mensajería Pub/Sub** | RabbitMQ | Broker de mensajería robusto y probado para la distribución asíncrona de eventos (notificaciones de procesamiento, transiciones de estado) con colas dedicadas y garantías de entrega (ACKs). **Trade-off:** Mayor sobrecarga operativa y de configuración frente a opciones ligeras (como Redis Streams) o servicios administrados en la nube, pero asegura alta fiabilidad y tolerancia a fallos. |
| **Base de Datos** | PostgreSQL | Motor relacional estándar con soporte ACID completo, ideal para asegurar transacciones atómicas, consistencia en metadatos, historial y la máquina de estados del contenido. **Trade-off:** Menor flexibilidad de esquema frente a bases NoSQL (e.g. MongoDB) y necesidad de gestionar migraciones estructuradas, pero garantiza integridad referencial estricta y consultas complejas eficientes. Además de que como equipo tenemos más experiencia en esta tecnología. |
| **Object Storage** | MinIO | Almacenamiento de objetos *open-source* 100% compatible con la API de Amazon S3. Se elige por sobre soluciones propietarias o BaaS (como Supabase o AWS S3 directo) por no depender de servicios externos (*vendor lock-in*), fiabilidad y permitir un entorno local autocontenido sin costos por transferencia. **Trade-off:** Requiere administrar el aprovisionamiento, almacenamiento físico y respaldos de forma manual. |
| **CI/CD** | GitHub Actions | Automatización nativa en el repositorio para pipelines de integración y despliegue continuo (pruebas, linters, builds automáticos). **Trade-off:** Límites de minutos en cuentas gratuitas/privadas y acoplamiento al ecosistema de GitHub, pero minimiza la sobrecarga de mantener servidores de integración dedicados (como Jenkins). |
| **Contenedores** | Docker Compose | Permite orquestar y desplegar rápidamente todo el stack local (API, Base de Datos, MinIO, RabbitMQ) en entornos consistentes y reproducibles entre los desarrolladores. **Trade-off:** No está pensado para la orquestación avanzada en producción a gran escala (a diferencia de Kubernetes), pero ofrece simplicidad, rapidez y cero fricción para desarrollo y pruebas locales. |
| **Gestión Proyecto** | Trello | Tablero Kanban ágil, visual y flexible para la gestión de historias de usuario, asignación de tareas y seguimiento de sprints según los roles definidos. **Trade-off:** Menor profundidad en métricas avanzadas y trazabilidad técnica frente a Jira, pero brinda rapidez, facilidad de adopción y baja sobrecarga administrativa. |
| **Documentación API** | OpenAPI / Swagger | Estándar de la industria integrado nativamente con NestJS (`@nestjs/swagger`) para generar documentación interactiva y contratos de API sincronizados con el código en tiempo real. **Trade-off:** Requiere mantener anotaciones y decoradores actualizados en los DTOs y controladores, pero previene discrepancias entre la especificación y la implementación real. |


### Casos de Uso y Decisiones de Contexto

- En el contexto de **US-A1: Carga resumible de video**, enfrentando **la necesidad de reanudar cargas interrumpidas por caídas de red o timeouts**, decidimos por **Node.js + NestJS** para el backend y **MinIO (S3)** como object storage, utilizando la **carga con chunking nativa de MinIO (S3 Multipart Upload)** para lograr **resumibilidad y tolerancia a fallos** sin añadir la sobrecarga de protocolos externos adicionales.

- En el contexto de **US-A2: Edición de metadatos**, enfrentando **la necesidad de editar metadatos de videos**, decidimos por **Node.js + NestJS** para el backend y **PostgreSQL** como base de datos, aceptando que la modificación de los metadatos debe ser atómica y consistente.

- En el contexto de **US-A2.5: Historial**, enfrentando **la necesidad de mantener un historial de metadatos**, decidimos por **Node.js + NestJS** para el backend y **PostgreSQL** como base de datos, aceptando que la complejidad adicional de mantener un historial de metadatos es manejable.

- En el contexto de **US-A3: Miniatura del contenido**, enfrentando **la necesidad de poder seleccionar la miniatura para un video subido**, decidimos por **Node.js + NestJS** para el backend y **PostgreSQL** como base de datos, aceptando que la complejidad adicional de seleccionar la miniatura para un video es manejable.

- En el contexto de **US-A4: Máquina de estados del contenido**, enfrentando **la necesidad de controlar las transiciones borrador → listo → programado → publicado**, decidimos por **Node.js + NestJS** para el backend y **PostgreSQL** como base de datos, aceptando que la complejidad adicional de controlar las transiciones del ciclo editorial es manejable.

- En el contexto de **US-A5: Idempotencia de carga**, enfrentando **la necesidad de rechazar cargas duplicadas usando el checksum**, decidimos por **Node.js + NestJS** para el backend y **PostgreSQL** como base de datos, aceptando que la complejidad adicional de rechazar cargas duplicadas es manejable.

- En el contexto de **US-A6: Consulta y filtrado del catálogo**, enfrentando **la necesidad de visualizar un listado paginado de mis contenidos con opciones para filtrar por estado y visibilidad**, decidimos por **Node.js + NestJS** para el backend y **PostgreSQL** como base de datos, aceptando que la complejidad adicional de filtrar por estado y visibilidad es manejable.

