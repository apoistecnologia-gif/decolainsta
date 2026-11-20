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
  sem ambas, nenhuma consulta agendada acontece. A segunda foi habilitada
  **somente no Preview**, em 19/11/2026, para testes de leitura já finalizada.
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

Referências novas permanecem com `enabled=false` para preservar as
restrições dos recursos legados. **A leitura externa possui um vínculo
independente**: o simples cadastro não permite agir no Instagram.
Desativar explicitamente uma referência pela API `PATCH /targets/[targetId]`
também revoga seu vínculo de leitura. A revogação gera uma lápide persistida;
a descoberta automática não pode reativar silenciosamente a referência.

### Descoberta automática dos agentes existentes

A rota administrativa `POST /api/provider/phantombuster/match-collectors`
recebe somente `{"accountId":"ID","operation":"match-existing"}`.
Nenhum cliente precisa conhecer um ID de coletor. O sistema consulta
`GET /agents/fetch-all?withArgument=true` no servidor e **descarta**
os argumentos completos (podem conter cookies). Só considera agentes cujo
`script` seja exatamente `Instagram Follower Collector.js` e cuja
configuração contenha uma única referência Instagram inequívoca em um dos
campos suportados. Perfis em planilhas, campos contraditórios e associações
ambíguas são recusados.

A criação dos vínculos é transacional, isolada por conta, e limitada a
três novas referências por chamada. Dois clientes jamais devem utilizar
o mesmo agente. O botão **Atualizar dados** solicita essa descoberta
automaticamente quando o usuário autenticado é administrador; os demais
usuários continuam com acesso à leitura de suas próprias contas, não
à gestão da workspace compartilhada.

Antes de importar qualquer resultado, o backend consulta novamente a
configuração do coletor e exige o mesmo `script` e perfil de destino.
Além disso, requer que a execução finalizada informe `endedAt` válido
e que tenha terminado **depois da associação aprovada**. Resultados
anteriores à associação ou sem horário de encerramento não entram na
importação automática. Isso evita atribuir uma execução antiga a um
novo alvo, mas **não comprova** que os usernames eram seguidores reais
da referência; o dado continua rotulado como não verificado pela Meta.
Nenhum agente é criado ou iniciado nessa etapa.

A lista global fixa de coletores no ambiente deixou de ser utilizada.
A **criação automática de Phantoms novos ainda não existe**; exige validação
do modelo de parâmetros, disponibilidade de slots e autorização explícita
para executar operações que podem consumir créditos.

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

## Provisionamento seguro de rascunhos — inativo por padrão

A API oficial da PhantomBuster suporta `POST /api/v2/agents/save` com
`org=phantombuster`, `script=Instagram Follower Collector.js`,
`branch=master`, `name`, `launchType=manually` e uma
`idempotencyKey` para criações. Referências oficiais:
- https://hub.phantombuster.com/reference/post_agents-save
- https://support.phantombuster.com/hc/en-us/articles/32397676422546-How-to-create-a-Phantom-via-API
- https://support.phantombuster.com/hc/en-us/articles/26971109041170-How-to-Use-the-Instagram-Follower-Collector

O módulo `lib/providers/phantombuster-collector-drafts.ts` prepara um
rascunho **inativo, sem argumentos nem sessão Instagram**. Nomes e
chaves de idempotência determinísticos são calculados exclusivamente
a partir de IDs internos. A consulta somente leitura
`findExistingCollectorDraft` evita solicitar um segundo agente com o
mesmo nome. O módulo **não lança**, **não agenda** e não define
`wasSetupValidWhenSubmittedByTheFrontend=true`.

`POST /api/provider/phantombuster/collector-drafts` é um endpoint
administrativo restrito ao **Preview**:
- `{"operation":"plan","accountId":"ID"}` fornece apenas contagens
  de referências, vínculos, rascunhos já tentados e elegibilidade.
  Não chama a API do provedor nem grava dados.
