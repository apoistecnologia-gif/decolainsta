# Relatório de follow do PhantomBuster — uma execução específica

GET do resultado da execução por ID, conforme documentação oficial:
- `GET /api/v2/containers/fetch-result-object?id=<containerId>` (resultObject, não acumulado)
- `GET /api/v2/containers/fetch-output?id=<containerId>` (apenas resumo, nunca expor saída bruta)

No Preview, operador autenticado usa "Importar resultado desta execução"
apenas para tentativa previamente registrada em `container-finished`,
sem lançar outro agente. Respostas são limitadas em tamanho, sem redirects
e não divulgam dados privados da sessão, logs, biografia nem chaves.

Regras de evidência:
- Exatamente UM perfil no resultado da execução, URL Instagram válido;
  o `profileName` precisa corresponder e o `query` precisa corresponder
  à referência cadastrada para aquela conta.
- Somente se o output da mesma execução disser explicitamente
  `1 profile followed`, registrar estado `provider-reported`.
- Salvar no máximo um nome de usuário e contagem 1, com status
  `followConfirmed:false`. É comprovação do RELATO DO FORNECEDOR,
  não confirmação independente da relação na conta Instagram.
- Não criar `FollowAction`, não alterar contadores oficiais,
  não agendar nem executar unfollow.
- Em retornos vazios, ambíguos, rate limit ou falhas, preservar o
  estado `container-finished`; não inferir sucesso de uma tabela isolada.

O navegador do operador já exibiu sucesso e um resultado nessa execução,
mas a integração só registrará o resultado após a API responder com
dados verificáveis da execução salva. Nunca reexecutar automaticamente.

## Confirmação de solicitação e status observado no Instagram

O primeiro perfil selecionado pelo PhantomBuster foi privado. O titular
confirmou no Instagram que o botão apresenta **Solicitado** e não
**Seguindo**. Portanto, o relatório do provedor deve ser mostrado como
uma ação reportada, NÃO como follow efetivado.

Nova operação administrativa no Preview:
`POST /api/operator/followers-auto-follow-run`
com `{operation:"record-relationship",observedStatus:"requested"|"following"|"none"}`.
A identidade do perfil é obrigatoriamente a do **registro de resultado já
validado**; o browser não envia outro alvo. Operação exige administrador,
mesma origem, conta de teste e referência corretas, e execução
`provider-reported`. Registro por CAS na tentativa e log de auditoria
imutável com data do servidor. Sem API Instagram ou ação PhantomBuster.

Os estados observados pelo titular são separados da verificação
independente. Mesmo quando o usuário indicar `following`, a confirmação
técnica de follow permanece falsa, sem criar `FollowAction`, sem contadores
oficiais, e o prazo de 48 horas permanece **não iniciado**.
Um pedido pendente nunca é elegível para unfollow.


## Privacidade reportada e elegibilidade conservadora (2026-11-20)

Documentação oficial de "Instagram Followers Auto Follow" (atualizada em
14/07/2026):
https://support.phantombuster.com/hc/en-us/articles/26971112664722-How-to-Use-the-Instagram-Followers-Auto-Follow

- O agente suporta a opção visível **Exclude private profiles**; a
  documentação não identifica a chave JSON interna para alterá-la via API.
  **Não tentar gravar configurações presumidas nem alegar que o filtro
  está ativo no agente conectado.**
- O resultado do agente documenta o campo `isPrivate`. A importação de
  uma execução pode registrar `providerReportedPrivate` somente quando
  `isPrivate` for booleano, com `providerPrivacyReadAt` (data de leitura
  pelo DECOLA INSTA). Sem o campo, o estado é desconhecido, nunca público.
- Esse valor é **informação do PhantomBuster**, não uma leitura de
  relacionamento autenticada pelo Instagram. Os registros antigos continuam
  legíveis e a solicitação pendente original permanece inalterada.
- `assessUnfollowEligibility` é apenas uma função pura e inativa que
  exige prova independente, relação atual seguindo, ausência de pedido
  pendente, 48 horas completas, autorização, não pertencer a whitelist,
  nenhuma proteção e confirmação de que não segue de volta.
  **Nenhum provedor atual está ligado como fonte de confirmação independente.**
- Não cria FollowAction, não altera agendamento/credenciais, não executa
  follow/unfollow e não faz polling externo automático.

## Consulta de privacidade de execução antiga (leitura somente)

No diagnóstico administrativo do Preview, a operação
`{operation:"check-profile-privacy"}` consulta APENAS o resultado do
contêiner ID salvo, pela rota GET do PhantomBuster
`/api/v2/containers/fetch-result-object`. A API não lança nenhum agente.
A mesma conta de teste, referência e operador autenticado são obrigatórios.

- Exige tentativa em `provider-reported` com nome de perfil já conhecido.
- Exige resultado com **um único perfil**, URL, nome e referência compatíveis,
  e o mesmo nome de usuário já salvo na tentativa original.
- Aceita somente `isPrivate` booleano. Ausente, string, ambiguidades,
  429 e erros não são convertidos em perfil público.
- Quando houver dado válido, atualiza apenas os campos históricos de
  privacidade por compare-and-swap e cria auditoria separada com data e
  origem `phantombuster-saved-run`. Dados existentes de relacionamento
  (incluindo `requested`) nunca são apagados ou promovidos a follow.
