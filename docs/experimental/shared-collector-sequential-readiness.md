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
O leitor legando mantém vinculação exclusiva por referência e NÃO passa
a aceitar agentes compartilhados. Não existem ainda reserva exclusiva de
agente, verificação de input por contêiner nem importação de resultados
compartilhados. Isso precisa de contrato validado com a API do provedor antes
de habilitar ações externas. Nenhum segredo é exposto.
