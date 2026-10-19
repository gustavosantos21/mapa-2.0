# Atualização de validação — 19/10/2026

Registro da revisão dos dois projetos e dos testes de entrada solicitados pelo proprietário. Esta atualização documenta a validação; não modifica o comportamento da aplicação nem distribui dados privados.

## Repositórios e destinos

- Original: `gustavosantos21/mapa-logistica-interativo`, branch `feature/mapa-2.0`.
- Independente: `gustavosantos21/mapa-2.0`, branch `main`.
- Ambos privados na conferência. Código da aplicação equivalente; as instruções de trabalho diferem conforme o destino.
- A branch `main` do repositório original permanece fora desta atualização.

## Conferência dos dados

Três agentes verificaram os dois projetos. As plantas, fotos, identificadores, coordenadas e vínculos existentes foram comparados com a fonte original e a cópia privada de testes. A revisão confirmou a preservação do trabalho. A normalização de um nome de campo interno de validação na cópia manteve os valores correspondentes.

As imagens e o inventário reais continuam exclusivamente no armazenamento privado local. Nenhum banco SQLite, imagem real, credencial ou backup é incluído neste commit. Um clone novo começa com unidades vazias; para usar os dados reais é necessário configurar o armazenamento privado ou acessar a mesma instalação do servidor.

## Teste de entrada desta atualização

Executado em cada projeto:

`node --test scripts/integration.test.mjs scripts/security.test.mjs`

Resultado por projeto: **24 testes, 23 aprovados, nenhuma falha e um ignorado**, por restrição do Windows à criação de link simbólico sintético.

Cobertura: login válido e inválido, sessão e logout, bloqueio de dados e imagens sem sessão, acesso automático local, login obrigatório com origem pública, CSRF, expiração, persistência SQLite e proteção contra sobrescrita entre usuários. Os testes automatizados usam bases temporárias.

No navegador, a instalação local de testes com a cópia privada existente abriu com a sessão `local`, exibiu `Conectado` e carregou a planta. Não foram registrados erros no console durante essa abertura. O acesso automático é restrito ao modo local; o modo com origem pública mantém a exigência de login.

Os testes anteriores desta revisão também passaram: 21 testes relevantes e quatro verificações adicionais de SQLite temporário por projeto. Não houve edição do inventário original durante a conferência.
