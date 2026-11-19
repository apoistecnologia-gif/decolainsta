# DECOLA INSTA — Consulta experimental da PhantomBuster (somente leitura)

Atualizado em 2026-11-19. Somente branch `experiment/local-instagram-one-action-20261118`, Preview Vercel, sem alterações na produção.

## Evidência e objetivo

A conta de teste `@contateste6699` continua acessível no aplicativo oficial do Instagram, mas o piloto `instagrapi==3.2.19` recebeu `PleaseWaitFewMinutes` + HTTP 429 ao criar uma nova sessão privada na Railway. Esse caminho permanece desativado. O objetivo original do DECOLA INSTA continua sendo estudar seguidores de referências e, futuramente, permitir revisões de follow/unfollow 24/72h mediante testes, controle de riscos e autorização específica.

O titular exibiu uma tela da PhantomBuster com `Connected to Instagram` na configuração do `Instagram Followers Auto Follow`, mas isso **não é prova de que uma execução do Phantom consiga usar a sessão**. Não fazer teste com follow/unfollow nesta etapa.

## Código implementado

- `lib/providers/phantombuster.ts`: somente `GET /api/v2/agents/fetch-all` na API oficial PhantomBuster; `withArgument=false` e opcionalmente `agentIds=...`. Nunca chama um endpoint de lançamento.
- `GET /api/provider/phantombuster?accountId=...`: opcionalmente verifica a chave guardada **no backend**. Se ela não existir, devolve `not-configured` sem contatar o provedor.
- `POST /api/provider/phantombuster`: um **teste pontual somente leitura** com chave da API recebida no corpo HTTPS, que é usada para uma requisição GET ao provedor. A chave não é persistida em banco, cookie, armazenamento local ou variável de ambiente. Não é registrada em logs nem devolvida no JSON. A rota valida origem e rejeita corpo grande/inesperado.
- Requer login no DECOLA INSTA, propriedade da conta Instagram cadastrada, flag `PHANTOMBUSTER_READONLY_ENABLED=yes` e correspondência ao piloto exato por ID ou username.
- A interface em `/references` possui campo de chave temporária com `type=password`, opção de diagnóstico e avisos explícitos: workspace acessível e Phantom encontrado **não provam login Instagram**, nenhuma ação automática fica habilitada.
- Resultado retornado: estado estático, contagem de agentes e indicação de agente de teste encontrado ou ausente. Nenhuma configuração de agente, cookie, token ou senha é devolvida.
- Não há coleta de seguidores, follow/unfollow, agendamento, fila, migração de banco ou habilitação de produção.

## Pré-configuração já aplicada ao Vercel Preview

- `PHANTOMBUSTER_READONLY_ENABLED=yes`, target **preview** somente.
- `PHANTOMBUSTER_PILOT_USERNAME=contateste6699`, target **preview** somente.
- `PHANTOMBUSTER_PILOT_AGENT_ID=1838046655144130`, target **preview** somente, extraído da URL mostrada pelo titular ao abrir o Phantom. O ID não é uma credencial.
- `PHANTOMBUSTER_API_KEY` **não configurada**: o diagnóstico com chave armazenada permanece inerte. A chave pode ser apresentada temporariamente à própria interface do Preview para **uma** consulta. Nunca requisitar chave em mensagem, print ou log.
- O projeto Vercel não está vinculado a repositório Git para configuração de variáveis isoladas por branch; por isso os três controles foram definidos no escopo `preview` e o filtro de usuário/propriedade/piloto impede seu uso em contas não autorizadas. A produção não recebeu essas variáveis.

## O único passo inevitável do titular para a consulta real

1. Na workspace PhantomBuster, menu do perfil → `Technical` → `API keys` → `Add API key`; preferir uma chave de teste revogável.
2. No Preview protegido do próprio DECOLA INSTA, abrir `Contas de referência`, selecionar a **conta de teste já cadastrada** e colar a chave exclusivamente no campo protegido `Chave API da PhantomBuster`, depois clicar `Verificar acesso`.
3. A interface apaga o conteúdo do campo e informa apenas a leitura da workspace e se o Phantom foi encontrado. **Nunca enviar a chave para o chat**. Se a chave for comprometida, revogá-la imediatamente.

A API também está disponível **no teste grátis e no plano gratuito**, conforme documentação de 2026, com limite de **10 linhas por arquivo de resultados** no plano gratuito. Não é necessário contratar plano para este diagnóstico. Fontes:
- https://support.phantombuster.com/hc/en-us/articles/4494623647250-What-Each-PhantomBuster-Plan-Includes-Features-Limits-and-Pricing
- https://support.phantombuster.com/hc/en-us/articles/4401916698130-How-to-Get-Started-with-the-PhantomBuster-API
- https://hub.phantombuster.com/reference/get_agents-fetch-all

## Segurança e próximos portões

A chave API permite controle amplo da workspace PhantomBuster, possivelmente incluindo lançamentos. Embora nosso endpoint só faça leitura, o titular deve manter a chave segura e revogá-la depois de usar a chave de teste. Nunca copiar o cookie Instagram `sessionid`, deixar a chave em screenshots ou tentar repetir login privado sob HTTP 429.

## Marco validado no piloto — 19/11/2026

Evidência enviada pelo proprietário (tela de resultados da própria PhantomBuster):

- A verificação de acesso à API via Preview do DECOLA INSTA retornou `verified`, `workspaceAgentCount: 1` e `pilotAgentFound: true` para o primeiro agente (`Instagram Followers Auto Follow`). Isso comprova apenas o acesso à workspace e a existência do agente.
- O proprietário criou separadamente o Phantom **Instagram Profile Scraper** (ID `3648918782366739`, observado na URL de configuração).
- Uma execução **manual de leitura** do Instagram Profile Scraper terminou com **`Phantom Stopped` e `Results (1)`**, contendo uma linha de perfil `contateste6699`, seguidores `0`, seguindo `0` e `Blocked By Viewer: false`. A captura demonstra que o provedor retornou dados do perfil solicitado.
- Não foi feita auditoria independente da resposta pelo backend do DECOLA INSTA. A consulta de dados públicos, por si só, não comprova que o cookie da sessão seria aceito em ações autenticadas. Não declarar `Instagram connection verified for authenticated actions`.
- Nenhuma evidência de execução de **Instagram Followers Auto Follow**, follow real ou unfollow. A automação original permaneceu inativa nas últimas telas verificadas; não há monitoramento contínuo para garantir estado posterior.
- Como a conta de teste está vazia (0 seguidores e 0 seguindo), essa consulta valida a leitura, mas não o comportamento de follow/unfollow 24/72h.
- Capturas anteriores exibiram parte do `sessionid`; recomendar revogação da sessão exposta e reconexão legítima antes de testes futuros.
- Nenhuma senha, API key, cookie ou resultado pessoal foi armazenado neste documento.

**O que ainda falta:** implementar/testar ingestão de resultados do provedor em escopo de leitura, validar integridade e limites; planejar conscientemente qualquer ação social com aprovação separada, respeitando os termos da plataforma. A consulta de perfil **não é** autorização para mutações.

A parte técnica de follow/unfollow e revisão 24/72h permanece pendente, sem implementação de mutação via PhantomBuster ou agendamento ativo.
