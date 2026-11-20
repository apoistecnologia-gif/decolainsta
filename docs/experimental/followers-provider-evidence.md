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
