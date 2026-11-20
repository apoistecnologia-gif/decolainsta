# Cron de leitura do Preview — isolado, sem Instagram

Este contêiner usa **apenas a biblioteca padrão Python** para emitir uma
solicitação `GET` ao endpoint existente e protegido do **Preview**:
`/api/cron/refresh-reference-audiences`.

O serviço deve ser criado **separadamente** do worker passivo de laboratório,
sem as credenciais privadas usadas nesse worker.

### Agendamento no Railway
- Ambiente: `piloto`
- Branch: `experiment/local-instagram-one-action-20261118`
- Root directory: `/experimental/preview-audience-scheduler`
- Dockerfile: `Dockerfile`, comando padrão do contêiner
- Cron UTC: `*/30 * * * *` (tenta a cada 30 minutos)
- Não expor domínio ou rota HTTP.
- Nunca configure `sleepApplication` neste cron; processo termina após uma consulta.

### Configuração obrigatória, somente no serviço cron
- `PREVIEW_READONLY_CRON_ENABLED=yes` — opt-in separado, desativado por padrão
- `PREVIEW_REFRESH_URL=https://<alias-fixo-do-branch-Preview>/api/cron/refresh-reference-audiences`
- `PREVIEW_CRON_SECRET` — igual ao `CRON_SECRET` armazenado SOMENTE no Vercel Preview
- `PREVIEW_PROTECTION_BYPASS` — segredo de acesso aos deployments Vercel protegidos

Não coloque segredos no GitHub, no chat, em imagens ou em logs. O token de
proteção apenas vence a barreira do deployment; `CRON_SECRET` é a autorização
independente da rota. O worker confere o **host exato** do Preview e não aceita
redirecionamentos.

### Sem leituras adicionais durante o cooldown
A cada cron, a rota protegida consulta o registro de tentativas no Neon e
faz **0 novas leituras externas** até completar o mínimo de 6 horas; quando
elegível, lê no máximo 3 resultados **já concluídos**, nunca inicia
coletores ou interage com o Instagram. A atualização do índice pode registrar
novos nomes no banco compartilhado; só ativar com ciência desse efeito.

A execução NÃO cria nem agenda lançamentos no PhantomBuster. Sem novos
resultados finalizados no provedor, poderá retornar `unchanged`, `no-run` ou
`historical-only`; isso não é erro da agenda.

### Como validar
1. GitHub CI: `python -m unittest discover -s experimental/preview-audience-scheduler/tests -v`.
2. GitHub CI: Docker build do worker isolado.
3. Railway: consultar `cron runs` do serviço e confirmar saída `ok: examined=0`
   (ou contagem até 3), sem imprimir informações privadas.
4. Neon: verificar somente estado/status da última leitura;
   nenhuma ação Instagram e nenhum serviço passivo alterado.
