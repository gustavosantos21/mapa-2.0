# Interface Horse — Mapa em foco

Direção visual atual escolhida em 14/10/2026 na primeira proposta da nova exploração do Product Design.

- Cabeçalho e cartão grafite, mapa em toda a área de trabalho e amarelo claro para Editar equipamento e Salvar durante a edição.
- Violeta para foco e seleção. Erros continuam identificados por texto, além da cor.
- Cartão de consulta flutuante no canto inferior direito; formulário somente em modo de edição. Lista acessível pela aba lateral Equipamentos.
- Resultados da pesquisa ancorados no campo, sem ocupar uma coluna adicional de filtros.
- Login, formulários, detalhes técnicos e estados de conexão usam a mesma linguagem visual.

As funções secundárias ficam em menus fechados; o cadastro destaca os campos essenciais e reúne os demais em Mais detalhes. Em telas menores, consulta e edição usam um painel sobre o mapa. A evidência visual e os testes da revisão atual são registrados em `design-qa.md`.

A revisão 2.6 mantém essa direção e ajusta a composição a partir de problemas observados na largura de uso do usuário: resumo menor, ações agrupadas, lista e consulta exclusivas e enquadramento na área livre. As diferenças de tamanho em relação ao mock inicial são alterações pedidas para aproveitar melhor o espaço; não representam uma tentativa de reproduzir o cartão grande da versão 2.5.

O nome HORSE MOTORES é texto de identificação. Não foi criado um novo logotipo oficial. A composição da aplicação é própria. As cores de referência estão no [centro de marca Horse](https://brand.horse.cars/core-elements/): preto, branco, prata, amarelo claro #FFF39F, violeta #4F21FF e vermelho #FF3127. A interface utiliza fontes locais do sistema e não carrega fontes, imagens ou scripts de terceiros.

Os ícones de consulta, localização, edição e lista usam a biblioteca [Feather 4.29.0](https://github.com/feathericons/feather/tree/v4.29.0), incorporada à interface sem requisições externas. A licença MIT está em [licenses/feather-LICENSE.txt](licenses/feather-LICENSE.txt).

As plantas corporativas permanecem imagens privadas, sem substituição por ilustrações geradas. A referência visual contém uma planta ilustrativa; seu conteúdo não substitui os mapas operacionais. Dados, autenticação, SQLite e compartilhamento continuam separados do HTML. A hospedagem segue pendente de definição.

A revisão 2.7 usa a imagem enviada em 15/10/2026 como referência para as opções laterais: faixa de navegação com Mapa, Equipamentos, Operações e Ajuda, acompanhada de painel contextual recolhível. Lista e consulta podem coexistir em colunas distintas no desktop; em telas pequenas, a lista sobreposta fecha ao selecionar. O mapa e os equipamentos continuam acessíveis sem percorrer uma operação.

A identidade visual não representa uma conclusão sobre direitos de marcas ou autorização jurídica. A validação visual e funcional desta entrega é registrada em `design-qa.md`.
