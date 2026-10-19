# Correção da exibição de operações — 19/10/2026

Correção revisada e aprovada pelo proprietário em 19/10/2026 para envio aos dois repositórios. No repositório original, o destino é somente a branch `feature/mapa-2.0`; no independente, a branch `main`.

## Problema confirmado

A interface portátil original desenhava pinos de operações nas coordenadas dos nós. A interface nova iniciava mostrando equipamentos em suas próprias coordenadas, agrupados por proximidade. Um grupo de equipamentos podia ser confundido com operações unificadas, embora os dados das operações estivessem preservados.

A regra genérica de botões do tema também aumentava o pino para 40 px, com padding e borda. Além disso, combinar a propriedade individual scale com uma translação percentual deslocava a âncora durante a escala.

## Correção

- Mapa e Operações exibem pinos individuais de operações; nenhuma operação é agrupada.
- Equipamentos mantém acesso direto e agrupamento apenas dos seus marcadores.
- Busca, links e criação de equipamento ativam sua camada, sem alterar vínculos ou coordenadas.
- Cancelar a criação restaura as camadas anteriores.
- Pinos têm dimensões e estilos próprios, independentes do botão genérico do tema.
- Translação e escala usam a mesma transformação, com origem na base do pino. A âncora permanece na coordenada salva.
- A contagem do mapa corresponde à camada desenhada.

## Validação

Os dados foram comparados com o HTML portátil fornecido, a base privada original e a cópia local de testes. Imagens, coordenadas e vínculos permaneceram preservados; não foram feitas correções artificiais nos dados.

No navegador, a visão de operações exibiu todos os nós da planta examinada, sem grupos de equipamentos. A diferença entre a âncora desenhada e a coordenada esperada ficou abaixo de 0,02 px em 100% e 150% de zoom. A troca para Equipamentos mostrou somente seus marcadores; retornar a Operações restaurou os pinos.

Conferência complementar: as demais plantas também foram abertas no navegador, em 100% e 150%. Todas carregaram a imagem correta e o conjunto completo de operações, sem agrupamento na camada de operações; o maior erro de ancoragem medido permaneceu abaixo de 0,02 px. A comparação com o original não encontrou coordenadas inválidas ou posições de operações exatamente duplicadas. Os nomes das operações permanecem como recebidos; o proprietário optou por ajustá-los posteriormente.

Suíte por projeto: 90 testes, 89 aprovados, nenhuma falha e um ignorado por limitação do Windows para link simbólico sintético. Novas regressões cobrem camada inicial, navegação com guarda de rascunho, renderização separada dos nós e restauração após cancelar criação.

As evidências com plantas reais permanecem apenas no diretório privado de trabalho. Banco e imagens reais não entram no Git. Em escalas reduzidas, rótulos de operações próximas ainda podem se sobrepor; os nós continuam distintos e o zoom permite inspecioná-los sem mudar suas posições.
