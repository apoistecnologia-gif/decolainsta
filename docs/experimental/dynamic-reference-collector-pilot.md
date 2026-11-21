# Coleta dinâmica de referências (piloto Preview)

## Objetivo de produto
O cliente cadastra somente o @ das referências no DECOLA INSTA.
Nenhuma URL deve ser copiada manualmente no PhantomBuster para cada nova
referência. Um único agente **Instagram Follower Collector** já autenticado
é usado sequencialmente.

## Contrato real do provedor
PhantomBuster v2 `POST /agents/launch` suporta `bonusArgument`, que se
mescla com a configuração salva apenas para a execução atual;
`saveArgument: false` preserva a URL e o cookie salvos. Para o
Instagram Follower Collector configurado com URL direta no campo
`spreadsheetUrl`, usamos
`bonusArgument: { spreadsheetUrl: "https://www.instagram.com/<referencia>/" }`.
`maxInstanceCount: 1` evita instâncias simultâneas pelo provedor.

Referências:
- https://hub.phantombuster.com/reference/post_agents-launch
- https://support.phantombuster.com/hc/en-us/articles/32398521107986-How-to-launch-a-Phantom-via-API

## Implementação
- `lib/providers/phantombuster-dynamic-reference.ts`: valida agente
  do tipo correto, verifica cookie cadastrado sem expô-lo, monta
  substituição temporária, lança pelo endpoint oficial e lê apenas
  o contêiner específico da resposta.
- `lib/reference-dynamic-collection.ts`: estado durável por
  referência e registro de tentativa incerta.
- `app/api/operator/phantombuster/dynamic-references/route.ts`:
  restringe ao operador, branch Preview, conta profissional piloto,
  URL gerada no servidor a partir da referência cadastrada. Reserva
  com lock transacional global do PostgreSQL para impedir duplicações.
  Uma resposta incerta não será repetida automaticamente.
- `app/(app)/references/_components/dynamic-collector-control.tsx`:
  botão único para iniciar o piloto, que continua consultando e
  avançando sequencialmente enquanto a aba permanecer aberta.
- Quando o contêiner finalizado devolve `userCustomMetadata`
  contendo o mesmo identificador da tentativa, e sua entrada
  não diverge da referência esperada, lemos somente
  `containers/fetch-result-object?id=<container-id>`, gravamos
  as amostras na estrutura de histórico existente e chamamos
  a indexação de candidatos.

## Limites honestos
Este piloto está ligado somente à conta Instagram do operador
associada à sessão já configurada no PhantomBuster. Ele NÃO deve
usar a sessão de um cliente para agir em outras contas. A integração
oficial da Meta não concede cookie do Instagram ao PhantomBuster.

Sem prova de origem por contêiner, os resultados não são atribuídos
a uma referência e nenhum novo follow é disparado. Um login
confirmado pelo PhantomBuster não garante coleta bem-sucedida.
Uma lista de seguidores observada não demonstra que essas pessoas
seguirão a conta do operador.

Não alteramos produção, não criamos novos agentes, não trocamos
configuração permanente nem ativamos follow/unfollow. A flag
`PHANTOMBUSTER_DYNAMIC_COLLECTION_ENABLED=yes` é estritamente
Preview da branch experimental e apenas libera o clique explícito
do operador. Não há execução de agentes em background no servidor:
o avanço automático ocorre enquanto o painel estiver aberto.
