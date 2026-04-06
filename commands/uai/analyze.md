---
name: uai:analyze
description: Pipeline completo de analise (ingest + model + map) com suporte a agentes paralelos por dialeto
argument-hint: "[--mode solo|waves|dialects] [--resume] [--dry-run]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Agent
---

**Workflow:** `uai/workflows/analyze.md`

Execute integralmente esse arquivo. Use `$ARGUMENTS` como foco (modo de execução e opções do pipeline).
