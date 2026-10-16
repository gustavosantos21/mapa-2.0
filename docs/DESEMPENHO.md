# Interface mínima e desempenho — versão 2.3

Revisão local de 13/10/2026. Envio ao GitHub depende de aprovação explícita do proprietário nesta solicitação.

## Interface

A tela principal mantém planta, busca e mapa. Filtros, ferramentas, inventário e ações da conta usam menus fechados. O cadastro destaca código, nome, categoria, status e criticidade, com demais informações em Mais detalhes. Exclusão fica separada de Salvar. Mensagens de validação ficam junto da ação principal; falhas e conflitos de sincronização permanecem visíveis.

Em telas menores, selecionar um equipamento abre um painel sobre o mapa, limitado a 80% da altura disponível, com campos roláveis e rodapé de salvar. Voltar ao mapa permanece visível. O painel não se apresenta como modal e não prende o foco. A validação de teclado virtual, leitores de tela e fidelidade visual permanece pendente.

## Processamento

- Digitação rápida é agrupada em 120 ms, usando o último texto. Busca atualiza as áreas afetadas, sem refazer seletor de plantas e relatórios globais.
- Navegação e mudanças de filtro cancelam buscas pendentes; uma edição recusada pelo usuário continua preservada.
- Listas são construídas quando o painel de exploração está aberto e apenas para a aba ativa. Qualidade, histórico e resumo são calculados ao abrir as seções correspondentes.
- Fotos usam carregamento adiado e são montadas quando o conteúdo fica visível. A planta principal continua prioritária.

## Sincronização e transferência

O painel consulta `/api/revision` a cada 15 segundos. A rota exige sessão e lê somente a revisão no SQLite, sem desserializar o inventário. O estado completo é buscado apenas quando a revisão mudou. Chamadas sobrepostas são evitadas, e rascunhos/conflitos são conferidos antes e depois das requisições. Aba oculta e busca pendente impedem aplicação remota.

Somente o HTML público sem inventário pode ser transferido com gzip ou Brotli. A negociação respeita formatos desabilitados e qualidade; GET e HEAD preservam CSP e tamanho correspondente. Variantes ficam em memória no servidor e são invalidadas quando o arquivo muda. `no-store` permanece ativo e APIs privadas continuam sem compressão. Nenhum cache público foi habilitado para dados ou fotos.

No build desta revisão: HTML 422.504 bytes; gzip 81.945 bytes; Brotli nível 5, 75.227 bytes. A redução de transferência com Brotli é aproximadamente 82%. Medida local de tamanho do arquivo, sem incluir imagens, respostas de API, cabeçalhos ou latência de rede.

## Verificações e limites

58 testes: 57 aprovados, um ignorado por limitação de symlink no Windows, nenhuma falha. Os oito checks de sintaxe e o build passaram. Testes usam bases temporárias. O hash do banco real permaneceu inalterado.

O bloqueio de captura visual encontrado na revisão 2.3 foi resolvido posteriormente. Capturas e verificações atuais estão em `design-qa.md`. Não foram medidos FPS, Core Web Vitals ou funcionamento do teclado virtual. Redução de bytes e testes de comportamento não substituem essas medições.

A revisão 2.4 passou a reutilizar os marcadores de equipamentos e agrupá-los visualmente conforme a proximidade. Paginação de listas grandes e limpeza mais ampla das camadas CSS continuam como melhorias futuras. Não foi adotado um framework novo nem alterado o formato dos dados privados. Os números acima registram a medição histórica da revisão 2.3.
