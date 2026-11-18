# DecolaInsta — laboratório local de uma ação real

**Experimental, separado do aplicativo hospedado na Vercel.** Este protótipo permite inspecionar um perfil e, sob confirmação explícita, tentar exatamente **uma ação de follow ou unfollow** usando uma janela visível do Chrome e o login no próprio Instagram. A ação é considerada confirmada somente se a interface apresentar o estado esperado. Não há garantia de funcionamento: a interface do Instagram muda, pode exigir verificações e a conta pode sofrer restrições.

## Limites importantes

- Não usa a API oficial da Meta para seguir; ela não oferece tal recurso.
- Não é o motor de crescimento por nicho, nem um bot de seguidores em massa. Descoberta de seguidores, agendamento e integração com Vercel permanecem pendentes.
- Não coleta senhas no DecolaInsta; o usuário digita credenciais diretamente no navegador do Instagram. O perfil local do navegador **guarda cookies/sessões** em `.session/` e precisa ficar protegido. Nunca compartilhe essa pasta.
- Não usa proxies, captcha bypass, espera adaptativa para evitar detecção, coleta de listas de seguidores ou retentativas de ações incertas.
- Uma experiência sem bloqueio **não** prova que o método é aprovado pelo Instagram. Acesso automatizado sem permissão pode violar os Termos de Uso e causar bloqueios.
- Recomendado somente para uma conta sua de teste, direcionada a uma segunda conta sua de teste, sem interagir com pessoas externas involuntariamente.
- Os relatórios `results/activity.jsonl` não contêm tokens. O valor `unverified` indica que **não** foi possível comprovar a operação; não tente novamente automaticamente.

## Preparar (Windows, Node 22+, Chrome instalado)

No terminal, na raiz do repositório:

```powershell
cd labs/instagram-local
npm install
npm test
```

Inspecionar um perfil sem clicar em Seguir:

```powershell
npm run inspect -- @nome_da_sua_segunda_conta
```

Teste de uma ação: somente após compreender os riscos e fazer login na janela do Instagram com a conta de teste:

```powershell
npm run follow -- @nome_da_sua_segunda_conta
```

A execução pede confirmação digitada e clica no máximo uma vez. Para testar desfazer a ação, rode separadamente `npm run unfollow -- @nome_da_sua_segunda_conta` e confirme.

## Testes

`npm test` verifica as regras de entrada, proibição de lote, checagens de login/desafio e classificação do resultado. Não se confunde com teste real da interface do Instagram. Para validação ponta a ponta é necessário executar o Chrome local e observar a conta diretamente no Instagram.

## Proteção de dados

A pasta `.session` pode conter sessão autenticada: não a copie, sincronize ou envie ao GitHub. Para invalidar o login, desconecte a conta no Instagram e remova a pasta local depois que o Chrome fechar. O comando nunca deve ser exposto como endpoint HTTP sem nova revisão de segurança.
