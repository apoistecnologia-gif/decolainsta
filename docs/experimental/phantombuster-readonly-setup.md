# DECOLA INSTA — Primeira integração real com PhantomBuster (somente leitura)

Data: 2026-11-19
Escopo: **somente a branch experimental**. Não configura nem altera o ambiente de produção.

## Por que não tentar outra senha pela instagrapi?

A conta de teste funcionou no app oficial, mas a instagrapi 3.2.19 recebeu `PleaseWaitFewMinutes` + HTTP 429 na Railway. Não há autenticação privada estabelecida; o código atual do motor não deve repetir o login nem tentar contornar o limite. A alternativa avaliada usa a sessão **do próprio usuário em seu navegador**, conectada conscientemente a um fornecedor, sem o DECOLA INSTA extrair cookies.

## O que foi implementado

- Cliente somente leitura `lib/providers/phantombuster.ts`: chama exclusivamente `GET https://api.phantombuster.com/api/v2/agents/fetch-all?withArgument=false`, usando `X-Phantombuster-Key` em cabeçalho *server-side*.
- Endpoint `GET /api/provider/phantombuster?accountId=<id>`: autenticação do usuário, verificação de propriedade da conta, ativação explícita para uma única conta piloto, não possui endpoint de escrita.
- `ProviderConnectionPanel` na página de referências: botão de consulta read-only, mensagem de sucesso/erro, limites e links oficiais.
- Sem salvar ou devolver argumentos dos agentes, sessão de navegador, senhas, cookies, chaves API, resultados de seguidores ou nomes de outros agentes da workspace; só contagem agregada de agentes.
- Nenhuma conexão com PhantomBuster foi feita até a chave da workspace ser configurada. **Workspace acessível não significa Instagram conectado.**
- Nenhuma consulta de Instagram, follow, unfollow, fila, webhook, CRON ou mudança do banco foi implementada nesta etapa.

## Pré-requisitos para o titular (não enviar segredos ao ChatGPT)

1. Criar uma workspace em [PhantomBuster](https://phantombuster.com/) usando a **conta de teste do Instagram**, via extensão oficial e sessão aberta no navegador. Revise privacidade/risco: a extensão transfere uma sessão autenticada ao provedor, o que pode dar acesso à conta enquanto válida.
2. Validar no painel da PhantomBuster que a sessão Instagram aparece conectada. **Não executar** os Phantoms de follow/unfollow nessa etapa. Falha de conexão/429/challenge deve interromper o piloto, não desabilitar 2FA.
3. **A API exige plano pago**, conforme [guia do provedor](https://support.phantombuster.com/hc/en-us/articles/4401916698130-How-to-Get-Started-with-the-PhantomBuster-API). Não contratar sem decidir conscientemente sobre preço e riscos.
4. Após escolher o plano e criar uma chave API da workspace, configurar **somente no Vercel Preview**, nunca na produção nem no navegador, as seguintes variáveis:
   - `PHANTOMBUSTER_API_KEY`: chave da workspace (se possível *sealed* ou equivalente).
   - `PHANTOMBUSTER_READONLY_ENABLED=yes`.
   - `PHANTOMBUSTER_PILOT_ACCOUNT_ID`: identificador exato de uma conta Instagram **de teste** cadastrada no DECOLA INSTA e pertencente ao usuário autorizado.
5. Não ativar variáveis globais sem restringir o `PHANTOMBUSTER_PILOT_ACCOUNT_ID`. Não anexar a chave de terceiros ao projeto Railway de instagrapi: são integrações separadas.
6. No Preview Vercel da branch experimental, abrir a aba **Contas de referência**, selecionar a conta de teste e clicar **Verificar conexão com a workspace**. A tela mostrará apenas se a API permitiu ler a lista de agentes, sem confirmar Instagram.
7. A confirmação da sessão Instagram requer validação manual no painel oficial da PhantomBuster. Nenhum método da API atualmente implementado infere essa confirmação.

## Segurança

A chave API não é guardada por navegador, não é aceita por request, não é retornada para outros usuários e não vai em logs. `GET` requer usuário autenticado e conta de teste própria; com parâmetros ausentes retorna erro. API principal fica desligada por padrão e fica inerte se a chave estiver ausente. Chamadas HTTP bloqueiam redirects e expiraram em 8 s. `429` produz estado `limited`, sem retentativa automática.

Endpoint provedor: [GET /agents/fetch-all](https://hub.phantombuster.com/reference/get_agents-fetch-all).
Chave API: [guia de introdução](https://support.phantombuster.com/hc/en-us/articles/4401916698130-How-to-Get-Started-with-the-PhantomBuster-API).

## Etapas pendentes (não simular)

- Workspace PhantomBuster criada e conta de teste conectada pelo titular.
- Plano pago + chave API configurada pelo titular no Vercel Preview.
- Consulta real com o novo endpoint, a ser realizada com consentimento.
- Avaliar separadamente, antes de qualquer ação real, se o fornecedor aceita seguir seguidores de referência, permite agendamento 24/72h, limites da conta e risco de termos da plataforma.
- Projetar idempotência, deduplicação, whitelist, proteção contra unfollow de followback, armazenamento minimizado e métricas **comprovadas pelo provedor**. Migração/ação real depende de autorização separada.

## Pré-configuração sem chave ou pagamento (somente Preview da branch)

O sistema pode restringir o diagnóstico a `PHANTOMBUSTER_PILOT_USERNAME=contateste6699`, em vez de exigir que o titular encontre e compartilhe o ID interno do banco. A API confirma antes que o usuário autenticado é dono de `accountId`, então uma pessoa não consegue consultar outra conta apenas informando seu username. A flag `PHANTOMBUSTER_READONLY_ENABLED=yes` sem `PHANTOMBUSTER_API_KEY` não faz chamadas ao provedor e devolve `not-configured` para a conta autorizada. Não habilita qualquer operação Instagram.

A verificação da PhantomBuster continua dependendo de uma chave de workspace adicionada pelo titular diretamente no cofre do Preview e de um plano elegível. O navegador da conversa fornece no máximo leitura de abas: não autoriza capturar cookies, extrair chaves ou clicar na conta do usuário. A conta de teste precisa estar cadastrada no DECOLA INSTA para poder ser selecionada no painel; este procedimento não a cadastra no banco.
