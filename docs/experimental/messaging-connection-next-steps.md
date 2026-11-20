# DECOLA INSTA — Integração de mensagens e proteção de unfollow (2026-11-20)

Status: código preparado na branch experimental; execução e acesso externo DESATIVADOS.

## Meta — implementação concluída no código, não ativada

1. Fluxo separado de Instagram Business Login: autorização explícita, cookie HTTP-only de estado aleatório e callback vinculado ao usuário autenticado.
2. OAuth em api.instagram.com, troca de token de 60 dias em graph.instagram.com, confirmação de ID e username e token criptografado em uma tabela distinta do token Business Login já existente.
3. Endpoint de webhook assinado com HMAC-SHA256, verifica desafio e captura apenas IDs de remetentes de mensagens realmente recebidas. Nunca guarda texto das mensagens.
4. Consulta oficial somente de IGSIDs pertencentes a contatos registrados por webhook e à mesma conta do titular. Registra o primeiro instante de confirmação, não inventa a data de quando o follow começou.
5. Unfollow SEMPRE bloqueado: os IDs de mensagens não foram correlacionados com usernames da whitelist e nenhuma ação de unfollow está habilitada.

## Variáveis novas (somente Vercel Preview)

- INSTAGRAM_MESSAGING_INTEGRATION_ENABLED=yes (desativada por padrão)
- INSTAGRAM_MESSAGING_APP_ID — ID do Instagram Business Login, não reutilizar o ID Business Integration
- INSTAGRAM_MESSAGING_APP_SECRET — segredo da integração de Instagram Login
- INSTAGRAM_MESSAGING_REDIRECT_URI — HTTPS fixo terminado em /api/instagram/messaging/callback
- INSTAGRAM_MESSAGING_WEBHOOK_VERIFY_TOKEN — segredo aleatório independente
- INSTAGRAM_MESSAGING_WEBHOOK_APP_SECRET — Meta App Secret usado para assinatura HMAC

Não colocar nenhum desses segredos em mensagens, repositório GitHub, logs ou navegador.

## Migração preparada, NÃO aplicada

Arquivo: prisma/migrations/20261120_instagram_messaging_prepared/migration.sql
Cria somente InstagramMessagingConnection e InstagramMessagingContact.
Deve ser revisada e aplicada apenas em Neon branch isolada/Preview, mediante autorização e backup.
Não aplicar à produção. O endpoint retorna 403 quando a flag estiver desativada.

## Integração Meta pendente

- Conta Instagram profissional para teste e app Meta com Instagram Login.
- Permissões instagram_business_basic e instagram_business_manage_messages.
- App Review/acesso avançado para contas de clientes não ligadas à equipe do app.
- URL HTTPS estável para o callback e para /api/instagram/messaging/webhook, alcançável pela Meta (proteger os demais caminhos de Preview).
- Validação do evento recebido com mensagem de usuário que iniciou conversa; não enviar DMs não solicitadas.
- Testes de revogação, expiração de token e renovação antes de uso contínuo.

## PhantomBuster pendente

- Inspeção read-only do agente Auto Unfollow existente, quando e se houver Agent ID fornecido e vinculado.
- PHANTOMBUSTER_SOCIAL_PILOT_UNFOLLOW_AGENT_ID deve identificar um agente existente, nunca gerado automaticamente.
- O validador exige um perfil por lançamento, agendamento manual, tipo correto e a opção Unfollow only if they don't follow you declarada no manifesto com o valor salvo.
- Nenhum agente foi criado, lançado ou agendado; nenhuma solicitação pendente pode ser incluída num unfollow.
- ready-for-review é apenas conclusão de preflight, NÃO autorização de ação.

## Referências externas

https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile
https://support.phantombuster.com/hc/en-us/articles/26971120423570-How-to-Use-the-Instagram-Auto-Unfollow
