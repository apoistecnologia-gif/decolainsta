# Inicialização segura do primeiro operador — experimental

O banco existente possui uma conta comum e nenhum administrador, conforme
consulta de 20/11/2026. O seed legado apenas cria um novo administrador e
deliberadamente não promove contas existentes.

O comando isolado `npm run admin:first-operator` permite verificar
**a senha da conta existente**, o email declarado, que existe **exatamente um
usuário**, e que **não existe administrador prévio**.

- Sem `FIRST_OPERATOR_MODE`, executa `check`: **somente leitura**, após
  verificação da senha fornecida em variáveis de ambiente do operador.
- `FIRST_OPERATOR_MODE=apply` precisa também de
  `FIRST_OPERATOR_CONFIRM=AUTHORIZE_VERIFIED_EXISTING_OWNER_AS_FIRST_OPERATOR`.
- `FIRST_OPERATOR_EMAIL` e `FIRST_OPERATOR_PASSWORD` são obrigatórios.
- A rotina bloqueia execução de alteração quando `VERCEL_ENV=production`,
  recusa múltiplos usuários e usa transação serializável, controle de
  concorrência e mudança condicional de `role=user` para `role=admin`.
- Nunca colar a senha neste chat, enviar capturas com credenciais ou
  cadastrar senha no repositório. Não executar por CI nem por Cron.
- **ATENÇÃO:** o Preview pode usar o mesmo banco da produção. Alterar a
  permissão nesse banco, mesmo via CLI fora de produção, também altera o
  acesso nos ambientes que compartilhem o banco. É necessário verificar o
  destino e obter autorização explícita para a alteração antes de executar
  `apply`. Este commit NÃO executa o procedimento.
- Nenhuma nova tela de cliente, endpoint de elevação ou conta padrão foi criada.

A criação e configuração de coletores externos permanece separada da gestão
de usuários. O bootstrap não cria/lança coletores nem executa ações Instagram.
