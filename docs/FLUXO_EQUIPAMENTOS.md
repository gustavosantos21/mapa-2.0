# Mapa em foco e acesso direto — versão 2.6

Solicitação de 14/10/2026. Fluxo principal: localizar → selecionar equipamento → consultar → editar quando necessário.

- Busca por código, nome, IP ou número de série abre o cartão de consulta diretamente, sem selecionar automaticamente sua operação. A aba Equipamentos também permite escolher pela lista.
- O cartão flutuante apresenta nome, código, status, categoria e operação. Localizar centraliza a posição existente; Editar equipamento abre o formulário. A consulta não grava alterações.
- O mapa mostra equipamentos usando suas coordenadas existentes. Quando houver muitos próximos, mostra um grupo com a quantidade e abre uma lista de equipamentos para seleção.
- A operação é um filtro opcional. Selecioná-la limita os equipamentos apresentados; não abre automaticamente o diálogo de gestão da operação.
- O cadastro informa as operações vinculadas. Os vínculos continuam editáveis pela função existente em Mais detalhes.
- Novo equipamento fica disponível nas ações do mapa. A posição é escolhida no mapa; vincular uma operação é opcional e não altera os vínculos dos equipamentos existentes.
- A lista e o cartão não ocupam a tela juntos. Em janelas intermediárias, o resumo fica compacto abaixo do mapa; o enquadramento considera a área livre acima dele.
- Voltar da edição retorna à consulta; fechar a consulta preserva busca, filtros, zoom e deslocamento. Edições pendentes continuam protegidas pela confirmação existente, inclusive ao abrir a lista.
- Gestão de operações e movimentação de seus marcadores continuam nas ferramentas secundárias.

O agrupamento é apenas visual: não muda coordenadas, vínculos, inventário, fotos ou operações. Os dados privados continuam no servidor. A revisão está local e aguarda aprovação antes de commit/envio ao GitHub. As verificações são registradas em `design-qa.md`.

Equipamentos sem coordenadas válidas continuam acessíveis pela busca, sem localização inventada no mapa. A planta ilustrativa da proposta visual não substitui as imagens operacionais privadas. Consulte a validação atual em `design-qa.md`; testes e capturas usam dados fictícios.
