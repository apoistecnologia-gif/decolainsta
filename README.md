# DecolaInsta — integração oficial Instagram

Projeto Next.js/React com área autenticada, várias contas profissionais conectadas por login unificado da Meta, consulta de dados de perfil e publicações e publicação de imagem autorizada pela Meta. O laboratório de seguir/deixar de seguir é **100% simulado** e não representa ações reais.

## Requisitos

- Node.js >= 20.9, npm ou Yarn
- Banco PostgreSQL acessível (ver `.env.example`)
- App Meta com Instagram Unified Login habilitado, App ID, secret e configuration ID
- Conta Instagram profissional (Empresa ou Criador) permitida no app da Meta
- Domínio HTTPS e URI de redirecionamento idêntica à cadastrada na Meta

## Primeira instalação

1. Faça backup do banco existente se for atualizar uma instalação anterior.
2. Execute `npm install` (ou o gerenciador escolhido no seu ambiente).
3. Copie `.env.example` para `.env` e configure todos os segredos; `ENCRYPTION_KEY` e `AUTH_SECRET` devem ser diferentes.
4. Com acesso ao banco: `npx prisma generate` e `npx prisma db push`. **Revise as alterações previstas pelo Prisma antes de aplicá-las em produção.** O projeto original não continha migrações SQL versionadas.
5. Execute `npm run preflight` para conferir variáveis sem imprimir segredos. Depois execute `npm run typecheck`, `npm run lint`, `npm run test:smoke` e `npm run build`.
6. Use `npm run dev` para desenvolver ou `npm run start` após compilar.
7. Registre o endereço `https://SEU-DOMINIO.com/api/instagram/connect/callback` entre os redirect URIs da Meta.

## Configuração no painel Meta

1. Crie/configure um app da Meta e habilite *Instagram Unified Login*.
2. Cadastre a URI de redirecionamento exatamente igual à `INSTAGRAM_REDIRECT_URI`.
3. Configure o login unificado (Business Login), o portfólio empresarial, o `INSTAGRAM_CONFIG_ID` e as permissões da configuração, conforme a Meta. Para contas de terceiros, pode ser necessário **App Review / Advanced Access** e políticas de privacidade válidas.
4. Faça login em `/login` ou cadastre-se em `/signup`, vá para **Contas Instagram → Conectar Instagram** e autorize uma conta profissional.
5. Em **Instagram real** do perfil, use **Sincronizar agora** e confira o número de seguidores e os posts. Use URL pública de imagem JPEG compatível para publicar após confirmação.

**Não é necessário nem seguro informar a senha do Instagram ao DecolaInsta.** Contas cadastradas pelo método antigo precisam ser reconectadas pelo OAuth. Tokens de contas conectadas são armazenados com AES-256-GCM usando `ENCRYPTION_KEY`.

## Limites

A API oficial de Instagram não fornece operações para seguir/deixar de seguir usuários arbitrários nem a coleta irrestrita de seguidores de outras contas. A automação não oficial de follow/unfollow pode violar termos de uso e causar limitações ou suspensão de contas. O antigo motor permanece em **modo demo**; ligar/desligar seu estado no painel não produz ações reais. Resultados do laboratório não são métricas do Instagram. A sincronização de contas profissionais pode registrar uma observação real da contagem de seguidores e sua variação desde a leitura anterior, sem atribuição causal. O aplicativo também **não executa tarefas continuamente no servidor por conta própria**. As publicações reais são feitas manualmente no painel.

## Provas de crescimento real e testes

O endpoint de sincronização do Instagram registra `followers_snapshot` com fonte `meta_official_api` quando recebe `followers_count` válido. A primeira leitura sem base anterior não gera delta. Diferença de contagem não comprova que novos seguidores vieram de alguma ação específica. O laboratório segue exclusivamente fictício, e sua API declara `realFollows: 0` e `realUnfollows: 0`. Não houve desenvolvimento ou ativação de automação real de seguir/deixar de seguir.

## Assistente com GPT para contas de referência (experimental)

O painel de cada conta Instagram oferece **Analisar com IA** nas contas de referência cadastradas. Essa ferramenta utiliza a **Responses API** da OpenAI para gerar hipóteses de interesse de público e sugestões de conteúdo original a partir de uma biografia pública ou descrição **digitada voluntariamente** pelo usuário.

**Importante:** o GPT não recebe nem descobre listas de seguidores do Instagram. Esse recurso NÃO faz scraping, não identifica quem segue uma referência e não executa ações de seguir/deixar de seguir, comentários ou mensagens. Toda análise é explicitamente rotulada como hipótese baseada nos dados fornecidos, e não resultado verificado.

A integração fica **desativada por padrão** até configurar **somente no servidor** as variáveis de ambiente:

