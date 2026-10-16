# Instalação compartilhada

A hospedagem será definida posteriormente. A versão entregue funciona localmente e usa a mesma base para todas as sessões conectadas à instalação.

## Preparar o servidor

1. Instale Node.js 24 ou superior e coloque o código em uma pasta de serviço.
2. Gere a interface com `node scripts/build.mjs`.
3. Com o serviço parado, transfira o armazenamento `private/` por um meio protegido ou comece com uma base vazia.
4. Crie contas individuais com `node scripts/admin.mjs create-user USUARIO`. Não há senha padrão e não envie senhas por Git.
5. Execute o processo como um serviço com acesso restrito à pasta privada e reinício supervisionado.

## HTTPS e origem

O processo Node escuta somente em `127.0.0.1`; ele não expõe uma porta de dados diretamente na rede.
Para acesso em equipe, coloque um proxy HTTPS na mesma máquina e configure-o para encaminhar ao Node preservando o cabeçalho `Host` do endereço público.
O proxy nunca deve publicar `private/` como uma pasta estática.

Defina `MAP_PUBLIC_ORIGIN` com o endereço HTTPS exato, sem caminho ou barra final. Exemplo PowerShell:

```powershell
$env:MAP_PUBLIC_ORIGIN = "https://mapa.example.com"
$env:MAP_PORT = "4173"
node scripts/serve.mjs
```

O domínio acima é apenas um exemplo. Configure o domínio real, certificado, DNS e acesso de rede da instalação escolhida. Com origem HTTPS, o cookie da sessão recebe `Secure`.
No uso local, não defina `MAP_PUBLIC_ORIGIN`; acesse `http://127.0.0.1:4173`.

O servidor verifica `Host`, `Origin` e o token CSRF. Cabeçalhos encaminhados do cliente não são usados para liberar acesso. O proxy deve preservar a origem permitida e limitar o corpo de upload a 12 MB ou menos.

## Operação

Use uma única instalação ativa para a base compartilhada; SQLite não deve ser colocado em uma pasta de rede usada por vários servidores.
Proteja o disco, as permissões da pasta, os backups e os logs do serviço. As contas do painel são independentes das permissões do GitHub.

Todos os usuários autenticados desta versão podem editar. Papéis de somente leitura, integração corporativa de identidade, histórico detalhado por campo e revisão de alterações são evoluções possíveis.

Trocar a senha pelo administrador exige reiniciar o serviço para invalidar sessões abertas. Após configurar o ambiente, valide acesso de duas contas, upload, persistência após reinício, conflito entre edições e restauração de backup antes de liberar uso contínuo.
