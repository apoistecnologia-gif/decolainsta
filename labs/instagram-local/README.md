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

## Fluxo principal: contas de referência (sem nichos obrigatórios)

O produto DecolaInsta deve começar pelo **@ da conta de referência**. Exemplo: um cartomante cadastra o @ de outro cartomante conhecido e pretende alcançar **pessoas que realmente seguem aquela referência**. Esse vínculo precisa ser comprovado; não se pode preencher o banco com usuários aleatórios.

Para cadastrar a referência localmente:

```powershell
npm run refs -- add cartomante_referencia
npm run refs -- list
npm run refs -- inspect cartomante_referencia
npm run refs -- inspect-visible cartomante_referencia
```

O comando `inspect` abre o Chrome local e solicita que você clique **manualmente** na contagem de seguidores da referência. Ele apenas verifica se a janela de seguidores ficou visível ou se há aviso de restrição. **Não lê nem armazena @ de seguidores**, não rola a lista, não interage com eles e não contorna restrições do Instagram. O resultado de `dialog_visible_manual` não significa que a lista completa esteja disponível.

Após confirmar visualmente o diálogo, o comando **`inspect-visible`** pode conferir **até 5 nomes de usuário que estejam visíveis na janela aberta manualmente**, apenas para verificar se o laboratório consegue interpretar corretamente links de perfis. Ele imprime a amostra no terminal, **sem salvá-la**, não clica, não rola a lista e não interage com essas pessoas. Não é um extrator de listas completas. Requer que a janela única de seguidores esteja visível e não haja aviso de restrição. Se aparecerem zero nomes, preserve o print do Chrome e o resultado do terminal para investigar a estrutura atual da interface; não reexecute indefinidamente. A coleta ou interação em escala pode infringir regras da plataforma e não foi implementada.

O cadastro funciona **sem categoria de nicho** e não requer conectar a referência à conta da pessoa que utiliza o DecolaInsta.

**Situação real:** o laboratório consegue cadastrar contas de referência, mas **ainda não consegue recuperar automaticamente a lista de seguidores de uma referência**. A API oficial da Meta não fornece essa relação. Os métodos não oficiais de coleta podem violar os Termos do Instagram, ter limitações de acesso e causar bloqueios; não foram implementados. Cadastrar uma referência não significa que o sistema conhece seus seguidores.

A fila de candidatos da seção abaixo é apenas uma ferramenta auxiliar para usuários fornecidos manualmente e cuja relação com a referência permanece **não verificada**. Ela não substitui a descoberta da audiência real da referência.

## Histórico de verificações das contas de referência

Esta etapa separa a prova de visualização manual das ações de seguir/deixar de seguir. O histórico é **local e independente da Vercel/Neon**, sem ligação com as contas de clientes. Não armazena nomes de terceiros em texto claro.

```powershell
# Usar uma verificação anterior já confirmada (somente CONTAGEM informada pelo usuário)
npm run refs -- note mameto_lueji 5

# Consultar o relatório local
npm run refs -- report mameto_lueji

# Em outra ocasião, conferir uma nova amostra e opcionalmente deduplicar
npm run refs -- inspect-track mameto_lueji

# Apagar o histórico da referência (pede confirmação exata)
npm run refs -- forget mameto_lueji
```

- **`note`** registra somente que você declarou ter conferido de 0 a 5 perfis. Não recupera os @ anteriores, não cria identificadores, não soma seguidores exclusivos e não atribui resultados ao Instagram.
- **`report`** mostra inspeções registradas, datas, quantidade de perfis pseudonimizados vistos em amostras e repetições identificadas em inspeções posteriores. **Não é o número total de seguidores** nem indica quantas pessoas passaram a seguir você.
- **`inspect-track`** mantém a inspeção visual limitada a **cinco perfis por execução**. Você abre manualmente a janela de seguidores, confere a amostra mostrada no terminal e somente depois pode digitar **`REGISTRAR @referencia`**. Se não confirmar exatamente, o programa não registra nada. Não rola, não segue, não manda mensagens, não consulta a API GPT e não grava senhas.
- Ao confirmar, apenas **HMAC-SHA256 dos nomes normalizados** é guardado em `.data/reference-history.json`, com uma chave aleatória local em `.data/reference-history-hmac.key`. O relatório guarda datas, contagens e procedência `manually_opened_dialog_user_confirmed`. Os identificadores são **pseudonimizados, não anonimizados**: mantenha a pasta protegida e não a compartilhe.
- Limite local: **100 visitas** e **500 fingerprints distintos por referência**. Esse limite protege o arquivo local; não autoriza coleta em massa nem substitui as regras do Instagram.
- **`forget`** elimina o histórico da referência selecionada, mas mantém seu cadastro e o segredo HMAC se houver outras referências. Para apagar todos os dados de histórico de uma instalação, feche o laboratório e remova os arquivos `reference-history.json` e `reference-history-hmac.key` de `.data`; isso perde a possibilidade de deduplicação anterior. Não apague `references.json` se quiser preservar as referências cadastradas.

