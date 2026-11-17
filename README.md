# DecolaInsta — integração oficial Instagram

Projeto Next.js/React com área autenticada, várias contas profissionais conectadas por Instagram Login, consulta de dados de perfil e publicações e publicação de imagem autorizada pela Meta. O laboratório de seguir/deixar de seguir é **100% simulado** e não representa ações reais.

## Requisitos

- Node.js >= 20.9, npm ou Yarn
- Banco PostgreSQL acessível (ver `.env.example`)
- App Meta com produto Instagram Login habilitado, Instagram App ID e secret
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

1. Crie/configure um app da Meta e habilite *Instagram API with Instagram Login*.
2. Cadastre a URI de redirecionamento exatamente igual à `INSTAGRAM_REDIRECT_URI`.
3. Configure as permissões `instagram_business_basic` e `instagram_business_content_publish`. Para contas de terceiros, pode ser necessário **App Review / Advanced Access** e políticas de privacidade válidas.
4. Faça login em `/login` ou cadastre-se em `/signup`, vá para **Contas Instagram → Conectar Instagram** e autorize uma conta profissional.
5. Em **Instagram real** do perfil, use **Sincronizar agora** e confira o número de seguidores e os posts. Use URL pública de imagem JPEG compatível para publicar após confirmação.

**Não é necessário nem seguro informar a senha do Instagram ao DecolaInsta.** Contas cadastradas pelo método antigo precisam ser reconectadas pelo OAuth. Tokens de contas conectadas são armazenados com AES-256-GCM usando `ENCRYPTION_KEY`.

## Limites

A API oficial de Instagram não fornece operações para seguir/deixar de seguir usuários arbitrários nem a coleta irrestrita de seguidores de outras contas. O antigo motor permanece em **modo demo**; ligar/desligar seu estado no painel não produz ações reais. Resultados do laboratório não são métricas do Instagram. O aplicativo também **não executa tarefas continuamente no servidor por conta própria**. As publicações reais são feitas manualmente no painel.

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