- `{"operation":"create-next-draft","accountId":"ID",
  "confirmCreateUnconfiguredDraft":true}`
  fica **bloqueado** até
  `PHANTOMBUSTER_DRAFT_CREATION_ENABLED=yes` ser configurada
  expressamente no Preview. Não configurar essa variável por padrão.
  Criar um agente na workspace pode consumir um slot ou demandar plano pago.

Antes de qualquer criação, o backend exige conta/referência reais,
ausência de vínculo ou revogação e ausência de tentativa anterior.
Uma reivindicação é persistida sob transação serializável em
`ActivityLog` com ação `reference_collector_draft_v1`.
Mesmo um timeout deixa a referência bloqueada para uma segunda criação
automática, evitando duplicatas/cobranças inesperadas. A reconciliação
de uma execução incerta é manual pela administração, sem revelar
cookies ou dados brutos.

**O rascunho não serve para coletar dados até que o provedor tenha uma
conexão legítima e os argumentos exatos do Follower Collector.**
O DECOLA INSTA não deve inferir o formato do cookie, copiar sessões de
outra conta ou inventar os parâmetros. Após configuração e uma execução
finalizada posterior à associação, a descoberta e leitura existentes
podem reconhecer o coletor.

**Não houve criação de Phantom, chamada de `/agents/save`, consumo de
slot, execução externa ou ativação de conta neste desenvolvimento.**
A implementação prepara a capacidade, não substitui a validação
operacional por um teste real autorizado.

A operação `create-next-draft` seleciona **a primeira referência elegível
da conta**, em ordem estável de cadastro, sem pedir ao cliente ou ao
administrador que escolha cada referência individualmente. O limite de
uma criação por solicitação e a confirmação administrativa permanecem
por precaução com os slots do provedor. Não há criação em lote nem
agendamento de lançamentos nesta etapa.

## Diagnóstico real de conexão no Preview (sem reapresentar a chave)

O botão já existente **Atualizar dados** agora consulta
`GET /api/provider/phantombuster/connection-status?accountId=...`, que
faz uma chamada de leitura ao PhantomBuster usando a chave guardada no
servidor. A rota exige sessão, comprova que a conta pertence ao usuário e
não envia a chave ao browser. Ela informa apenas o estado da API,
quantidade de referências e quantas têm coletores registrados naquela
conta. Não afirma que a coleta foi feita nem que o Instagram foi acessado.

`GET /api/provider/phantombuster?accountId=...` também foi ajustado
para autorizar **qualquer conta do seu titular** no Preview, sem depender
da antiga conta piloto. O POST manual legado de diagnóstico de perfil
permanece separado, mas não é necessário para testar a conexão com a
chave cadastrada.

A descoberta de agentes utiliza o parâmetro oficialmente documentado
`withArgument=true` em `GET /agents/fetch-all`. Quando o provedor não
traz os argumentos de algum agente, há fallback controlado para
`GET /agents/fetch?id=...`. Em ambos os casos, os argumentos completos
são descartados no servidor: nomes de usuário, cookies e tokens não
aparecem na resposta.

Na preparação de rascunhos, a organização não é fixada em
`phantombuster`; o provedor resolve o workspace associado à chave,
conforme a API oficial, sem sobrescrever a organização do operador.

### O que foi comprovado

Os testes locais e CI validam autenticação, seleção segura de coletores,
isolamento entre clientes, resultados sanitizados e ausência de ações
sociais. **Ainda não são uma execução externa real.** Uma coleta
real exige um Follower Collector corretamente conectado e previamente
executado no PhantomBuster. A função aqui apresentada só lê resultados
finalizados depois de um vínculo aprovado.

### Página principal simplificada

A página `/references` usa `SimpleReferencesPanel`. Ela não prioriza
`@contateste6699`; seleciona uma conta conectada do titular, ou sua
primeira conta cadastrada. Os endpoints
`/api/reference-candidate-queue` e `/api/reference-auto-plan`
agora aceitam qualquer conta pertencente ao usuário autenticado no
Preview, sem a flag antiga `PHANTOMBUSTER_PILOT_USERNAME`.

