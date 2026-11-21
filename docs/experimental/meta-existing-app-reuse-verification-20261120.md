# DECOLA INSTA — Auditoria de reaproveitamento do aplicativo Meta

Data: 20/11/2026. Branch experimental. Sem ativação de novas permissões.

## Verificado no código e nas configurações da Vercel

- O projeto existente usa o fluxo Meta **Instagram API with Unified Login / Facebook Login for Business**.
- \`lib/instagram/meta.ts\` gera autorização em \`https://www.facebook.com/<version>/dialog/oauth\` com \`config_id\`.
- O token retornado é **Business Integration System User** e o Graph host é \`graph.facebook.com\`.
- Na Vercel há \`INSTAGRAM_APP_ID\`, \`INSTAGRAM_APP_SECRET\`, \`INSTAGRAM_CONFIG_ID\` para Preview e Produção. Isso comprova cadastro, não comprova permissões aprovadas ou conexão bem-sucedida de uma conta.
- NÃO há \`INSTAGRAM_MESSAGING_APP_ID\`, \`INSTAGRAM_MESSAGING_APP_SECRET\` nem configuração de webhook de mensagens.
- A conta de teste anterior está cadastrada no banco, mas não se comprovou token OAuth Meta associado a ela.
- O acesso ao dashboard da Meta não está disponível no contexto desta conversa; portanto ainda NÃO sabemos se o app existente possui o produto Instagram habilitado e quais permissões estão aprovadas.

## Documentação atual

- A Meta permite adicionar o novo produto **Instagram** a aplicativos existentes, sem criar obrigatoriamente outro aplicativo.
- A alternativa Messenger Platform / Instagram com **Facebook Login** oferece leitura de perfil de remetentes elegíveis com identificadores IGSID, **token de Página** e permissões correspondentes. Não reutilizar o Business Integration System User token como token de Página.
- Em ambas as alternativas, essa leitura só cobre contatos elegíveis que interagiram com o negócio; não oferece consulta arbitrária à lista de seguidores.

## Código adicionado

- \`lib/instagram/facebook-messaging-relationship.ts\` — adaptador exclusivamente GET para \`graph.facebook.com/v27.0/<IGSID>\`, exige token de Página, conta e página vinculadas, e origem de webhook assinado; retorna apenas booleanos, sem dados brutos.
- Testes cobrem incompatibilidade de token atual, falta de consentimento, divergência de IDs, retorno de perfil, falhas e ambiguidade do pedido de follow.
- Nenhum endpoint novo foi habilitado para executar essa alternativa com tokens de clientes; o adaptador permanece isolado até confirmação das permissões e identificação segura da Página e de mensagens recebidas.

## Próxima ação externa necessária

Abrir \`https://developers.facebook.com/apps/\`, selecionar o aplicativo Meta **já usado** pelo DECOLA INSTA, e verificar:

1. Se o caso de uso *Manage messaging & content on Instagram* / produto Instagram está habilitado para esse app;
2. Se o dashboard oferece *API setup with Instagram Login* ou a configuração unificada;
3. Quais permissões **instagram_manage_messages** (Facebook Login) ou **instagram_business_manage_messages** (Instagram Login) foram concedidas/aprovadas;
4. Quais callbacks e webhooks podem ser cadastrados sem alterar o login empresarial existente.

Somente depois dessa verificação escolher o caminho mais simples. Não solicitar ou copiar App Secret no chat.

Referências:
- https://developers.facebook.com/docs/instagram/platform/instagram-api/changelog/
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
- https://developers.facebook.com/documentation/business-messaging/instagram-messaging/changelog/
