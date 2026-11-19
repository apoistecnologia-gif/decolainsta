# Integração experimental com API privada do Instagram (NÃO implantada)

**Objetivo:** comprovar a viabilidade técnica de ler seguidores de uma conta de referência e de executar **uma** ação de follow/unfollow em uma **conta de teste**, sob aprovação específica. Esta pasta não integra o runtime atual do Next.js e não é um robô contínuo. Nenhuma implantação, sessão, conta real ou mudança no banco foi feita.

## Conclusão da pesquisa (18 de novembro de 2026)

- A [API oficial da Meta](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/) não disponibiliza uma lista nominal de seguidores de terceiros nem follow/unfollow. O OAuth já conectado no DECOLA INSTA **não autentica o instagrapi**.
- O projeto open-source [instagrapi](https://github.com/subzeroid/instagrapi/blob/master/docs/usage-guide/user.md) fornece métodos privados `user_followers`, `user_follow`, `user_unfollow` e `user_friendship_v1`. Essa integração pode parar de funcionar ou receber checkpoint/bloqueios conforme avaliação do Instagram.
- A leitura e a automação não autorizadas podem violar [os termos do Instagram](https://help.instagram.com/581066165581870). Nunca prometer risco zero, nem recorrer a proxies rotativos, camuflagem ou contornos de desafios.
- O [Averuma](https://averuma.com/) descreve um produto semelhante, mas **roda no computador do cliente** e assume nos termos a possibilidade de bloqueios. O `meuconecta.com.br` não documenta publicamente sua implementação interna.
- A [Railway](https://docs.railway.com/services) oferece serviço Python persistente/cron. Uma eventual implantação no ar **exige conexão/provisão própria**, credenciais protegidas, consentimento e teste com uma conta de teste. Nunca usar GitHub Actions como executor recorrente da conta.

## O que está de fato implementado

- `adapter.py`: adaptador para instagrapi, disponível apenas se configurado em processo **isolado**; lê um máximo pequeno de usuários, identifica relacionamentos e admite uma única ação por chamada.
- `cli.py`: sem credenciais, desativado. Exige opt-in explícito e alvo de teste específico; por padrão não faz requisições.
- `tests/test_private_adapter.py`: testes com dublês, sem rede e sem contas reais.
- **Não está implementado**: execução contínua, coleta completa de seguidores, seleção automática, tratamento de consentimento por cliente, armazenamento de sessões criptografado em banco, filas transacionais, antifalhas de duplicidade, cron de follows/unfollows, integração com o painel do usuário e teste de login real.

## Segurança e limites para um futuro piloto autorizado

1. Criar uma conta de teste administrada pelo proprietário e informar os segredos diretamente ao cofre do ambiente (nunca em chat, GitHub, logs ou JSON do frontend).
2. Fazer avaliação de risco dos Termos antes de usar instagrapi. Contas já conectadas via OAuth oficial precisam de **autenticação separada** e isso amplia a superfície de risco.
3. Implantar *worker* isolado na nuvem, com kill switch desligado por padrão. Armazenar sessão em volume criptografado, nunca em /tmp no Vercel, nem no repositório.
4. Validar **somente leitura limitada**, em conta de referência visível e com permissão apropriada. Se o Instagram recusar a lista, parar. Não tratar vazios como sucesso.
5. Validar **uma única ação específica previamente autorizada**, sem loop ou sistema de tentativas. Parar em `challenge_required`, `429`, `feedback_required` ou `login_required`; não contornar restrições.
6. Apenas após o piloto, desenhar uma fila transacional persistente na Neon com deduplicação por conta/alvo, janela de revisão de 24/72h, lista de proteção, auditoria de confirmação, retenção mínima e descarte de dados de terceiros. **Nova migração exigiria revisão e autorização.**
7. Decidir implantação de produção separadamente, após comparar impacto, custos e requisitos de uso da plataforma.

## Execução local de testes unitários (opcional, não precisa de Instagram)

```bash
python -m unittest discover -s experimental/private-instagram-worker/tests -v
```

## CLI de diagnóstico — não executar sem consentimento de conta de teste

Requer Python 3.12+, `pip install -r experimental/private-instagram-worker/requirements.txt`, segredos no cofre do worker e `PRIVATE_API_RESEARCH_APPROVED=yes`. `python experimental/private-instagram-worker/cli.py probe` consulta apenas a quantidade de resultados retornados da referência (máximo 5 perfis, sem divulgar usuários). Outros comandos exigem um segundo opt-in `PRIVATE_API_SINGLE_ACTION_APPROVED=yes` e `PRIVATE_API_APPROVED_TARGET` igual exatamente ao destino. Isso não constitui implantação de autopilot.

O DECOLA INSTA original continua em modo manual/simulado, independente deste protótipo.

## Serviço passivo preparado para Railway

Os arquivos `Dockerfile`, `railway.json` e `health_service.py` preparam um serviço Docker isolado. Ele escuta `GET /health`, devolve apenas `ready` e os estados `disabled`, não possui rota de escrita e **não inicia o login no Instagram**. O CLI experimental de pesquisa é independente do processo de saúde.

Para implantar **apenas o serviço passivo**, use um novo serviço Railway com origem no repositório `apoistecnologia-gif/decolainsta`, branch `experiment/local-instagram-one-action-20261118` e **Root Directory** `/experimental/private-instagram-worker`. Se exigir Config File Path separado, use `/experimental/private-instagram-worker/railway.json`, conforme [documentação de monorepo](https://docs.railway.com/deployments/monorepo).

Verifique o healthcheck `/health` e **não adicione domínio público** ao serviço: não existe interface do cliente nele. O contêiner permanece ativo e poderá gerar cobrança de infraestrutura; não o deixe rodando sem necessidade. A aplicação Next.js permanece na Vercel, o banco continua na Neon e não há sincronização entre o serviço passivo e o DECOLA INSTA.

A instalação da integração Railway no ChatGPT, por si só, não cria serviço ou deploy. Este commit **não cria qualquer recurso da Railway nem altera segredos**. Um piloto privado autenticado e qualquer execução real exigem avaliação e autorização específicas.

## Teste pontual de login (não ativado automaticamente)

O arquivo `login_once.py` não é usado no start do serviço. Somente uma intervenção
temporária em `preDeployCommand` com `PRIVATE_API_LOGIN_ONCE_APPROVED=yes python login_once.py`
executa a chamada `Client(with_challenge_flow=False).login(...)`. Os resultados
possíveis são rótulos fixos, sem mensagens, stack traces, senhas ou IDs do Instagram.

O comando faz **uma invocação** da rotina de login da biblioteca (que pode
internamente fazer várias requisições de autenticação). Não lê seguidores,
não verifica perfis e não executa follows/unfollows. Não persiste sessão.
Caso haja challenge, 2FA, restrição ou erro, não tenta superar a proteção.
Remova `preDeployCommand` imediatamente após inspecionar o resultado,
antes de qualquer implantação futura. Nunca deixe esse comando ativo como
migração permanente.

## Diagnóstico offline após falha não classificada

O primeiro teste de autenticação na Railway retornou apenas `STOPPED_OTHER_ERROR`.
O usuário não viu nenhum desafio no aplicativo do Instagram, mas isso não confirma
que a autenticação tenha sido aceita. Nenhum login adicional foi autorizado.
O tratamento de exceções agora separa erros de dependência, transporte e
execução, sempre por nomes de categorias estáticas e sem mensagens da biblioteca.

O GitHub Actions valida em contêiner isolado, com `--network none` e sem segredos,
a construção do cliente real `Client(with_challenge_flow=False)` e a existência
do método `login()`. Isso NÃO tenta autenticar uma conta nem usar a API do Instagram.
O comando temporário de pré-deploy foi removido da Railway após o teste inicial;
o serviço passivo mantém o código anteriormente implantado até nova decisão.


## Investigação forense do login — 2026-11-19

- Serviço Railway: ambiente `piloto` e execução sem domínio público.
- Versão instalada durante os incidentes: `instagrapi==3.2.6` (lançada em novembro de 2026).
- Tentativa anterior do deploy `815f39cf`: apenas `STOPPED_OTHER_ERROR`, sem detalhes.
- Deploys `a918dd73` e `b2f39e99`: status saudável, **sem diagnóstico registrado**. Não é correto afirmar que houve login.
- Deploy `46a04503`: resultado **`STOPPED_PLATFORM_RESTRICTION`** registrado em `2026-11-19T12:15:02.824Z`. Fluxos de rede mostraram saída HTTPS na janela de execução. Isto confirma que o diagnóstico atingiu um erro classificado pela biblioteca como limitação da plataforma, mas **não identifica seu tipo exato**.
- O usuário confirmou que a conta funciona no aplicativo oficial; isto não significa necessariamente que a API privada esteja autorizada ou acessível.
- A classe `STOPPED_PLATFORM_RESTRICTION` agregava quatro erros: `PleaseWaitFewMinutes`, `FeedbackRequired`, `ClientThrottledError` (HTTP 429) ou `RateLimitError`. Não há exceção bruta preservada. Não inferir qual ocorreu.
- **Fator provável, não comprovado:** `login_once.py` constrói um `Client()` novo por execução e não lê/grava settings de sessão. O pacote recomenda evitar logins novos repetidos, pois têm maiores chances de acionar controles de abuso. O piloto roda no datacenter Railway e não compartilha o contexto de sessão do aplicativo oficial.
- A versão mais recente da biblioteca na investigação foi `3.2.19` (2026-11-19), e a `3.2.16` melhorou diagnósticos de login CAA. Isso **não prova** que uma atualização removeria limitações do Instagram; não há atualização automática.
- **Correção implementada na branch experimental:** mapear cada uma das quatro exceções a um rótulo distinto e fixo, sem salvar ou imprimir conteúdo do erro, corpo de resposta, endereço IP, identificadores ou segredo. Testado apenas com erros simulados, **sem novo login**.
- A política segura permanece: não retentar automaticamente, não solucionar desafios por robô, não girar IPs, não ativar coleta, follow ou unfollow. Um resultado de limite deve suspender o piloto e exigir avaliação humana.

Documentação de base:
- [instagrapi 3.2.0 — Exceptions](https://subzeroid.github.io/instagrapi/3.2.0/exceptions/)
- [instagrapi — Best Practices / Sessions](https://subzeroid.github.io/instagrapi/latest/usage-guide/best-practices/)
- [instagrapi 3.2.19 — Changelog](https://github.com/subzeroid/instagrapi/blob/3.2.19/CHANGELOG.md)

**Sem implantar o diagnóstico novo na Railway**: o serviço continua passivo, e qualquer nova tentativa de login exige autorização nova.

## Atualização não evasiva do cliente — 2026-11-19

Versão Python do protótipo atualizada de `instagrapi 3.2.6` para a release verificada `3.2.19`. Não modifica a identidade de rede, não instala proxy, não altera impressão digital TLS nem tenta contornar challenges. A versão 3.2.16 incluiu melhorias para preservar contexto de falhas CAA; isto **não** significa que esta conta possa se autenticar. O diagnóstico individual agora acrescenta somente códigos HTTP numéricos permitidos (400, 401, 403, 408, 429, 500, 502, 503), sem conteúdo de resposta. Os testes usam dublês e contêiner sem rede. Não habilitar retries e não usar outras contas para testar o mesmo limite.