O botão **Atualizar dados** da página principal, não só do diagnóstico,
tenta associar coletores preexistentes pelo vínculo exato (admin),
consultar resultados já finalizados (usuário da conta), sincronizar
o índice por conta e verificar a API usando apenas a chave do servidor.
Falhas externas não impedem a leitura de dados já salvos. A tela resume
conexão e referências que aguardam coletor em um parágrafo, sem solicitar
IDs, cookies ou nova chave de API. A execução externa de coletores e
ações sociais continuam inativas.

O painel legado avançado de diagnóstico ainda existe em
`/references/diagnostics`; seu POST de teste antigo é separado do
fluxo multiusuário de produção planejado.

### Coletor já existente com execução anterior (corrigido em 19/11/2026)

O PhantomBuster pode armazenar **uma URL direta de Instagram** no campo
`spreadsheetUrl` mesmo quando o operador seleciona a opção "A URL",
e não uma planilha. A associação automática anteriormente recusava
esse campo por inteiro. Agora reconhece apenas uma URL HTTPS direta
`https://www.instagram.com/<perfil>/`, sem parâmetros, planilhas ou
CSV; conflito entre vários campos é rejeitado. A URL deve corresponder
exatamente à referência salva na conta do cliente.

Quando o coletor já terminou uma execução **antes** de ser vinculado
à referência, o backend classifica o resultado como `historical-only`,
preserva o histórico já armazenado e não o importa novamente. O
dashboard informa o estado em texto curto. Não há exigência de nova
coleta para reconhecer um coletor; contudo, resultados antigos não
viram prova de seguimento verificado nem substituem a validação de
proveniência original.

A associação permanece administrativa no Preview para não permitir que
um cliente obtenha dados dos coletores pertencentes à workspace
compartilhada de outro cliente. Um usuário sem essa permissão recebe
um aviso curto de que a vinculação depende de autorização do
administrador, sem ver dados privados nem IDs de agentes.

Evidência: uma captura da workspace mostrou um Instagram Follower
Collector com execução anterior concluída e contagem de 429 perfis,
mas o coletor ainda não foi associado formalmente pelo backend a uma
referência salva. A ligação continua condicionada à verificação de
metadados e permissões, não ao número 429 por si só.

### Diagnóstico de leitura por coletor (20/11/2026)

O último `reference_audience_refresh_v1` da conta experimental,
às 01:22:47 UTC de 20/11/2026, terminou em `source-unavailable`.
A chave geral da workspace continuava acessível, mas a consulta de
**detalhes do agente específico** não concluiu. Esse código isolado
não identifica se a causa foi falta de acesso, limite de taxa ou falha
temporária; a desconexão do Instagram observada pelo operador também
não prova por si só qual chamada falhou.

A rota autenticada `/api/provider/phantombuster/connection-status`
agora verifica separadamente até **3 coletores explicitamente vinculados**
à conta do titular e expõe apenas códigos fixos de diagnóstico:
`matched`, `mismatch`, `not-found`, `invalid-key`,
`rate-limited`, `unavailable` ou `not-checked`.
A rota também apresenta o último status de tentativa guardado no banco,
limitado às referências atualmente associadas à conta e convertido a
uma lista de códigos permitidos. Não retorna nem armazena credenciais,
argumentos, nomes capturados, logs externos ou IDs dos agentes.
O botão **Atualizar dados** utiliza essas condições e mostra só uma
mensagem legível, sem painéis técnicos adicionais.

O campo `configuredToReadCompletedResults` exige agora a verificação
positiva do coletor, e não somente que a chave esteja funcionando.
O diagnóstico não cria, configura ou inicia agente algum.
A coleta nova depende de reconectar a sessão Instagram se o provedor
a indicar como desconectada e de uma execução posterior autorizada,
finalizada, associada à referência correta. O sistema conserva os
429 usernames históricos sem relançar o coletor.