A leitura de até cinco nomes na janela aberta manualmente foi confirmada em teste local, mas o modo **`inspect-track`** ainda requer validação no Chrome. Nenhum histórico anterior foi importado automaticamente. Dados de uma referência não demonstram que uma pessoa irá seguir você ou que houve crescimento provocado por uma interação.

## Fila auxiliar de candidatos manuais (não comprova vínculo com a referência)

A próxima etapa do motor de nichos é uma **fila local de perfis para revisão**, sem coleta automática nem follow em massa. As referências de origem não são verificadas na rede social. Não use listas adquiridas sem permissão ou dados privados de terceiros.

Crie um arquivo CSV UTF-8 (no Bloco de Notas ou Excel) com este formato:

```csv
username;nicho;origem
perfil_teste_a;Espiritualidade;perfil_referencia
perfil_teste_b;Beleza;perfil_referencia
```

Esses nomes são ilustrativos. Informe perfis de teste que você administra ou outros candidatos para revisão manual. A coluna `origem` é opcional e **não** comprova que o candidato acompanha esse perfil. A lista não é coletada do Instagram pelo programa.

No PowerShell, dentro de `labs/instagram-local`:

```powershell
npm run queue -- add perfil_da_segunda_conta "Espiritualidade"
npm run queue -- import "C:/caminho/candidatos.csv" --exclude seu_usuario_de_teste
npm run queue -- list
npm run queue -- next Espiritualidade
npm run queue -- inspect-one Espiritualidade
npm run queue -- sync
```

- `add` cadastra um candidato por vez, sem necessidade de preparar CSV.
- `import` importa perfis, valida nomes e nichos, evita duplicatas e exclui seu próprio usuário quando informado. Não importa credenciais.
- `list` e `next` selecionam perfis **pendentes** por nicho, sem enviar solicitações.
- `inspect-one` abre o Chrome para **inspecionar um único candidato** do nicho. `follow-one` seleciona um único candidato e inicia o laboratório `follow`, que ainda exige confirmação específica digitada; não há ciclos automáticos ou execução em lote. Não use contas de terceiros para testes sem autorização.
- `sync` lê apenas o histórico `results/activity.jsonl` gerado **localmente** e associa resultados de teste `following_confirmed` / `unfollow_confirmed` aos candidatos já cadastrados. É idempotente e ignora registros simulados, ambíguos ou não correspondentes.
- Os dados da fila são armazenados em `.data/candidates.json` e ficam fora do Git. Não os compartilhe publicamente. Nunca coloque a pasta `.session` em arquivos compartilhados.

A fila seleciona no máximo um candidato para o laboratório por execução e **não** roda follows em série, não agenda um motor e não está conectada ao painel da Vercel. Isso prepara a auditoria de cada candidato e a medição sem inventar resultados ou usar listas simuladas.

## Testes

`npm test` verifica as regras de entrada, proibição de lote, checagens de login/desafio e classificação do resultado. Não se confunde com teste real da interface do Instagram. Para validação ponta a ponta é necessário executar o Chrome local e observar a conta diretamente no Instagram.

## Proteção de dados

A pasta `.session` pode conter sessão autenticada: não a copie, sincronize ou envie ao GitHub. Para invalidar o login, desconecte a conta no Instagram e remova a pasta local depois que o Chrome fechar. O comando nunca deve ser exposto como endpoint HTTP sem nova revisão de segurança.
