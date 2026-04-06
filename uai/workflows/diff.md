# UAI — Workflow: diff

<objetivo>
Comparar dois snapshots do modelo e identificar entidades adicionadas, removidas ou alteradas
(mudança de tipo, confiança ou relações). Útil para rastrear evolução do modelo entre sessões
de análise ou antes/depois de alterações no código-fonte.
</objetivo>

<contexto>
Leia antes de executar:
- `.uai/STATE.md` — fase atual

`$ARGUMENTS` deve conter:
- `<snapshot-anterior>` — caminho para pasta de snapshot ou `entities.json` anterior
- `[<snapshot-atual>]` — opcional; se omitido usa `.uai/model/entities.json` (estado atual)
- `--json` — saída em JSON além do resumo textual
</contexto>

<processo>
1. Parsear `$ARGUMENTS` para extrair os dois caminhos.
   - Se apenas um caminho: usar `.uai/model/entities.json` como atual.
   - Se nenhum: solicitar ao usuário o caminho do snapshot anterior.
   - Aceitar `current` como alias para `.uai/model/`

2. Verificar que ambos os caminhos existem e são legíveis.
   Se não: reportar qual arquivo está faltando e parar.

3. Executar comparação:
   ```
   uai-cc diff <anterior> [<atual>] [--json]
   ```

4. Apresentar resultado categorizado:
   ```
   Diff do Modelo — MEUSIS
   Anterior : snapshots/2024-03-01/entities.json  (280 entidades)
   Atual    : .uai/model/entities.json             (312 entidades)

   ADICIONADAS (35):
     + PGMNOVO     [program]  conf: 0.88
     + TB-HISTORICO [table]   conf: 0.76
     ...

   REMOVIDAS (3):
     - PGMOLD     [program]
     - WRK-OBS-ANT [field]
     ...

   ALTERADAS (12):
     ~ PGMCALC    confiança: 0.72 → 0.91
     ~ WRK-SALDO  tipo: field → field  relações: +3 READS
     ...

   Resumo: +35 / -3 / ~12 entidades
   ```

5. Se `--json`, informar caminho: `.uai/reports/diff.json`

6. Identificar mudanças críticas (remoções de entidades com alta confiança ou alto fan-in):
   > "Atenção: PGMCALC foi removido mas tinha 34 dependentes. Verifique se foi intencional."

7. Sugerir snapshot do estado atual se não houver pasta de snapshots:
   > "Para comparação futura, salve o estado atual: `cp -r .uai/model snapshots/$(date +%Y-%m-%d)`"
</processo>

<criterios_de_conclusao>
- [ ] Dois snapshots localizados e lidos com sucesso
- [ ] Diff categorizado (adicionadas, removidas, alteradas) com contagens
- [ ] Mudanças críticas (remoções de entidades importantes) destacadas
- [ ] Arquivo diff.json salvo se `--json`
- [ ] Sugestão de snapshot para comparação futura
</criterios_de_conclusao>