### Ampliação segura dos limites de histórico e candidatos (20/11/2026)

Após a primeira importação incremental do PhantomBuster, o Preview atingiu
exatamente **60 lotes de histórico** e **500 candidatos**. A leitura
registrou 160 usernames novos em lotes de 10, 71 entradas novas no índice
e 340 nomes adicionais que não cabiam no histórico. Os dados anteriores
foram preservados e não há registro de ação social real.

A capacidade experimental aumentou de 60 para **200 lotes por referência**
(até 2.000 usernames por referência no formato legado de 10 por lote) e de
500 para **2.000 candidatos por conta**, com os limites de consulta e
sincronização alinhados. Essas são capacidades fixas e não uma garantia de
importação ilimitada. O modelo e o formato existentes são mantidos, sem
migração ou alteração destrutiva.

Os 340 nomes não foram armazenados na tentativa anterior. Eles só podem
ser recuperados numa **nova leitura de resultados concluídos**, com o
mesmo coletor e referência autorizados, após o intervalo de 6 horas da
última leitura bem-sucedida. O sistema deduplica contra os snapshots
já salvos e sincroniza o índice separadamente, sem relançar o Phantom.
Um novo clique em Atualizar dados pode preencher o índice a partir dos
dados já armazenados antes de estar liberada outra consulta externa.

Isso remove o bloqueio deste piloto, mas o dimensionamento para milhares
de perfis e muitos clientes ainda precisará de persistência paginada,
limites por plano e testes de carga. Não usar a ampliação como autorização
para iniciar coletas externas ou habilitar automação do Instagram.

## Preparação multi-cliente (20/11/2026)

O cadastro de referências continua separado de qualquer coleta ou atividade no
Instagram. Um cliente autenticado escolhe **sua** conta registrada em
`/references`, adiciona uma ou várias referências, vê a situação de
preparação de cada uma e os nomes indexados somente na própria conta.
`GET /api/reference-collection-status?accountId=...` verifica titularidade
e devolve apenas `source-linked` ou `awaiting-collector`, sem agentes,
cookies, nomes privados de outras contas ou leitura externa. O painel
principal apresenta isso como "Fonte de dados vinculada" ou
"Aguardando preparação"; não exibe um painel técnico novo.

Para a gestão do operador, o Preview tem
`POST /api/provider/phantombuster/match-all-customers`
com `{"operation":"match-all-existing"}`. A rota requer usuário
autenticado com `role=admin`, origem correspondente e flags de leitura
habilitadas. A opção aparece **somente no diagnóstico de administradores**.
Em uma única solicitação, consulta o catálogo de **coletores existentes**
do workspace e verifica todas as referências de todos os clientes,
limitando a 1.000 referências, 5.000 eventos de vínculo e 3 novos vínculos
por lote. Registra exclusivamente correspondências exatas de Follower
Collectors aprovados em uma transação serializável.

Proteção multi-inquilino: se dois clientes escolherem o mesmo nome de
referência, o processo **não escolhe um deles** para tomar posse do mesmo
agente. Também não usa coletores já vinculados, não reativa vínculos
revogados e não usa um único nome de perfil para inferir autorização.
Vínculos e resultados devem permanecer isolados por conta.

**Limitação operacional importante:** uma referência nova pode continuar
em "Aguardando preparação" caso não haja coletor já configurado no
workspace. Esta função **não cria nem configura automaticamente novas
conexões do Instagram**, não faz lançamentos, não habilita execução
recorrente de coletores e não executa seguir/deixar de seguir. O piloto
atual tem somente uma conta e um usuário com função comum; a rota de
operador não se torna acessível até haver um operador autorizado pela
administração da aplicação. Não elevar automaticamente a função do usuário.

A conta `@mameto_lueji` e os nomes históricos do piloto não são
referências globais nem exigências do sistema. Sua exclusão/retensão
deve ser deliberada e não faz parte destas mudanças.
