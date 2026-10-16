# Usabilidade — versão 2.1

Inspeção e teste de tarefas realizados em 9 de outubro de 2026. Coder implementou as melhorias; QA verificou regressões e Security revisou os riscos. O teste visual foi feito pela raiz no navegador com um servidor local e banco separados da instalação real.

## Ambiente e método

Windows, Node.js 24.19.0 e navegador integrado do Codex. A janela usada era de 1280 × 720 pixels, com aproximadamente 1265 pixels úteis de largura após a barra de rolagem. A base fictícia tinha quatro plantas, 302 equipamentos e 231 operações inicialmente. Uma planta tinha 12 operações e 36 equipamentos; outra tinha 215 operações e 254 equipamentos. A planta industrial de teste foi uma grade genérica, sem imagens corporativas.

Esta é uma inspeção por tarefas realizada pelo agente, sem participantes humanos, pontuação SUS ou medição de desempenho. Os tempos e interrupções da ferramenta de controle não foram usados como tempo de resposta da aplicação.

## Problemas observados e alterações

| Observação na versão anterior | Alteração na versão 2.1 |
| --- | --- |
| Buscar um código de equipamento não encontrava o cadastro. | Busca ampliada para equipamentos e dados técnicos, com resultados que abrem o editor diretamente. |
| Contagens globais e da planta selecionada apareciam próximas sem esclarecer o alcance. | Indicadores identificam todas as plantas ou o nome da planta selecionada. |
| Muitos campos e textos em inglês alongavam a edição cotidiana. | Campos técnicos e aparência reunidos em seções expansíveis; principais rótulos e mensagens traduzidos. |
| Os nomes de 215 operações se sobrepunham na visão geral. | Códigos compactos em mapas densos, mantendo nomes nos recursos de foco e identificação acessível. |
| Criar uma operação exigia confirmação adicional e os erros interrompiam o fluxo. | Mensagens no formulário para nome vazio, duplicado ou inválido; criação válida sem confirmação redundante. |

As traduções de apresentação preservam os valores internos do inventário. A revisão detectou e corrigiu substituições acidentais em fotos, destinos dos cabos e variáveis de salvamento antes da entrega; os testes passaram a cobrir explicitamente esses dados e a conclusão da troca de planta e do arraste.

## Resultados confirmados

| Tarefa | Evidência |
| --- | --- |
| Entrar na aplicação | Login válido abriu o painel privado; a rodada inicial também verificou a mensagem para login inválido. |
| Criar operação | Nome vazio exibiu mensagem no formulário; criação válida aumentou a planta de 12 para 13 operações e foi salva no servidor. |
| Impedir duplicação | O mesmo nome com letras minúsculas foi recusado, sem aumentar a contagem. |
| Encontrar equipamento pelo código | `eq005` retornou um equipamento e sua operação; o resultado abriu diretamente o editor de EQ-005. |
| Editar e recarregar | Nome, IP e número de série fictícios foram salvos com a seção técnica fechada; recarregar preservou os três valores. |
| Encontrar pelo IP | A busca pelo IP salvo retornou o equipamento correto depois do recarregamento. |
| Trocar planta | A planta densa exibiu 215 operações, 254 equipamentos e o alcance correto dos indicadores; a seleção salva permaneceu após recarregar a versão final. |
| Aplicar filtros | Logística retornou 72 operações e 85 equipamentos; com Leitor e AS IS, retornou 36 operações e 36 equipamentos. |
| Limpar filtros | Restaurou 215 operações, 254 equipamentos e os três filtros para o estado inicial. |
| Zoom básico | A ampliação alterou o indicador de 100% para 125% e 135%; restaurar retornou a 100%. |
| Ler mapa denso | A captura da visão geral confirmou códigos compactos no lugar dos nomes sobrepostos. |
| Verificar erros | Não foram registrados erros ou avisos de console na rodada final. |

A suíte automatizada final executou 41 testes: 40 passaram, nenhum falhou e um foi ignorado por restrição de links simbólicos de arquivos no Windows. Inclui busca por códigos, IP, hostname, número de série e acentos; combinação de termos; validação e rollback da criação; regra dos rótulos compactos; preservação de fotos, cabos, vínculos, coordenadas e valores internos; conclusão da troca de planta e salvamento ou rollback do arraste. O build verifica a incorporação do helper de busca e o hash da política de conteúdo.

## Limites e próxima verificação

A ferramenta de navegador interrompeu algumas ações. A rodada inicial parou na confirmação de criação; após sua remoção, a criação foi exercitada até o salvamento. Nos filtros e no zoom da rodada final, a leitura do estado visível confirmou ações mesmo quando a ferramenta informou interrupção. Isso não foi classificado como falha comprovada da aplicação.

A transição visual dos rótulos acima de 150%, o foco por teclado e a passagem do ponteiro ainda precisam de uma rodada manual completa. A regra de densidade e zoom está coberta por teste automatizado. A tentativa de reduzir o tamanho da janela para celular manteve a largura de desktop, portanto o uso em celular não foi validado.

Upload, importação de backup e conflitos entre duas pessoas não foram repetidos nesta rodada de interface; as verificações anteriores estão em [VALIDACAO.md](VALIDACAO.md) e suas regressões automatizadas continuam passando. A hospedagem e o acesso remoto ainda precisam ser definidos.

Recomenda-se a próxima rodada com os dois usuários realizando tarefas reais de consulta e cadastro, especialmente em tela pequena e mapas com posições muito próximas. Nenhum inventário, conta ou imagem real foi alterado durante este teste.