- `DECOLAINSTA_AI_ENABLED=true`
- `OPENAI_API_KEY` = chave privada da OpenAI Platform no cofre de variáveis de ambiente, nunca em `NEXT_PUBLIC_*` ou no Git.
- `OPENAI_MODEL=gpt-4.1-mini` (padrão configurável, sujeito a disponibilidade/preços da sua conta).

São aplicados limites básicos de até **3 tentativas por conta Instagram e 10 por usuário em 24 h**, incluindo tentativas que falharem na API. Antes de disponibilizar a muitos usuários, configure também limites persistentes com garantia de concorrência e orçamento da OpenAI Platform. O corpo enviado à OpenAI contém apenas @ da referência e os textos públicos/objetivos informados, nunca cookies, tokens Meta ou senhas. As análises não ficam armazenadas no banco; a auditoria salva somente metadados sem os textos digitados.

O fluxo GPT não foi validado com uma chamada paga real enquanto não houver chave de API configurada. Testes de contrato, validação e build não equivalem a resposta real do modelo.

## Requisito de produto: público de contas de referência

No fluxo originalmente solicitado pelo usuário, quem usa o DecolaInsta cadastra um **@ de conta referência** (por exemplo, um cartomante com audiência estabelecida), e o público pretendido são **as pessoas que realmente seguem esse @**, não perfis sugeridos apenas por um nicho. O nicho pode ser metadado opcional, nunca o critério obrigatório de origem.

A branch experimental contém `labs/instagram-local/references-cli.mjs`, com `npm run refs -- add conta` e `npm run refs -- list`. O cadastro é local e não valida a relação entre seguidores e referência.

**Bloqueio técnico ainda não resolvido:** a API oficial da Meta não retorna a lista de seguidores de terceiros. Não existe no projeto um coletor real desses seguidores nem uma garantia de acesso por meios não oficiais. Acesso/coleta automatizada não autorizada pode violar os Termos do Instagram e resultar em restrições. A fila CSV opcional não deve ser vendida como coleta automática nem conter seguidores inventados.

## Laboratório experimental de follow/unfollow (isolado, NÃO publicado)

Em `labs/instagram-local/` existe um protótipo **local e separado** do painel da Vercel: abre o Chrome, exige login diretamente no Instagram e confirmação no terminal para tentar **uma única** ação de seguir ou deixar de seguir em uma conta de teste. O resultado só é registrado como confirmado quando uma mudança visível na interface puder ser observada. **Não** acessa listas de seguidores, escolhe pessoas por nicho, trabalha em lote ou executa tarefas em segundo plano; não deve ser interpretado como motor de crescimento funcional. Leia `labs/instagram-local/README.md` antes de instalar. O login oficial Meta conectado ao site não substitui a sessão desse navegador local. Não rode em contas de clientes. A automação não oficial pode infringir os Termos de Uso do Instagram e ocasionar restrições.

## Revisões de prontidão antes de publicar

`npm run preflight` identifica variáveis ausentes/inválidas, mas **não configura recursos por conta própria**. A integração somente estará apta depois de registrar o aplicativo Meta, confirmar domínio HTTPS, preparar PostgreSQL com backup e verificar permissões reais de uma conta profissional. Coloque rate limiting/anti-bot na borda do domínio antes de liberar cadastro público.

O publicador confirma o status `FINISHED` do contêiner na API da Meta antes de emitir uma única requisição de publicação. Se a imagem ainda estiver em processamento, ele retorna erro em vez de declarar sucesso. Não reenvie imediatamente uma publicação se houve erro de rede após a confirmação: confira o perfil antes para não duplicar conteúdo.

## Segurança / produção

- Não suba `.env` ou `.env.local`, segredos, tokens, `node_modules` ou dumps de banco no GitHub.
- `scripts/seed.ts` não cria administrador com senha fixa; conta admin apenas com variáveis explícitas e senha forte.
- Não reutilize uma `ENCRYPTION_KEY` antiga para tentar descriptografar os registros legados, que usavam formato inseguro. Depois de backup e reconexão, avalie eliminar credenciais legadas (`encryptedPassword`, `sessionData`, `proxyUrl`) com migração aprovada, não automática.
- Configure backups, HTTPS, rate limiting na borda, monitoramento e proteção antiabuso antes de abrir cadastro público.
- Se o token expirar ou for revogado, reconecte o perfil pelo fluxo oficial.

## Estado de testes

`npm run test:smoke` executa testes isolados para criptografia, validação, URLs, OAuth e requisições Meta simuladas com `fetch` mockado. Não equivale a App Review nem teste de API real. Ver `RELATORIO-EXECUCAO.md` para escopo e limitações verificadas nesta entrega.

## Fontes oficiais

- [Instagram Platform](https://developers.facebook.com/docs/instagram-platform/)
- [Workspace oficial da Meta no Postman](https://www.postman.com/meta/instagram/overview)
