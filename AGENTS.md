# AGENTS.md

Guía para agentes y colaboradores. Ver también `CLAUDE.md` para comandos y arquitectura.

## Nomenclatura

```
Actas:          planning-s<n>.md · review-s<n>.md · retro-s<n>.md · daily-s<n>-<aaaa-mm-dd>.pdf
Burndown:       PubTube_Burndown_<Equipo>.xlsx  (un solo archivo con todos los sprints)
ADR:            <nnnn>-<titulo-en-kebab-case>.md  (ej. 0003-outbox-en-publicadores.md)
Ramas:          feat/US-A3-carga-resumible · fix/US-B2-dlq · docs/arreglo-nomenclatura
Commits:        feat(contenidos): agrega checksum para idempotencia de carga
Pull request:   título con el ID de la historia y descripción del impacto en contratos
```

- Las actas viven planas en `scrum/actas/`; el sprint va en el nombre, no en carpetas.
- Las ramas sin historia asociada (docs, chores) omiten el ID de la historia.
- Los commits siguen Conventional Commits (validado por el hook `commit-msg`).
- Toda PR debe indicar si cambia contratos (`docs/contratos/`) o dejar explícito que no los toca.
