# DECOLA INSTA — Decisão técnica de autenticação e provedor externo
Data da pesquisa: 2026-11-19
Status: plano verificado em documentação pública; nenhum provedor externo conectado ou autorizado

## Objetivo original

Operar a partir de seguidores de perfis de referência cadastrados no DECOLA INSTA; registrar follows reais efetuados, observar follow-back e avaliar unfollow aproximadamente 24 ou 72 horas depois, preservando whitelist e sem exigir computador ligado continuamente.

**Não confundir** com publicação de posts, curtir conteúdo, métricas simuladas ou fluxo manual previamente construído.

## Evidência do bloqueio atual

- Railway, ambiente `piloto`, deployment `206884e2-ad30-4673-80df-eaaf6738dc18`.
- `instagrapi==3.2.19`, diagnóstico com no máximo uma chamada `Client.login()` pelo código do piloto.
- Resultado real observado: `STOPPED_PLEASE_WAIT_FEW_MINUTES_HTTP_429`.
- Usuário confirmou conta de teste funcionando no app oficial; não confirma que API privada aceite login.
- OAuth oficial Meta não oferece follow/unfollow arbitrário nem a lista nominal completa de seguidores de terceiros.
- **Não repetir login para escapar de 429**, nem usar proxies rotativos, fingerprint spoofing, CAPTCHA/challenge bypass, cookies extraídos de terceiros ou senhas no frontend.

## Alternativa concreta encontrada: PhantomBuster

