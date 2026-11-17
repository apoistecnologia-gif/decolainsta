# DecolaInsta — checklist para implantar com dados reais

**Estado:** código aprimorado, testes de unidade aprovados; ainda não homologado em produção. Não execute alterações em um banco existente sem backup e revisão do plano Prisma.

## 1. Serviço HTTPS e banco

- Prepare um PostgreSQL exclusivo para o DecolaInsta e guarde a URL de conexão como segredo do servidor. Não reutilize automaticamente bancos de outro projeto.
- Garanta domínio HTTPS para a aplicação Next.js, com persistência de sessão/autenticação.
- Instale dependências em um computador/CI com acesso ao registro npm (`npm install`), preferencialmente gere um lockfile revisado e commitado; execute `npx prisma generate`.
- Configure as variáveis em `.env` local e no gerenciador de segredos do provedor; use `.env.example` como modelo, **sem incluir segredos no GitHub**.
- Execute `npm run preflight` (verifica a *forma* das variáveis; não testa os serviços).

## 2. Banco de dados

- Antes de atualizar um banco existente, faça backup recuperável e compare o schema atual com `prisma/schema.prisma`.
- A versão fornecida não contém histórico de migrações versionadas. Para um banco novo, revise o plano e só depois aplique o schema com `npx prisma db push`.
- Se optar por criar o primeiro administrador de forma explícita, configure `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` (16+ caracteres) temporariamente e execute `npm run db:seed`; remova essas variáveis após a criação. O seed não apaga dados.

## 3. App Meta — Instagram Login

- Crie ou use um aplicativo Meta sob sua administração e habilite **Instagram API with Instagram Login**, com as permissões `instagram_business_basic` e `instagram_business_content_publish`.
- Cadastre exatamente o URI de callback `https://SEU-DOMINIO.com/api/instagram/connect/callback`.
- Configure `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI` e a versão API aprovada pela Meta.
- Teste com uma conta Instagram **profissional** (Criador ou Empresa) com acesso autorizado ao app. Para conectar contas de terceiros, verifique se é necessário **App Review / Advanced Access**, documentação pública e políticas.

## 4. Testes obrigatórios antes de disponibilizar

1. `npm run preflight` sem erros.
2. `npm run typecheck`, `npm run lint`, `npm run test:smoke`, `npm run build` aprovados num ambiente com dependências.
3. Login/logout; tentativa de acessar conta/alerta de outro usuário; cadastro com dados inválidos; backup/restauração.
4. OAuth Instagram real, consulta de seguidores/mídias, token renovado e publicação **autorizada** de uma foto de teste. Conferir no Instagram se a mídia aparece apenas uma vez.
5. Configurar backups, rate limiting de cadastro/login, logs sem tokens/senhas e proteção do domínio.

## 5. Limites funcionais

- Consultar dados de uma conta conectada e publicar imagem autorizada usam a API oficial Meta quando todas as permissões e credenciais estão válidas.
- **Não existe API oficial para fazer follow/unfollow automático de pessoas arbitrárias nem obter listas irrestritas de seguidores.** O motor anterior é apenas laboratório de demonstração; suas estatísticas não refletem crescimento real.
- Não há agendador independente persistente: a publicação no painel é manual, após confirmação; o painel de demonstração exige página aberta.

## 6. Rollback

- Preserve o ZIP original e backup anterior do banco. Para reverter código, restaure a versão anterior; reverta mudanças no banco apenas por migração/backup aprovado, não por exclusão em massa.
- Mantenha `ENCRYPTION_KEY` estável; perder a chave impede recuperar tokens já criptografados.
