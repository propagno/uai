# UAI — Workflow: verify

<objetivo>
Medir a qualidade e cobertura do modelo: percentual de entidades com confiança alta,
lacunas de documentação, código morto potencial e hotspots de alta complexidade.
Gera relatório `.uai/reports/VERIFY.md`.
</objetivo>

<contexto>
Leia antes de executar:
- `.uai/STATE.md` — deve estar em fase `MODELED` ou superior
- `.uai/model/entities.json` — modelo canônico

`$ARGUMENTS` pode conter:
- `--deadcode` — incluir análise de código morto (entidades sem referências)
- `--json` — saída em JSON além do Markdown
</contexto>

<processo>
1. Verificar pré-condições:
   - `.uai/model/entities.json` existe e tem > 0 entidades?
   Se não: instruir `/uai-model` primeiro.

2. Executar verificação:
   ```
   uai-cc verify [--deadcode]
   ```

3. Ler `.uai/reports/VERIFY.md` gerado e extrair métricas principais:
   - Cobertura total (% entidades com conf ≥ 0.8)
   - Entidades de baixa confiança (conf < 0.5)
   - Relações sem evidência
   - Hotspots (top 10 por fan-in — mais chamados)

4. Apresentar dashboard de qualidade:
   ```
   Qualidade do Modelo — MEUSIS

   Cobertura    : 73%  (228/312 entidades com conf ≥ 0.8)
   Lacunas      : 38 entidades com conf < 0.5
   Sem relações : 12 entidades isoladas
   Relações s/evidência: 7

   Hotspots (top 5 por fan-in):
     PGMUTIL     — 34 chamadores
     WRKAREA.cpy — 28 referências
     TB-CLIENTES — 19 referências
     PGMVALID    — 15 chamadores
     TB-EXTRATO  — 14 referências
   ```

5. Se `--deadcode` ativo, adicionar seção de código morto:
   ```
   Código Morto Potencial (sem referências de entrada):
     PGMOLD     [program]  — 0 chamadores
     PGMTEST01  [program]  — 0 chamadores
     WRK-CAMPO-OBS [field] — 0 usos
   ```
   Sugerir confirmar com analista antes de remover.

6. Verificar gate: cobertura > 0%?
   - Sim: relatório VERIFY.md pronto
   - Não: modelo vazio ou corrompido — verificar pipeline

7. Recomendar próximos passos baseado nas lacunas:
   - Muitas lacunas de confiança → `/uai-obs` para adicionar contexto manual
   - Código morto detectado → confirmar com analista via `/uai-review`
   - Hotspots críticos → documentar com `/uai-doc`
</processo>

<criterios_de_conclusao>
- [ ] `uai-cc verify` executado com sucesso
- [ ] `.uai/reports/VERIFY.md` existe com cobertura > 0%
- [ ] Dashboard de qualidade apresentado com métricas principais
- [ ] Seção de código morto incluída se `--deadcode`
- [ ] Recomendações de próximos passos baseadas nos gaps encontrados
</criterios_de_conclusao>
