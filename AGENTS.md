# Preferências de trabalho neste projeto

Estas instruções se aplicam ao projeto `mapa-2.0` (Mapa 2.0).

O repositório deste projeto é `gustavosantos21/mapa-2.0`. Ele é independente de `mapa-logistica-interativo`; não envie alterações para o repositório antigo ao trabalhar aqui.

## Atualizações e GitHub

O proprietário pediu para revisar as mudanças locais antes de aprovar o envio
ao GitHub. Essa preferência substitui a autorização anterior de envio automático
e continua válida até que o usuário a altere.

- Conclua a alteração e execute as verificações adequadas antes do commit.
- Crie um commit por atualização concluída, com mensagem clara em português.
  Não crie commits vazios nem commits para cada edição intermediária.
- Inclua apenas os arquivos relativos à solicitação; preserve alterações alheias.
- Aguarde a aprovação explícita do usuário antes de criar o commit e enviá-lo
  à branch de trabalho no GitHub. A branch atual do projeto é `main`.
- Antes do envio, confira as atualizações remotas, pois há colaboração no projeto.
  Preserve o trabalho dos colaboradores; não use envio forçado.
- Respeite o `.gitignore`: dados privados, credenciais e distribuições geradas
  ficam fora do versionamento. Use dados genéricos na base publicada.
- Informe ao usuário o resultado do envio. Se houver bloqueio de autenticação,
  permissões ou conflito não resolvido, explique o que falta; não declare sucesso.
- Se o usuário pedir explicitamente uma alteração apenas local ou sem envio,
  siga essa instrução para a solicitação correspondente.

## Verificações disponíveis

O projeto usa Node.js 24 ou superior e não tem dependências externas.
Para alterações no código, use as verificações relevantes:

```sh
node --check src/app.js
node --check src/search.js
node --check scripts/build.mjs
node --check scripts/serve.mjs
node --check scripts/store.mjs
node --check scripts/admin.mjs
node --check scripts/configure.mjs
node --check scripts/migrate-portable.mjs
node --test scripts/*.test.mjs
```

Alterações somente de documentação podem ser verificadas por leitura e por
`git diff --check`, sem repetir os testes do programa.
