# DECOLA INSTA — teste de uma ação real, isolado, bloqueado por padrão

Esta etapa prepara uma **única tentativa real de follow** por conta de teste,
com a API pública do PhantomBuster. Não reutiliza o coletor da referência
como automação social e não altera o worker de login privado já bloqueado por 429.

API da Meta não executa seguir/deixar de seguir. Esta integração exige
PhantomBuster Instagram Auto Follow previamente configurado manualmente:
- destino exato: **um** perfil individual, presente no índice de candidatos da
  referência ligada à conta de teste;
- modo de lançamento `manually`; limite explícito de **um** perfil por
  execução; sem listas externas, planilhas, muitos destinatários ou repetição;
- sessão legítima da **conta de teste**, conectada pelo próprio titular;
- configuração do agente validada novamente antes de qualquer tentativa.

A rota administrativa `/api/operator/social-pilot` exige `VERCEL_ENV=preview`,
sessão de administrador, origem de mesma origem e confirmação explícita.
A implantação não define a flag de ativação. **Não aconteceu ação real**.

Variáveis de **Preview somente**, ainda ausentes:
- `PHANTOMBUSTER_SOCIAL_PILOT_ENABLED=yes`
- `PHANTOMBUSTER_SOCIAL_PILOT_ACCOUNT` — username de uma conta teste, ligada
  à conta DECOLA INSTA via Meta e confirmada pelo operador
- `PHANTOMBUSTER_SOCIAL_PILOT_REFERENCE` — referência desta conta
- `PHANTOMBUSTER_SOCIAL_PILOT_TARGET` — apenas um candidato já indexado;
  diferente da conta/referência e não presente na whitelist
- `PHANTOMBUSTER_SOCIAL_PILOT_FOLLOW_AGENT_ID` — ID numérico de um agente
  existente, tipo `Instagram Auto Follow.js`, configurado só para o candidato
- `PHANTOMBUSTER_API_KEY` — já no cofre do Preview

O endpoint `GET` mostra pendências sem expor IDs, configurações ou segredos.
Após confirmação expressa no painel oculto `/references/diagnostics`,
o endpoint `POST` guarda uma reivindicação serializável. Qualquer timeout,
resposta ambígua ou falha **bloqueia repetição automática**. Um lançamento
aceito retorna `followConfirmed:false`, e jamais grava follow fictício.

**Unfollow automático NÃO está habilitado nesta etapa.** A política de avaliação
de 48h já está testada, mas só fica elegível após prova independente de follow
bem-sucedido, verificação de que o alvo *não* seguiu de volta e ausência de
whitelist. O resultado da execução do Follow não deve ser confundido com uma
solicitação de lançamento. A configuração exata e segura do agente Unfollow
precisa ser validada contra a API real antes de qualquer mutação.

Referências oficiais:
- https://support.phantombuster.com/hc/en-us/articles/26971108136722-How-to-Use-the-Instagram-Auto-Follow
- https://support.phantombuster.com/hc/en-us/articles/26971120423570-How-to-Use-the-Instagram-Auto-Unfollow
- https://support.phantombuster.com/hc/en-us/articles/32398521107986-How-to-launch-a-Phantom-via-API

Mesmo com limites baixos, automações não oficiais podem causar bloqueios.
Não instalar retries agressivos, proxies rotativos ou evadir checkpoints.
