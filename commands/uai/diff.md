---
name: uai:diff
description: Compara dois snapshots do modelo e lista entidades adicionadas, removidas ou alteradas
argument-hint: "<snapshot-anterior> [<snapshot-atual>] [--json]"
allowed-tools:
  - Bash
  - Read
  - Write
---

**Workflow:** `uai/workflows/diff.md`

Execute integralmente esse arquivo. Use `$ARGUMENTS` como foco (caminhos dos snapshots a comparar).
