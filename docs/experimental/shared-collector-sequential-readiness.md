# Reutilização sequencial do coletor — preparação somente leitura

## Capacidade documentada
O Instagram Follower Collector aceita uma URL direta ou Google Sheets/CSV com
várias URLs. Entretanto, os campos de saída documentados (username, profileUrl,
id etc.) descrevem os seguidores; não fornecem um campo obrigatório de
identidade da referência para cada linha.

Fonte: https://support.phantombuster.com/hc/en-us/articles/26971109041170-How-to-Use-the-Instagram-Follower-Collector

## Regra para evitar mistura entre clientes

- Uma execução de coleta corresponde exatamente a uma referência de uma única
  conta cliente, mesmo que o agente possa ser reutilizado ao longo do tempo.
- Cada execução futura requer reserva exclusiva e durável no servidor, prova
  vinculada à conta, à referência, ao agente e ao ID do contêiner.
- A referência de entrada precisa constar do snapshot **daquela execução**, e
  não apenas das configurações editáveis do agente consultadas posteriormente.
- Resultados do arquivo `result.json` (último arquivo do agente) NÃO são aceitos
  como prova de atribuição para um coletor compartilhado.
- Entrada com várias referências na mesma execução é rejeitada para importação
  enquanto não houver prova explícita de origem por linha, testada com resultados
  reais do provedor.
- O modo de reutilização não reutiliza sessões Instagram entre clientes.
- Alterar o agente conectado sem comprovar sessão, ocupação de vaga, configuração
  e titularidade pode prejudicar automações existentes. Não fazer isso
  automaticamente.
- Nenhuma coleta, follow, unfollow ou agendamento é ativado por este módulo.

## Estado da implementação

`lib/reference-shared-collector-evidence.ts` contém o verificador puro e
`sequentialCollectorReadiness` retorna uma descrição dos bloqueios.
A operação `plan` do endpoint de preparação inclui somente essa descrição.
O leitor legado mantém vinculação exclusiva por referência e NÃO passa
a aceitar agentes compartilhados.

`lib/reference-shared-collector-lease.ts` adiciona a **reserva inicial,
durável e exclusiva** por agente usando `pg_advisory_xact_lock` e o histórico
atual de `ActivityLog` (sem migração). Uma reserva impede novas reservas do
mesmo agente em outros clientes. Também bloqueia agentes previamente vinculados
ou reservados por rascunhos. Ela só pode ser solicitada por um serviço interno,
com operador administrador, referência da própria conta e duas variáveis
explícitas na branch Preview:
`PHANTOMBUSTER_SHARED_COLLECTOR_LEASE_ENABLED=yes` e
`PHANTOMBUSTER_SHARED_COLLECTOR_AGENT_ID=<ID verificado>`.
Nenhuma das duas foi configurada por esta alteração.

**Atenção:** o ciclo completo de lease NÃO está habilitado. Uma reserva
bem-sucedida ainda não tem endpoint de liberação, pois seria necessário
comprovar que o contêiner da execução foi finalizado e que não existe uma
operação remota incerta. Não há integração entre essa reserva e qualquer
execução, mudança de argumentos ou importação; não chamar essa função até que
o reconciliador de finalização e testes de concorrência com PostgreSQL
estejam prontos.

A leitura e importação do leitor legado não foram alteradas.
**Proteção adicional:** todas as rotas legadas que criam vínculos de coletores
(`match-all-customers`, `match-collectors`, `reconcile-prepared` e
`collector-bindings`) consultam o registro global de reservas na mesma
transação `SERIALIZABLE`. Uma reserva de outro cliente impede nova associação;
registros de reserva malformados ou limites excedidos bloqueiam a escrita.
A própria reserva também consulta todo o registro global, sem filtrar por
cliente. Isso reduz o risco de concorrência entre o fluxo antigo e o novo.

`lib/providers/phantombuster-container-inspection.ts` prepara uma consulta
**somente leitura** ao `/containers/fetch?id=...`, validando a identidade do
agente e contêiner, conclusão e, caso exista, o argumento daquele contêiner.
Não usa a configuração editável de `/agents/fetch`, arquivo de resultado
acumulado ou execução de Phantom. O resultado é apenas diagnóstico:
`immutableInputProven: false` e `releaseAuthorized: false` sempre.

A documentação pública do provedor não garante o significado ou a existência
do campo `argument` por execução. Sem prova consistente de entrada, estado
finalizado de contêiner e ausência de outras execuções ativas, **NÃO existe
liberação automática da reserva**. Também faltam a integração entre reserva e
lançamento, a verificação de um contêiner real, a importação isolada e testes
de concorrência com PostgreSQL real. Não configurar as flags de ativação.

As três referências permanecem pendentes. Nenhum segredo é exposto, nenhuma
conta Instagram foi acionada e nenhum agente externo foi criado.
