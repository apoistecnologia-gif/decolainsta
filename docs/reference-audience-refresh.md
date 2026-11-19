# Atualização de audiência — piloto somente leitura

Esta implementação importa **novos usernames** de execuções **já finalizadas**
do PhantomBuster, sem selecionar candidatos individualmente. Ela **não inicia**
o coletor, não realiza chamadas ao Instagram, não segue/deixa de seguir e
não confirma follow-back. A atribuição de uma execução a uma referência é
informada pelo operador, **não verificada pela Meta**.

## Isolamento e ativação

O código está inicialmente **desativado**. Para uso futuro, configurar
somente no ambiente expressamente autorizado:

- `CRON_SECRET`: segredo exclusivo do agendador, pelo menos 32 caracteres.
- `PHANTOMBUSTER_READONLY_ENABLED=yes`: piloto de leitura existente.
- `PHANTOMBUSTER_AUDIENCE_POLL_ENABLED=yes`: novo opt-in independente.
- `PHANTOMBUSTER_PILOT_USERNAME`: conta Instagram de teste autorizada.
- `PHANTOMBUSTER_API_KEY`: chave do workspace PhantomBuster armazenada como
  variável **sensível** no servidor; nunca enviada pelo navegador.
- `PHANTOMBUSTER_AUDIENCE_SOURCES_JSON`: lista JSON de vínculos explícitos,
  usando IDs internos reais do banco, por exemplo:

```json
[
  {
    "accountId": "ID_DA_CONTA_CADASTRADA",
    "referenceId": "ID_DA_REFERENCIA",
    "collectorAgentId": "1234567890123456"
  }
]
```

IDs acima são ilustrativos: o parser exige IDs alfanuméricos, sem espaços.
Limite: 20 fontes configuradas, máximo 3 atualizações por execução,
uma referência por coletor. Fontes vencidas são priorizadas pela data da
última tentativa (as nunca consultadas vêm primeiro), evitando o bloqueio
das referências após a terceira. O operador deve conferir a associação antes
de permitir a ingestão. A configuração inválida desativa a execução.

## Agendamento e execução

O arquivo `vercel.json` define `GET /api/cron/refresh-reference-audiences`
às **10:00 UTC diariamente**. Agendamentos Vercel funcionam no deployment de
produção; **o Preview da branch experimental não executa esse cron
automaticamente**. Só quando houver decisão separada de ativação,
implantação e credenciais apropriadas esse processo poderá operar.

A rota exige `Authorization: Bearer <CRON_SECRET>` com comparação em tempo
constante. Não acessar esse endpoint com a chave PhantomBuster, cookie do
Instagram ou credenciais de navegador.

O trabalho é separado em: validação de vínculo da referência ao perfil,
claim serializável e cooldown mínimo de 6 h, leitura apenas da última
execução finalizada, cálculo incremental de usernames não registrados,
persistência de snapshots v1 e sincronização do índice inerte, com
transação serializável, exclusões e limite de 500 candidatos.

Snapshots e índice ficam isolados pelo ID da conta. Logs de atualização
guardam somente estados e contagens, nunca chaves, cookies, objetos brutos
ou erros vindos do provedor. As tentativas são tolerantes a repetição;
uma requisição duplicada não deve criar novos registros.

Se a leitura cair no `latest_agent_file`, a atualização programada **não
ingere** os dados: esse arquivo pode não corresponder à execução finalizada.
Isso difere da importação manual experimental existente, que sinaliza
claramente sua proveniência. Histórico no limite não é truncado
automaticamente. Havendo apenas parte da capacidade, os usernames novos são
importados até preencher o espaço restante; a resposta informa
`deferredByHistoryLimit`, o total adiado por falta de capacidade. Nenhum
nome adiado é considerado persistido.

## Limitações importantes

A automação depende de uma **execução finalizada nova no PhantomBuster**
para encontrar usernames novos. Esta rota não programa nem inicia coletas
no PhantomBuster. Sem `PHANTOMBUSTER_API_KEY`, `CRON_SECRET`, vínculos
explícitos e opt-in, continua desligada. Sem resultados novos, retorna
`unchanged` (ou uma indicação de erro seguro).

O painel `/references` permanece simples e não mudou. Ações reais de
follow/unfollow seguem desativadas. A regra de revisão de 48 h para
follow-back informado não é alterada nem executada pelo cron.
