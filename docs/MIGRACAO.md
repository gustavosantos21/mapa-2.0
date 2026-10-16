# Migrar o HTML portátil para o servidor

O HTML antigo é apenas uma fonte de importação. A versão 2 não altera esse arquivo e não executa seus scripts.

## Importar uma vez

Antes de iniciar uma instalação nova, execute dentro da pasta do projeto:

```sh
node scripts/migrate-portable.mjs "caminho/do/painel-original.html"
```

O destino padrão é `private/` e precisa ser uma pasta que ainda não exista.
Se já houver uma instalação, faça um backup protegido e use um destino novo para examinar a migração:

```sh
node scripts/migrate-portable.mjs "caminho/do/painel-original.html" "caminho/privado-novo"
```

O importador extrai o inventário JSON e os metadados literais dos mapas. Preserva os equipamentos, posições, informações, operações, conexões e histórico. Plantas e fotos são separadas em arquivos por hash; imagens repetidas usam o mesmo arquivo.

Somente PNG, JPEG e WebP são aceitos. SVG, scripts, expressões executáveis, referências fora da pasta de imagens e arquivos excessivamente grandes são rejeitados. A origem nunca é sobrescrita. Os arquivos de saída são preparados em uma pasta temporária e a migração só é publicada após a validação.

## Inicialização do banco

O servidor ou a criação da primeira conta importa `private/inventory.json`, `private/maps.json` e `private/assets/` para `private/state.sqlite` quando o banco ainda não contém estado.
Essa importação ocorre uma única vez. Reiniciar o servidor não substitui edições posteriores pelos arquivos antigos.

Os dados originais recuperados nesta instalação estão na pasta privada local. O código distribuído pelo GitHub e pelo ZIP começa vazio; ele não inclui esses dados.

## Levar a base para a hospedagem

Com o serviço parado, transfira a pasta `private/` completa por um meio protegido para o servidor escolhido. Preserve a base local como cópia até validar a instalação de destino.
Não inclua a pasta em commits, GitHub Pages, anexos públicos ou pastas públicas do servidor. Configure as contas e o acesso HTTPS conforme `HOSPEDAGEM.md`.
