# Design QA — Navegação lateral 2.7

Validação complementar local de 19/10/2026: [correção da exibição e ancoragem de operações](docs/CORRECAO_OPERACOES.md). Foram conferidas as camadas de operações/equipamentos e a âncora em 100% e 150% de zoom. O relatório abaixo preserva a comparação visual da navegação lateral.

15/10/2026. Implementação local baseada na imagem enviada pelo proprietário; sem commit ou envio ao GitHub.

## Referência e comparação

Fonte visual: C:/Users/OLIVEI~1/AppData/Local/Temp/codex-clipboard-2d48da4d-2d57-4852-be27-fc97353c5f15.png, 841 × 600 pixels. O recorte referencia-app.png remove exclusivamente os 72 px de interface do navegador, produzindo 841 × 528 pixels de aplicação. Nenhuma imagem foi esticada ou reescalada.

Implementação: ../ux-2.7/referencia-size.png, captura de 841 × 528 pixels, viewport solicitado de 841 × 528 CSS px. A inspeção DOM arredonda a largura fracionária para 842; a dimensão real do bitmap foi validada antes da composição. comparacao.png contém fonte e implementação juntas; comparacao-lateral.png mostra os recortes focados da navegação/painel com a mesma escala de pixels.

Estado: sessão autenticada, Mapa ativo, painel Explorar planta aberto, filtros fechados, sem consulta selecionada e zoom de 100%. A referência está vazia, enquanto a implementação usa a planta e os 37 equipamentos fictícios existentes. O pedido foi usar a imagem como base para as opções laterais: a área clara do mapa, os dados de demonstração, o cabeçalho e a consulta existentes foram preservados deliberadamente. Não se declara reprodução integral nem correspondência entre conteúdo vazio e preenchido.

A estrutura lateral segue a fonte: navegação vertical, seção ativa violeta, painel contextual grafite, seleção de planta, busca/lista de operações, filtros inferiores e ajuda. Larguras maiores são adaptação explícita para legibilidade: rail de 64 px, painel de 240 px ou 216 px até 1050 px; a fonte tem aproximadamente 52 e 166 px.

Outras evidências: desktop.png em 1440 × 900; janela-801.png em 801 × 884; mobile.png, mobile-consulta.png e mobile-edicao.png para viewport solicitado de 390 × 844 (bitmaps de cerca de 390 × 843/844 por arredondamento da captura); filtros-841.png documenta o painel de filtros corrigido. Nenhuma captura usa dados corporativos.

## Achados e iterações

| Prioridade inicial | Evidência/problema | Correção e resultado |
| --- | --- | --- |
| P1 | Redimensionar a janela chamava renderEditor e podia sobrescrever um rascunho. | Callback agora atualiza somente navegação, resumo e geometria; teste de regressão reproduziu a falha e passou após o ajuste. |
| P1 | Painel móvel herdava a coluna 2 da grade desktop: x373,6 e largura32,8 em tela390. | Painel e backdrop absolutos usam a grade inteira. Nova medição: painel x0/largura300, backdrop x0/largura390,4; seleção móvel confirmada e capturas substituídas. |
| P2 | Ajuda tinha círculo preto e legenda duplicada por estilos antigos. | Ícone sem preenchimento com traço atual e remoção do pseudo-elemento de legenda apenas no rail. Conferido na comparação final. |
| P2 | Filtro herdava min-width210 e criava rolagem horizontal numa lateral estreita. | min-width0 no painel interno; scrollWidth176 igual clientWidth176, rolagem somente vertical. filtros-841.png atualizado. |
| P2 | Resumo horizontal na janela801 deixava vínculo em coluna estreita e ilegível com painel aberto. | Entre701 e1050, detalhes e ações ocupam linhas próprias quando a lateral está aberta. Campo de operação medido com301 px; resumo200 px alto; conferido em janela-801.png. |
| P2 | Recolher tinha alvo pequeno. | Alvo mínimo de44 px; disponível em desktop e celular. |

A primeira composição completa revelou o problema de Ajuda; a revisão posterior em celular e na janela de uso revelou os problemas de grade, filtros e resumo. Todas as correções foram recapturadas e inspecionadas. A comparação final completa e os recortes da lateral foram abertos juntos. Não restam achados P0/P1/P2 acionáveis no escopo e nos estados avaliados.

## Superfícies de fidelidade

- **Fontes:** fonte local do sistema; hierarquia de seção, código, nome, estado e legenda. Textos de navegação pequenos acompanham a densidade da referência; nomes longos quebram linha nas listas. A família exata da imagem não foi identificada; não há download de fontes.
- **Espaço:** rail e painel em colunas reais no desktop, sem cobrir a lista com a consulta. Recolher amplia a área do mapa; editor recolhe a lateral para abrir espaço. Em celular, navegação horizontal de56 px, painel sobreposto300 px e fechamento ao selecionar. Sem transbordamento horizontal da página nos tamanhos avaliados.
- **Cores:** painel #181a22, bordas #30313b, ativo violeta, ações amarelas. Estado e navegação também identificados por texto. Área do mapa mantida conforme o produto atual.
- **Ativos:** ícones Feather locais já incorporados e ajuda existente corrigida; nenhuma imagem raster nova ou planta corporativa inventada. Nome Horse é identificação textual existente, não novo logotipo.
- **Texto:** Mapa, Equipamentos, Operações e Ajuda; Explorar planta, Encontrar operação e Recolher. Ajuda atualizada para a nova navegação. Operação descrita como filtro opcional.

## Fluxos e validação

No navegador: alternância das três seções, busca local da operação012, clique explícito aplicando filtro, lista com3 resultados, consulta direta EQ024 mantendo operação012, recolhimento preservando seleção e ampliando mapa, seleção EQ001 no celular fechando a lateral, editor e retorno à consulta, Ajuda, filtro Reader com13 equipamentos fictícios e limpeza de filtros. Formulários e consultas avaliados em desktop, celular e801 px. A navegação não escreveu inventário.

Suíte final: 85 testes, 84 aprovados, 0 falhas, 1 ignorado por limitação do Windows na criação de link simbólico sintético. Inclui guardas de descarte, preservação de vínculos/busca/pan, navegação e recolhimento, seleção distinta em desktop/celular e regressão de redimensionamento. Nove verificações de sintaxe, build e diff-check passaram. As últimas correções exclusivamente de CSS foram verificadas no navegador.

Security revisou os novos handlers e a lista dinâmica: texto via textContent, controles dentro da área autenticada, validação/guarda antes de transições. Nenhum problema concreto adicional foi encontrado no escopo revisado; não é garantia de ausência de vulnerabilidades.

Banco real preservado: SHA256 4D163EAD935EA0DA9F9B50C258F31D4943BC3886D69F054582B5A21BFFD1D4D5. Prévia usa somente work/horse-ui-1lN4xH; admin/admin continua exclusivo dessa base fictícia. Nenhuma política de senha real ou configuração de compartilhamento foi modificada.

Limites: sem teste em aparelho físico/teclado virtual, sem auditoria completa por leitor de tela; os diálogos nativos de descarte foram cobertos por testes automatizados. O estado vazio da fonte não foi recriado mediante apagamento da base fictícia; conteúdo e mapa existentes são desvio intencional do escopo lateral.

## Checklist final

- [x] Comparar fonte e aplicação no mesmo quadro e escala.
- [x] Verificar navegação, lista, operação opcional e recolhimento.
- [x] Corrigir problemas de desktop e celular e recapturar.
- [x] Executar verificações funcionais e preservar dados.
- [x] Manter revisão local, aguardando aprovação de Git.

final result: passed
