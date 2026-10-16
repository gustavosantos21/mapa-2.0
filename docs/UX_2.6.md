# Uso do espaço e equipamentos independentes — 2.6

Solicitação de 15/10/2026. Refinamento da direção Mapa em foco escolhida anteriormente, com base em capturas atuais de uma janela de 801 × 884 px.

## Problemas observados

- Lista, cartão e menu podiam aparecer juntos, encobrindo texto e mapa.
- O cartão de 440 × 424 px ocupava espaço excessivo em larguras intermediárias.
- A criação de equipamento ficava nas ferramentas e alguns caminhos exigiam operação.

## Decisões

- Mapa permanece principal, com ações de equipamentos, criação e filtros reunidas.
- Consulta compacta; lista, consulta e edição usam uma área por vez.
- Em telas intermediárias, o resumo fica abaixo da área de navegação em formato adaptado; a edição mantém campos com rolagem e ação de salvar acessível.
- Busca, lista e marcador abrem a mesma consulta; selecionar um equipamento não muda seus vínculos.
- Novo equipamento permite escolher a posição no mapa e informar uma operação opcional. Um vínculo existente só muda por ação explícita do usuário.
- Autenticação, sincronização, base SQL, coordenadas e fotos permanecem no modelo existente.

## Acesso e dados

A conta simples solicitada pelo usuário foi configurada somente na base fictícia da prévia local. A política de contas da instalação real continua individual, sem conta padrão criada automaticamente. O arquivo de preparação da prévia e seu banco ficam fora do código distribuído; o servidor de teste atende apenas em 127.0.0.1.

Nenhuma credencial ou informação corporativa deve entrar no pacote ou no Git. A revisão permanece local, aguardando aprovação antes de commit/envio. Evidências e limitações atuais estão em `design-qa.md`.
