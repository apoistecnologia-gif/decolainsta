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

## Investigar confirmação de unfollow (sem executar unfollow)

Se a opção final de **Deixar de seguir** não for localizada pelo laboratório, não repita a ação às cegas. Primeiro confira manualmente se o perfil ainda mostra **Seguindo**. Para investigar o menu sem acionar o unfollow, execute:

```powershell
npm run inspect-menu -- nome_do_perfil
```

Com a conta de teste conectada, clique **manualmente apenas em Seguindo** no Chrome, sem selecionar **Deixar de seguir**. Pressione Enter no PowerShell. O programa informa se o Instagram abriu um diálogo/menu e quais controles de seguir/deixar de seguir encontrou, sem imprimir dados privados da página. Tire uma captura da janela do Chrome com esse menu aberto e só depois pressione Enter novamente para fechar a janela. Isso serve para adaptar a seleção ao formato observado da interface, evitando cliques incertos.

## Testes

`npm test` verifica as regras de entrada, proibição de lote, checagens de login/desafio e classificação do resultado. Não se confunde com teste real da interface do Instagram. Para validação ponta a ponta é necessário executar o Chrome local e observar a conta diretamente no Instagram.

## Proteção de dados

A pasta `.session` pode conter sessão autenticada: não a copie, sincronize ou envie ao GitHub. Para invalidar o login, desconecte a conta no Instagram e remova a pasta local depois que o Chrome fechar. O comando nunca deve ser exposto como endpoint HTTP sem nova revisão de segurança.
