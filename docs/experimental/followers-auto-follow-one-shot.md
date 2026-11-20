# Teste de execução única do Followers Auto Follow — Preview

O agente já existente "Instagram Followers Auto Follow.js" (ID opaco
configurado no Preview) usa a referência @mameto_lueji para escolher UM
seguidor. A conta Instagram declarada pelo titular é @contateste6699.

ATENÇÃO: a sessão utilizada é um cookie privado do Instagram no PhantomBuster.
O identificador de sessão NÃO prova por API qual conta a utiliza. A interface
exige confirmação explícita do titular antes de uma eventual execução.

## Operação autorizável, não automática

Endpoint `/api/operator/followers-auto-follow-run`:
- GET: diagnóstico e estado do registro, sem chamada ao provedor;
- POST `launch-one`: exige administração, mesmo Origin, conta e referência
  próprias, confirmação explícita do titular, Preview, e flag adicional
  `PHANTOMBUSTER_FOLLOWERS_ONE_SHOT_ENABLED=yes`.
- Revalida agent script, referência, modo manual e 1 perfil com GET da API.
- Antes de qualquer lançamento, reserva uma ÚNICA tentativa no banco,
  com transação serializável e advisory lock. No POST remoto usa apenas
  `{id,manualLaunch:true,maxInstanceCount:1}`, sem argumentos/cookies.
- Timeout, erros e respostas ambíguas NÃO geram nova tentativa.
- POST `check-result`: consulta somente o contêiner identificado pelo
  resultado anterior, sem retentar lançamento ou usar a coleta de referência.

Dados armazenados: referência, agente, ID do contêiner (se conhecido),
status, data, provas negativas `followConfirmed:false` e
`recipientKnown:false`. Nenhuma lista de seguidores, sessão ou senha
é persistida pelo módulo.

Um contêiner com `exitCode=0` só confirma que o código encerrou
sem erro; não prova que o perfil de teste efetivamente seguiu alguém.
É preciso verificar os resultados específicos da automação e o
estado real da conta antes de atualizar estatísticas.

A flag adicional permanece AUSENTE. Nenhuma execução real foi feita.
A produção não recebe variáveis ou rotas ativas. Unfollow permanece
desabilitado. O agendador de importação da audiência é independente.

**Limitação operacional:** o agente Followers Auto Follow seleciona o
destinatário sozinho. Como não sabemos o alvo antecipadamente, não é
possível assegurar que ele não esteja na whitelist do DECOLA INSTA.
O primeiro teste real exige essa ciência por parte do titular e é
irreplicável automaticamente.
