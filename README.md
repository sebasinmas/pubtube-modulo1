# Módulo 1: Gestión de Contenidos y Almacenamiento

Este archivo sirve como **guía oficial** para levantar, configurar y probar el código correspondiente a este módulo. 

Esta guía está redactada cuidadosamente para que sea comprensible tanto para personal técnico y desarrolladores, como para personas que recién se familiarizan con el sistema. Te recomendamos leer todas las instrucciones detalladamente antes de iniciar el proceso de despliegue.

---

## Descripción General

Este módulo es el responsable de administrar el ciclo de vida completo del contenido audiovisual (videos). Funciona como la fuente de verdad del catálogo del sistema y representa el punto de entrada inicial para todo el flujo editorial.

Sus responsabilidades abarcan desde la ingesta de los archivos multimedia hasta el almacenamiento seguro de los objetos y el versionado de sus metadatos.

## Funcionalidades Principales

El sistema integra las siguientes capacidades operativas y técnicas:
> **Nota:** Esto se actualizará a medida que avancen los Sprints del proyecto.

---

## Gestión del Proyecto y Flujo de Trabajo

### Herramienta de Tablero
Para la planificación, gestión de historias de usuario y seguimiento ágil de los Sprints bajo el marco de trabajo **SCRUM**, el equipo utiliza **Trello**.
- **Flujo Kanban:** Permite organizar las tareas a través de estados claros (*Product Backlog*, *Sprint Backlog*, *In Progress*, *Review/QA*, *Done*).
- **Trazabilidad:** Cada tarjeta representa una historia o tarea técnica con sus criterios de aceptación y los responsables asignados según la matriz de roles por Sprint.

### Convención de Commits
Para mantener un historial de Git limpio, semántico y legible por herramientas automatizadas, se adopta la especificación de **[Conventional Commits](https://www.conventionalcommits.org/)**.

#### Estructura del Mensaje
```text
<tipo>(<alcance opcional>): <descripción corta en minúsculas y modo imperativo>

[cuerpo opcional con detalles y justificación del cambio]

[pie opcional con referencias a tareas de Trello o issues]
```

#### Tipos de Commits Permitidos
| Tipo | Descripción | Ejemplo |
| :--- | :--- | :--- |
| `feat` | Incorporación de una nueva funcionalidad | `feat(upload): implement resumable upload endpoint with chunking` |
| `fix` | Corrección de un error o bug | `fix(metadata): resolve concurrency issue in metadata update` |
| `docs` | Modificaciones exclusivamente en la documentación | `docs(readme): define commit conventions and trello tooling` |
| `refactor` | Refactorización de código sin alterar comportamiento | `refactor(storage): extract minio client into dedicated service` |
| `test` | Adición o corrección de pruebas unitarias o de integración | `test(catalog): add unit tests for filtering and pagination` |
| `chore` | Tareas de mantenimiento, dependencias o configuración | `chore(deps): update nestjs core dependencies` |
| `ci` | Cambios en configuración o scripts de integración continua | `ci(github-actions): configure automated test workflow` |
| `style` | Cambios de formato o estilo que no alteran la lógica del código | `style(lint): apply prettier formatting rules` |

---

## Guía de Despliegue y Ejecución

> **Nota:** En esta sección se documentarán los pasos para instalar dependencias, configurar variables de entorno (como las credenciales de S3) y levantar el servidor para realizar las pruebas.

### 1. Requisitos Previos
* *(Por definir)*

### 2. Instalación y Configuración
* *(Por definir)*

### 3. Ejecución del Proyecto
* *(Por definir)*
