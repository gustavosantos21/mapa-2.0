# Validação das versões 2 e 2.1

Validação atual de entrada e conferência dos dois projetos: [Atualização de 19/10/2026](ATUALIZACAO_2026-10-19.md). Os registros abaixo preservam o histórico das versões anteriores.

## Atualização 2.1 — 9 de outubro de 2026

A suíte final da versão 2.1 executou 41 testes: 40 passaram, nenhum falhou e um foi ignorado pela restrição do Windows para criar link simbólico de arquivo. Sintaxe, build e verificação do diff também passaram.

As novas regressões cobrem busca de equipamentos e dados técnicos, criação com validação no formulário e rollback, rótulos compactos, vínculos entre operações e preservação de fotos, cabos, coordenadas e valores internos. O teste no navegador confirmou criação, rejeição de duplicação, busca por código e IP, abertura direta, edição com seções fechadas, persistência após recarregar, troca de planta e filtros combinados. Resultados e limitações de zoom, teclado e celular estão em [USABILIDADE.md](USABILIDADE.md).

O inventário real foi conferido apenas por leitura e permaneceu na mesma revisão, sem contas novas nem mudança nas quantidades e imagens. A revisão Security não encontrou achados bloqueantes no escopo desta atualização; isso não representa garantia de ausência de vulnerabilidades.

## Registro anterior — versão 2.0

Verificação executada no Windows com Node.js 24.19.0. Dados fictícios foram usados em todos os testes automatizados e testes de interface; os dados originais foram verificados separadamente no armazenamento privado.

## Testes automatizados

A suíte final anterior à publicação executou 30 testes: 29 passaram, nenhum falhou e um foi ignorado porque a conta do Windows não tem permissão para criar um link simbólico de arquivo. O teste de junction de pasta foi executado e passou. Esse resultado não deve ser apresentado como aprovação do cenário ignorado.

Cobertura:

- HTML gerado sem dados privados, imagens embutidas ou caminhos locais; CSP e normalização de quebras de linha do Windows.
- Login, sessão, logout, cookies, expiração, tentativas limitadas e acesso privado a dados e imagens.
- Equipamentos e imagens preservados após reiniciar o servidor; importação inicial executada uma vez.
- Duas sessões não sobrescrevem silenciosamente a mesma revisão.
- Migração preserva posições, metadados, fotos e histórico sem executar o JavaScript da origem ou alterar o arquivo original.
- Rejeição de caminhos externos, links, requisições de origem incorreta, chaves perigosas, estrutura inválida e corpos excessivos.
- PNG, JPEG e WebP com limites de dimensões e rejeição de conteúdo ativo ou animações.

## Interface

O QA verificou login, consulta de operação/equipamento, edição, salvamento automático, recarregamento com a edição preservada e saída da conta. Não houve erros de console nessa rodada.

Em ambiente sintético, uma foto enviada ao armazenamento privado continuou renderizando após recarregar. Duas sessões receberam o conflito esperado: a segunda gravação retornou 409 e manteve o rascunho, sem substituir a primeira edição.

A troca da imagem da planta foi concluída pela raiz: a revisão avançou, a imagem foi carregada por URL privada e permaneceu após recarregar, com equipamento e operação preservados. O seletor de arquivos da ferramenta de navegador teve demoras e precisou de recuperação; esse atraso não foi medido como tempo de resposta da aplicação.

## Base privada recuperada

O inventário original foi convertido em arquivos privados e importado em SQLite. As quantidades, referências de imagem e legibilidade dos arquivos foram verificadas sem incluir identificadores ou informações reais nos arquivos versionados. A origem foi preservada.

A configuração de contas foi exercitada em um terminal do Windows com uma instalação fictícia: usuário, senha oculta, confirmação e autenticação pelo hash armazenado passaram. Senhas diferentes encerraram a configuração com erro, preservando a conta anterior.

O banco entregue ainda não contém contas ou senhas padrão. Execute Configurar_Acesso.cmd para criar as contas do painel antes do uso.

## Executar novamente

```sh
node scripts/build.mjs
node --test scripts/*.test.mjs
```

O acesso compartilhado remoto ainda depende da hospedagem e do HTTPS descritos em HOSPEDAGEM.md. A revisão de segurança não é uma garantia de ausência total de vulnerabilidades; seus limites estão em SEGURANCA.md.