A PhantomBuster disponibiliza documentação sobre automações exatas:
1. [Instagram Followers Auto Follow](https://support.phantombuster.com/hc/en-us/articles/26971112664722-How-to-Use-the-Instagram-Followers-Auto-Follow), aceitando uma URL de perfil de referência e conexão de sessão Instagram por extensão.
2. [Instagram Auto Follow](https://support.phantombuster.com/hc/en-us/articles/26971108136722-How-to-Use-the-Instagram-Auto-Follow) para lista específica, que inclui a operação "Unfollow only if they don't follow you".
3. [Instagram Auto Unfollow](https://support.phantombuster.com/hc/en-us/articles/26971120423570-How-to-Use-the-Instagram-Auto-Unfollow), aceita URLs e opção "Unfollow only if they don't follow you".
4. [PhantomBuster API — launch](https://support.phantombuster.com/hc/en-us/articles/32398521107986-How-to-launch-a-Phantom-via-API), API v2 `POST /api/v2/agents/launch` com `id` do Phantom e chave da Workspace.
5. [Encadear Phantoms via API](https://support.phantombuster.com/hc/en-us/articles/32590719953554-How-to-chain-Phantoms-via-API), recuperar arquivos de resultado antes de iniciar próximo agente.
6. [Conectar conta com a extensão](https://support.phantombuster.com/hc/en-us/articles/360007071719-How-Account-Connections-Work-in-PhantomBuster), mediante sessão existente no navegador, sem enviar senha ao provedor.
7. [Limites e restrições](https://support.phantombuster.com/hc/en-us/articles/360017014479-PhantomBuster-Rate-Limits-Daily-Limits-by-Platform-and-Phantom).
8. [Planos, slots e API](https://support.phantombuster.com/hc/en-us/articles/4494623647250-What-Each-PhantomBuster-Plan-Includes-Features-Limits-and-Pricing).

**Atenção**: esses são recursos comercializados e documentados pelo próprio provedor, não testes realizados com a conta do usuário. A documentação não prova que a conta específica conseguirá operar. Sessões podem expirar, exigir reconexão e estar sujeitas a verificação/limites; para certos perfis Instagram Web mostra somente os 50 seguidores mais recentes.

**A conexão da extensão entrega uma sessão autenticada ao terceiro**. Ela é equivalente a conceder acesso à conta enquanto válida; não equivale ao OAuth oficial Meta com permissões restritas. Exige avaliação consciente do usuário e leitura da política de privacidade. Não coletar/exibir cookie nem chave do provedor no ChatGPT, GitHub, logs ou banco do app.

## Como validar apenas autenticação (sem nenhuma ação social)

1. Usuário cria sua própria conta/workspace no provedor e usa navegador Chrome/Firefox com **conta de teste** já autenticada no site Instagram.
2. Usuário instala somente a extensão **oficial** seguindo a página do provedor, revê permissões e conecta a sessão à workspace na página do provedor; nenhuma senha/cookie enviada ao DECOLA INSTA.
3. No painel do provedor, confirmar **Connected** e escolher um agente somente de leitura para validar autenticação, sem iniciar ferramenta de follow/unfollow.
4. Se a sessão expirar, exigir reconexão manual. Se houver challenge, HTTP 429, 2FA ou restrição, **parar**. Não desabilitar 2FA da conta como solução para o piloto.
5. Registrar somente conexão: `provider: "phantombuster"`, `status: disconnected|connected|reconnect_required|restricted`, data observada e identificador opaco do Agent, sem token/cookie.
6. Separadamente, avaliar termos e risco antes de habilitar qualquer mutação real.

## Integração proposta — somente depois de autenticação autorizada comprovada

```
Painel DECOLA INSTA (Next.js na Vercel)
  -> usuário configura referência e políticas; acompanha resultados verificáveis
Neon PostgreSQL (nova fila proposta; migração NÃO autorizada)
  -> reference_target(account_id, username, enabled)
  -> provider_agent_config(account_id, provider, collector_agent_id, follow_agent_id, unfollow_agent_id)
  -> provider_action(account_id, target_id, kind, status, provider_run_id, occurred_at, due_at, result)
  -> protected_account(account_id, target_id) / whitelist existente
Worker Railway separado (não motor atual)
  -> clientes API PhantomBuster usando chave do cofre Railway
  -> consultar resultado confirmado, correlacionar perfil e verificar duplicatas
  -> somente com opt-in explícito, agendar avaliação 24/72 horas após follow real
  -> se houver followback ou whitelist, preservar perfil
  -> respeitar limites e parar em falhas, restrições ou sessão inválida
PhantomBuster (sessão existente no navegador conectada pelo titular)
  -> operações documentadas no âmbito da conta de teste
```

### Requisitos de implementação (não entregues por esse documento)

- Controle por conta isolada; idempotência `(account_id, target_id, action_kind, generation)`.
- **Nada** de cron automático só por conexão, nem usar credenciais já guardadas da API privada para esse serviço.
- Provedor exige Phantom configurado e validado no seu próprio dashboard e Agent ID conhecido; sem workspace de usuário não há teste real da integração.
- Sem acesso à credencial da sessão de navegador por backend próprio; guardar no Railway somente a **chave de API de workspace PhantomBuster** no cofre, preferencialmente sealed.
- Usar `/agents/launch` no ambiente correto, status/container ID e resultados para reconciliar execução. Não marcar follow como confirmado apenas porque API retornou execução enfileirada. Não duplicar se status pendente/desconhecido.
- A janela de 24/72 horas deve usar o horário real da ação confirmada, não o horário de importação nem a hora de tentativa.
- Nunca fazer unfollow ao detectar follow-back ou perfil na whitelist. Condição "unfollow only if they don't follow you" disponível no Auto Unfollow do provedor, sujeita à confiabilidade do dado que ele retornar.
- Lista de seguidores da referência pode ser parcial (limitação explícita de ~50 em algumas contas) e instável.
- Estudar consumo de tempo/slots/API, política de uso do Instagram, risco de terceiros controlando sessão, retenção de identificadores e revogação; nenhum serviço garante segurança de conta.

## Comparação com outros caminhos

| Caminho | Autenticação | Follow/unfollow | Observação |
|---|---|---|---|
| API Meta OAuth | oficial | não | melhor conformidade, não executa o objetivo |
| instagrapi na Railway | sessão privada nova por senha | suportado na biblioteca, mas login não autenticou | HTTP 429 comprovado; interrompido |
| PhantomBuster via extensão/sessão existente | utiliza sessão do navegador conectada à plataforma do provedor | ferramentas publicamente documentadas | alternativa para **piloto sem mutação** após consentimento; não garante êxito |
| Extensão local | navegador autenticado | algumas oferecem ações | requer navegador/dispositivo do usuário e não satisfaz por si só 24/72h em nuvem |

## Decisão e portões de autorização

1. **Concluído:** pesquisa pública, diagnóstico Railway e documentação deste plano.
2. **Pendente — ação do titular:** abrir workspace PhantomBuster e conectar *somente* conta de teste por extensão, após aceitar conscientemente a delegação de sessão.
3. **Pendente — teste isolado:** confirmar leitura simples da sessão na própria UI do provedor sem nenhuma ação Instagram.
4. **Pendente — integração de código:** criar API client testado com mocks; não executar lançamentos sem dados/consentimento.
5. **Pendente — ativação limitada:** requer aprovação separada, verificação da disponibilidade do recurso, análise de risco e testes em conta de teste antes de ações sociais.

Railway existente permanece passiva; produção Vercel/Neon e branch main não são alteradas por este documento.
