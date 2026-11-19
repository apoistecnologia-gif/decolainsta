# Integração experimental com API privada do Instagram (NÃO implantada)

**Objetivo:** comprovar a viabilidade técnica de ler seguidores de uma conta de referência e de executar **uma** ação de follow/unfollow em uma **conta de teste**, sob aprovação específica. Esta pasta não integra o runtime atual do Next.js e não é um robô contínuo. Nenhuma implantação, sessão, conta real ou mudança no banco foi feita.

## Conclusão da pesquisa (18 de novembro de 2026)

- A [API oficial da Meta](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/) não disponibiliza uma lista nominal de seguidores de terceiros nem follow/unfollow. O OAuth já conectado no DECOLA INSTA **não autentica o instagrapi**.
- O projeto open-source [instagrapi](https://github.com/subzeroid/instagrapi/blob/master/docs/usage-guide/user.md) fornece métodos privados `user_followers`, `user_follow`, `user_unfollow` e `user_friendship_v1`. Essa integração pode parar de funcionar ou receber checkpoint/bloqueios conforme avaliação do Instagram.
- A leitura e a automação não autorizadas podem violar [os termos do Instagram](https://help.instagram.com/581066165581870). Nunca prometer risco zero, nem recorrer a proxies rotativos, camuflagem ou contornos de desafios.
- O [Averuma](https://averuma.com/) descreve um produto semelhante, mas **roda no computador do cliente** e assume nos termos a possibilidade de bloqueios. O `meuconecta.com.br` não documenta publicamente sua implementação interna.
- A [Railway](https://docs.railway.com/services) oferece serviço Python persistente/cron. Uma eventual implantação no ar **exige conexão/provisão própria**, credenciais protegidas, consentimento e teste com uma conta de teste. Nunca usar GitHub Actions como executor recorrente da conta.

## O que está de fato implementado

- `adapter.py`: adaptador para instagrapi, disponível apenas se configurado em processo **isolado**; lê um máximo pequeno de usuários, identifica relacionamentos e admite uma única ação por chamada.
- `cli.py`: sem credenciais, desativado. Exige opt-in explícito e alvo de teste específico; por padrão não faz requisições.
- `tests/test_private_adapter.py`: testes com dublês, sem rede e sem contas reais.
- **Não está implementado**: execução contínua, coleta completa de seguidores, seleção automática, tratamento de consentimento por cliente, armazenamento de sessões criptografado em banco, filas transacionais, antifalhas de duplicidade, cron de follows/unfollows, integração com o painel do usuário e teste de login real.

## Segurança e limites para um futuro piloto autorizado

1. Criar uma conta de teste administrada pelo proprietário e informar os segredos diretamente ao cofre do ambiente (nunca em chat, GitHub, logs ou JSON do frontend).
2. Fazer avaliação de risco dos Termos antes de usar instagrapi. Contas já conectadas via OAuth oficial precisam de **autenticação separada** e isso amplia a superfície de risco.
3. Implantar *worker* isolado na nuvem, com kill switch desligado por padrão. Armazenar sessão em volume criptografado, nunca em /tmp no Vercel, nem no repositório.
4. Validar **somente leitura limitada**, em conta de referência visível e com permissão apropriada. Se o Instagram recusar a lista, parar. Não tratar vazios como sucesso.
5. Validar **uma única ação específica previamente autorizada**, sem loop ou sistema de tentativas. Parar em `challenge_required`, `429`, `feedback_required` ou `login_required`; não contornar restrições.
6. Apenas após o piloto, desenhar uma fila transacional persistente na Neon com deduplicação por conta/alvo, janela de revisão de 24/72h, lista de proteção, auditoria de confirmação, retenção mínima e descarte de dados de terceiros. **Nova migração exigiria revisão e autorização.**
7. Decidir implantação de produção separadamente, após comparar impacto, custos e requisitos de uso da plataforma.

## Execução local de testes unitários (opcional, não precisa de Instagram)

```bash
python -m unittest discover -s experimental/private-instagram-worker/tests -v
```

## CLI de diagnóstico — não executar sem consentimento de conta de teste

Requer Python 3.12+, `pip install -r experimental/private-instagram-worker/requirements.txt`, segredos no cofre do worker e `PRIVATE_API_RESEARCH_APPROVED=yes`. `python experimental/private-instagram-worker/cli.py probe` consulta apenas a quantidade de resultados retornados da referência (máximo 5 perfis, sem divulgar usuários). Outros comandos exigem um segundo opt-in `PRIVATE_API_SINGLE_ACTION_APPROVED=yes` e `PRIVATE_API_APPROVED_TARGET` igual exatamente ao destino. Isso não constitui implantação de autopilot.

O DECOLA INSTA original continua em modo manual/simulado, independente deste protótipo.
