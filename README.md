# Mapa 2.0 · Logística de equipamentos

Projeto independente, criado a partir da versão 2.7 aprovada do painel. Este repositório contém somente código, documentação e configurações genéricas. Os dados reais e as credenciais permanecem na instalação local privada.

Painel privado para cadastrar plantas, operações e equipamentos em uma base compartilhada.
Os dados ficam no servidor, em SQLite; as plantas e fotos ficam em arquivos privados.
O HTML contém somente a interface, sem inventário ou imagens reais embutidos.

A interface usa a direção Mapa em foco escolhida pelo proprietário: cabeçalho compacto, mapa em toda a área de trabalho e cartão flutuante para consultar o equipamento. A edição só abre quando solicitada. Consulte as decisões e referências em [IDENTIDADE_UI.md](docs/IDENTIDADE_UI.md).

Na versão 2.3, ferramentas, filtros, inventário e ações de conta ficam em menus. O cadastro destaca os campos essenciais e reúne as outras informações em seções. As melhorias de processamento e transferência estão descritas em [DESEMPENHO.md](docs/DESEMPENHO.md). Esta revisão está em validação local; consulte `design-qa.md` para as verificações realizadas e pendentes.

A versão 2.4 coloca os equipamentos no fluxo principal: clique no marcador ou no resultado da busca para abrir o cadastro. Marcadores próximos se agrupam em uma lista de seleção; a operação é um filtro opcional. Fechar o cadastro mantém o contexto da consulta. Veja [FLUXO_EQUIPAMENTOS.md](docs/FLUXO_EQUIPAMENTOS.md).

A versão 2.5 separa consulta e edição. A aba Equipamentos abre a lista; selecionar um equipamento apresenta seu resumo. Localizar destaca sua posição e Editar equipamento abre os campos existentes. Filtros e ferramentas permanecem recolhidos. A revisão aguarda aprovação antes de commit e envio ao GitHub.

A revisão 2.6 ajusta o espaço em janelas intermediárias: resumo compacto, ações do mapa na mesma faixa e alternância entre lista, consulta e edição. Equipamentos podem ser cadastrados com ou sem operação vinculada. Abrir um equipamento não altera seus vínculos. Consulte [UX_2.6.md](docs/UX_2.6.md) e a validação atual em `design-qa.md`.

## Começar no Windows

A revisão 2.7 organiza a navegação em Mapa, Equipamentos e Operações, com painel lateral recolhível para planta, listas e filtros. O equipamento continua acessível diretamente no mapa ou na busca, com vínculo opcional à operação. A referência enviada pelo proprietário orienta a estrutura lateral; dados e plantas permanecem no servidor privado. Veja [UX_2.7.md](docs/UX_2.7.md).

Requer [Node.js 24 ou superior](https://nodejs.org/en/download). Não há pacotes externos para instalar.

No localhost, o painel entra automaticamente como `local`, sem senha. Para exigir login também neste computador, inicie com a variável `MAP_LOCAL_ACCESS=0`. Quando `MAP_PUBLIC_ORIGIN` está configurada, o login é sempre obrigatório. O servidor continua escutando apenas em `127.0.0.1`.

Para configurar contas quando o login for necessário:

1. Abra `Configurar_Acesso.cmd` para criar sua conta do painel. Escolha um nome e uma senha com pelo menos 12 caracteres; a senha não aparece enquanto você digita.
2. Repita a configuração para criar uma conta individual para seu colega.
3. Abra `Abrir_Painel.cmd` e mantenha a janela aberta durante o uso.
4. Acesse `http://127.0.0.1:4173` no navegador e entre com a conta criada.

As contas do painel são próprias desta aplicação e não usam a senha do GitHub.
Uma instalação nova começa com quatro unidades vazias. Se existirem arquivos de migração em `private/`, o primeiro acesso ao banco os importa automaticamente.

Alternativa pelo terminal, dentro da pasta do projeto:

```sh
node scripts/admin.mjs create-user seu.usuario
node scripts/build.mjs
node scripts/serve.mjs
```

## Salvar e trabalhar em equipe

Após confirmar uma edição no formulário, o painel salva automaticamente no servidor e mostra o resultado no topo. O botão **Salvar no servidor** confirma o salvamento das alterações pendentes.
Espere aparecer **Salvo no servidor** antes de fechar. Em caso de falha, suas edições continuam abertas e o painel informa o problema.

As sessões consultam novas versões a cada 15 segundos quando não há edição pendente. Se duas pessoas tentarem salvar a mesma revisão, a segunda gravação é recusada para preservar a primeira. Faça um backup da edição pendente antes de carregar a versão do servidor e reaplicar sua mudança.

Para compartilhar os mesmos dados, vocês precisam acessar a **mesma instalação do servidor**.
Clonar o repositório em dois computadores cria duas instalações independentes. A hospedagem compartilhada precisa ser definida e configurada conforme [HOSPEDAGEM.md](docs/HOSPEDAGEM.md).

## Encontrar e editar equipamentos

A busca da planta selecionada aceita códigos de operação e equipamento, nomes, áreas e dados técnicos como IP, número de série e hostname. Acentos e o hífen do código são opcionais. Os resultados de equipamentos permitem abrir diretamente o cadastro; os demais filtros continuam aplicados.

Os campos mais usados ficam à vista. Expanda **Dados técnicos e localização** ou **Aparência e posição no mapa** para consultar e editar os demais campos. Os valores existentes continuam preservados ao salvar com essas seções fechadas.

Ao criar uma operação, erros de nome vazio ou duplicado aparecem no próprio formulário. A criação válida salva a operação sem uma segunda confirmação. Exclusões continuam pedindo confirmação.

Na visão geral de plantas com pelo menos 40 operações e zoom abaixo de 150%, o mapa mostra códigos compactos. Passe o ponteiro ou dê foco ao marcador para ler o nome completo. Os indicadores identificam se a contagem corresponde a todas as plantas ou à planta selecionada.

Consulte o teste e seus limites em [USABILIDADE.md](docs/USABILIDADE.md).

## Dados, imagens e backup

- `private/state.sqlite`: inventário, revisão, contas e registro de gravações no servidor.
- `private/assets/`: plantas e fotos, acessíveis pela aplicação após login.
- `private/inventory.json` e `private/maps.json`: arquivos para a importação inicial; não substituem um banco existente.
- `dist/index.html`: interface gerada, sem dados reais. Abrir esse HTML por dois cliques não abre a base de dados.

**Backup privado** gera um JSON com os dados e as imagens da sessão. Guarde o arquivo em local protegido. A importação pelo painel permite recuperar esse backup, sujeita à autenticação e ao controle de revisões. O backup da sessão não inclui contas ou senhas.

Para uma cópia completa da instalação, pare o serviço e copie a pasta `private/` inteira para armazenamento protegido. Isso inclui o banco, eventuais arquivos WAL/SHM e as imagens. Teste a restauração em uma instalação separada. O GitHub contém o código, não o backup do inventário.

## Desenvolvimento e validação

```sh
node scripts/build.mjs
node --test scripts/*.test.mjs
```

Também estão disponíveis `npm start`, `npm run check` e `npm test` em instalações padrão do Node.js com npm.
Consulte [VALIDACAO.md](docs/VALIDACAO.md), [MIGRACAO.md](docs/MIGRACAO.md) e [SEGURANCA.md](docs/SEGURANCA.md).

Cada atualização concluída deve gerar um commit e ser enviada ao GitHub, conforme `AGENTS.md`.
A pasta `private/`, credenciais, backups e distribuições geradas ficam fora do versionamento, inclusive quando o repositório é privado.
