# Autorização administrativa e verificação de capacidade (Preview)

## Ativação segura
Na conta autenticada, abrir /references/diagnostics no Preview.
Se existir apenas uma conta e nenhum administrador, aparece a seção
"Habilitar o primeiro administrador". A pessoa precisa informar sua
própria senha atual e confirmar a mudança de permissão. A senha vai
diretamente ao servidor por HTTPS; não é salva no navegador ou no banco.

O servidor revalida os requisitos em transação serializável:
a conta da sessão, exatamente um usuário, nenhum administrador,
senha atual via bcrypt e atualização condicional da função.
O sistema nunca eleva usuários automaticamente. Pode afetar a
produção caso os ambientes compartilhem o mesmo banco.

## Capacidade
Após a ativação, /references/diagnostics mostra a consulta somente leitura
GET /orgs/fetch-resources e GET /agents/fetch-all?withArgument=false.

A resposta exibe somente número de agentes e métricas numéricas
explicitamente presentes em campos relacionados a slots.
Não infere vagas restantes pela quantidade de agentes; um modelo
pode consumir fatores diferentes de slots. Em caso de retorno sem
campos reconhecidos, o resultado é explicitamente inconclusivo.

Nenhuma chamada a /agents/save, /agents/launch ou ao Instagram
é executada durante verificação de capacidade. A criação de rascunhos
continua bloqueada pela variável de opt-in do operador.