- Consulta repetida reutiliza dado salvo e não faz polling adicional.
  A interface é apenas administrativa, sem controles técnicos para cliente.
- Nenhum follow/unfollow real, nenhuma migração e nenhum cron novo.


## Verificação do filtro no manifesto do agente (somente leitura)

A API oficial suporta `GET /api/v2/agents/fetch?withManifest=true`,
mas os nomes dos argumentos variam por automação.

- `readSavedPrivateFilter` só considera o agente manual correto, a conta
  de referência correta, limite 1 e um único campo booleano inequivocamente
  rotulado **Exclude private profiles** no esquema/formulário do manifesto.
- Manifesto ausente, campo indefinido, múltiplos campos ou valor não booleano
  retornam **unverified**. Nunca deduzir a chave com base em palpites.
- O diagnóstico do operador expõe apenas `enabled`, `disabled`,
  `unverified` ou motivo sanitizado, e a configuração `skipPrivateProfiles`
  isolada da conta cadastrada. Sem cookies, argumentos ou credenciais.
- Antes de **qualquer lançamento futuro** o backend exige preferência de
  exclusão ativa na conta e filtro `enabled` no manifesto. Não há
  automatização nova, nem alteração nas configurações do PhantomBuster.
- A tentativa anterior `requested` permanece preservada e nenhum
  cron ou unfollow automático é ativado.


## Diagnóstico sanitizado de filtro não confirmado (melhoria)

A operação administrativa de verificação continua de leitura somente. Em
vez de retornar apenas `unverified`, ela fornece um motivo delimitado:
manifesto ausente/inválido, campo não descrito/ambíguo, argumento ausente,
valor inválido ou erro de consulta do provedor. O motivo é **um enum fixo**,
sem dados brutos da sessão, configurações ou credenciais.

- Aceita o manifesto JSON como objeto ou texto JSON válido, com limite
  de tamanho. Mapeamento do campo permanece estrito: rótulo oficial,
  tipo booleano e chave única, com valor salvo booleano.
- Falta de evidência não equivale a filtro desabilitado.
- O painel não mostra mais "lançamento habilitado" quando já existe uma
  tentativa única registrada; o botão redundante de importar resultado é
  ocultado após `provider-reported`.
- O primeiro histórico e a observação `requested` não são alterados.
  Nenhuma execução extra de follow/unfollow foi iniciada.

## Diagnóstico de códigos HTTP oficiais (2026-11-20)

A consulta com `withManifest=true` agora classifica separadamente:
- 401: acesso ao manifesto recusado (`manifest-access-denied`), **não**
  assumir chave inválida quando a consulta simples reconhece o agente.
- 403: acesso proibido; 404: agente não encontrado; 412: script associado
  não disponível; 400: requisição rejeitada; 429: limite do provedor;
  5xx: erro do serviço.
- 200 com JSON inválido, resposta grande demais ou manifesto ausente:
  motivos diferentes, sem inferir que o filtro esteja ativo.
- Nenhum corpo bruto, headers, cookies, nomes de chaves ou tokens é
  devolvido ao navegador. A leitura permanece exclusiva ao diagnóstico.

Referência da API:
https://hub.phantombuster.com/reference/get_agents-fetch


## Reconciliação de 404 na consulta com manifesto

O endpoint `/agents/fetch` com `withManifest=true` pode responder 404
mesmo quando a validação de agente existente é `matched` via inventário.
A interface agora **não conclui que o agente foi excluído** apenas a
partir desse 404.

Após 404, o adaptador tenta exclusivamente GET
`/agents/fetch-all?agentIds=<ID>&withArgument=true`, e exige
exatamente uma entrada com ID, tipo, agendamento, referência e
limite de um perfil correspondentes. Se o inventário não trouxer
manifesto válido e valor booleano explícito da opção, retorna
`listed-agent-manifest-unavailable`, com o filtro **não verificado**.
Caso o manifesto esteja presente e seja inequívoco, mantém a mesma
validação rigorosa do caminho principal.

É apenas leitura: nenhum follow, unfollow, alteração de agente,
permissão ou credencial. A tentativa original permanece intacta.


## Correção do interpretador do manifesto: `argumentForm.steps[].fields` como objeto

A documentação do endpoint `/agents/fetch-all` descreve
`manifest.argumentForm.steps[].fields` como um **mapa de campos**,
não obrigatoriamente uma lista. O interpretador anterior só percorria
arrays e objetos com o próprio `label`, ignorando as entradas desse mapa.
Consequentemente retornava `filter-not-described` mesmo quando a
descrição de um checkbox estava presente.

Agora lê até 100 entradas de cada `fields` estruturado como objeto.
O nome do campo é derivado exclusivamente da chave desse mapa,
com `label` ou `title` igual a **Exclude private profiles**
e tipo explicitamente booleano/checkbox/toggle/switch. Exige que
qualquer nome em linha concorde com a chave, e que o argumento salvo
seja um booleano literal. Ambiguidades, tipos inválidos, campo
ausente ou manifesto indisponível continuam bloqueados.

A consulta permanece restrita ao operador no Preview e não altera o
agente ou executa ações no Instagram. A confirmação ainda dependerá
da leitura de um manifesto verdadeiro; testes usam somente fixtures.
