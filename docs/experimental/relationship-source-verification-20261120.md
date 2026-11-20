# Fontes confiáveis para verificar relacionamentos — decisão técnica
Data: 2026-11-20 · Branch experimental · Somente Preview · Sem ações reais

## Mutirão: comparação das fontes

| Fonte | Follow individual da conta | Follow-back individual | Pedido pendente | Condições |
| --- | --- | --- | --- | --- |
| Meta Instagram Graph API empresarial atual | Não | Não | Não | `followers_count` e `follows_count` são apenas totais |
| Meta Instagram Login / Messaging User Profile API | Sim (`is_business_follow_user`) | Sim (`is_user_follow_business`) | Não distingue pedido pendente de ausência | Apenas pessoa que consentiu e enviou mensagem/interagiu via messaging; IGSID do webhook; permissão `instagram_business_manage_messages`; conta profissional; Meta App Review para terceiros |
| PhantomBuster Auto Follow | Reporta operação, não prova aprovação de solicitação | Não é confirmação independente | Resultado de perfil privado pode ser solicitação | Sessão delegada ao provedor |
| PhantomBuster Auto Unfollow | Verificação operacional opcional: "Unfollow only if they don't follow you" | Provedor verifica pela sessão | Não valida timestamp de follow de forma independente | Agente não criado nem ativado; exigiria autorização específica |
| Exportação pelo titular (Accounts Center) | Lista de contas seguidas no instante da exportação | Comparação com seguidores no arquivo | Alguns pacotes incluem pedidos enviados; disponibilidade variável | Prova de snapshot cedido pelo titular, não consulta contínua e não autenticada criptograficamente pela API |

## Bloqueio concreto da integração atual

O código `lib/instagram/meta.ts` usa `graph.facebook.com`, OAuth empresarial
com `INSTAGRAM_CONFIG_ID` e token Business Integration System User.
A verificação oficial por mensagem exige **outro fluxo** de Instagram
Login em `graph.instagram.com`, token específico, permissão de mensagens,
consentimento do usuário e IGSID recebido de webhook.
Não reutilizar o token empresarial atual, nem tentar obter perfis arbitrários.

A pessoa `@dellmyra_souza` não está demonstrada como remetente de DM
consentida; a tentativa original permanece **requested** e não é verificável
por esse endpoint com os dados atuais.

## Código preparado, sem ativação

`lib/instagram/messaging-relationship-verification.ts` fornece cliente GET
read-only do endpoint oficial, protege host e IGSID, valida consentimento
e vínculo com conta, limita a resposta, não expõe tokens e rejeita fluxo OAuth
incorreto. Com resultado booleano oficial, o adaptador distingue seguir,
seguir de volta, e estado sem follow confirmado (pedido pendente ainda possível).
Há teste de transição após 48 horas com whitelist, followback e autorização.

**Ainda não está integrado à rota pública**: falta OAuth com Instagram Login,
permissões de mensagens aprovadas, webhook válido e identificação consentida
de cada interlocutor. Nada foi solicitado, criado ou ativado.
Não usar dados de outros clientes nem falso consentimento.

## Próximas decisões operacionais

1. Para interlocutores que enviam mensagem e autorizam uso da informação,
   considerar implementação separada de OAuth + webhook após App Review.
2. Para outros perfis, comparar snapshots exportados pelo próprio titular,
   deixando claro que não são verificação automática ao vivo, ou aceitar
   verificação operacional do provedor com riscos e cobertura parcial.
3. Não há, nas fontes verificadas, um endpoint oficial para verificar
   arbitrariamente follow/pedido/follow-back de qualquer username.
   Sem essa fonte universal, automação irrestrita é tecnicamente inviável
   com as garantias exigidas.
4. Não criar agentes de unfollow sem consentimento específico; não executar
   ações reais no Instagram; não tocar em produção.

Fontes:
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/v21.0/
- https://support.phantombuster.com/hc/en-us/articles/26971120423570-How-to-Use-the-Instagram-Auto-Unfollow
- https://support.phantombuster.com/hc/en-us/articles/26971112664722-How-to-Use-the-Instagram-Followers-Auto-Follow
