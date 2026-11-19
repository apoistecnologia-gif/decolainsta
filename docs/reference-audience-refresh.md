# Atualização de audiência — arquitetura multi-conta, somente leitura

Esta implementação da branch experimental substitui o antigo vínculo
`PHANTOMBUSTER_AUDIENCE_SOURCES_JSON` por **associações registradas no banco**,
separadas por `instagramAccountId` e `TargetAccount.id`. O executor **não**
depende mais do username de uma conta teste. Cada cliente pode cadastrar várias
contas Instagram, cada uma com várias referências.

## Limites e proteção da produção

- A API `PHANTOMBUSTER_API_KEY` é configurada uma vez no cofre da Vercel;
  nunca é enviada ao browser nem incluída na resposta.
- `PHANTOMBUSTER_READONLY_ENABLED=yes` e
  `PHANTOMBUSTER_AUDIENCE_POLL_ENABLED=yes` são flags independentes;
  sem ambas, nenhuma consulta agendada acontece.
- O endpoint de atualização manual exige login, propriedade da conta e origem
  de mesmo site, e funciona **somente no Preview**.
- O agendador `GET /api/cron/refresh-reference-audiences` exige
  `CRON_SECRET` válido e agenda Vercel em `0 10 * * *` (UTC).
- Fora do Preview, a consulta está bloqueada adicionalmente até
  `PHANTOMBUSTER_MULTI_ACCOUNT_PRODUCTION_ENABLED=yes`, que **não**
  deve ser ligado sem uma liberação explícita e revisão de capacidade.
- Nenhum endpoint inicia um Phantom, opera diretamente no Instagram, segue,
  deixa de seguir ou confirma follow-back.

## Vínculos dinâmicos (Preview)

Para evitar migrações em um banco possivelmente compartilhado, o vínculo
inicial usa eventos de `ActivityLog` com ação
`reference_audience_binding_v1`. O último evento de cada referência
prevalece; uma revogação a desativa, sem apagar o histórico de auditoria.
Um mesmo agente ativo não pode representar duas referências; conflitos
são bloqueados em vez de misturar clientes.

A configuração é uma operação **administrativa interna**, sem novos campos
no painel dos clientes: `POST /api/provider/phantombuster/collector-bindings`
requer usuário com função `admin` confirmada no banco, Preview, origem
correta, conta e referência reais, e confirmação explícita do coletor.
A validação consulta `GET /agents/fetch` no PhantomBuster e só aceita
o script **`Instagram Follower Collector.js`**. Um
`Instagram Followers Auto Follow.js` é recusado.
A validação do script não prova que sua configuração coleta a referência
correta; essa associação ainda deve ser auditada pelo operador.
A operação `unbind` revoga o vínculo sem apagar a referência.

Exemplo de corpo de configuração (IDs ilustrativos, sem credenciais):

```json
{
  "operation": "bind",
  "accountId": "ID_DA_CONTA",
  "referenceId": "ID_DA_REFERENCIA",
  "collectorAgentId": "1234567890123456",
  "confirmReadOnlyCollector": true
}
```

Para revogar: `{"operation":"unbind","accountId":"ID_DA_CONTA","referenceId":"ID_DA_REFERENCIA"}`.
Nunca colar chaves, cookies ou tokens nesse corpo.

Referências novas permanecem com `enabled=false` para não alterar
inadvertidamente a semântica de ativação de recursos existentes. Um
administrador só pode vincular referências habilitadas.
A habilitação legítima deve ser feita no próprio cadastro.
A lista global fixa de coletores no ambiente deixou de ser utilizada,
mas a **criação e configuração automática de novos Phantoms ainda não existe**.

## Execução e verificação

O botão já existente **Atualizar dados** usa
`POST /api/provider/phantombuster/refresh-now` e executa a mesma leitura
do agendador, restrita à conta autenticada. Ele só consulta uma execução
anteriormente finalizada (`completed_run`), mantém uma trava/cooldown
mínimo de 6 horas, importa somente novos usernames válidos, evita
duplicações e atualiza um índice inerte por conta.
A atualização verifica se a referência continua habilitada e pertence à
conta. Fontes não consultadas há mais tempo são priorizadas; no máximo
3 fontes são lidas em uma rodada.

`GET /api/provider/phantombuster/refresh-readiness?accountId=...`
devolve nomes de configurações ausentes, contagens e datas para a conta
autenticada, sem devolver IDs dos agentes, chaves ou dados brutos.
`technicalReady` significa pré-requisitos locais presentes; não é
prova de coleta real, nem de que o perfil coletado segue a referência.
Proveniência por Meta e execução de ações no Instagram continuam ausentes.

## Pendências para operação comercial

O limite inicial de 3 fontes por execução e 500 candidatos por conta foi
pensado para validação, não para uma frota de clientes. É necessário
dimensionar o worker e o agendamento, tratar a capacidade do histórico,
criar/provisionar coletores de forma autorizada para cada referência e
demonstrar uma importação real isolada por cliente. O banco de dados
mantém dados legados sem migração ou exclusão nesta etapa.
