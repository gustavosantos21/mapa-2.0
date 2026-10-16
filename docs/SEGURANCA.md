# Segurança e dados privados

O projeto foi alterado para manter o inventário no servidor, em SQLite, separado dos arquivos da interface. A pasta `private/`, bancos, cópias de segurança, credenciais e distribuições geradas não devem ser versionados. Um repositório privado controla quem acessa o código no GitHub; ele não substitui o controle de acesso ao painel e ao computador que contém o banco.

## Escopo da revisão

A revisão e os testes usam exclusivamente dados sintéticos. Não há promessa de ausência total de vulnerabilidades. Os testes automatizados demonstram comportamentos específicos e precisam continuar sendo executados após alterações.

Os controles avaliados incluem autenticação, sessões, proteção contra requisições de outros sites, limites de entrada, arquivos de imagem, acesso a caminhos, isolamento do banco e conflitos entre gravações. Os resultados finais ficam em `docs/VALIDACAO.md`.

O servidor usa hashes de senha com sal aleatório e scrypt, consultas parametrizadas e tokens de sessão aleatórios mantidos no servidor. A sessão tem validade máxima de oito horas. Cookies são `HttpOnly` e `SameSite=Strict`; com origem pública HTTPS, recebem também `Secure`. Gravações exigem a origem permitida e token CSRF da sessão. A origem e o Host são conferidos explicitamente, sem confiar em cabeçalhos de encaminhamento enviados pelo cliente.

A API tem limite de corpo de 12 MB e valida profundidade, coleções, chaves perigosas e formato estrutural. Imagens privadas aceitam somente PNG, JPEG e WebP estáticos, com assinatura e cabeçalhos correspondentes. Dimensões são limitadas a 16.384 pixels por lado e 40 milhões de pixels no total; PNG e WebP animados são rejeitados. SVG e HTML são rejeitados. Nomes servidos são hashes, o acesso exige login e as respostas usam `no-store` e `nosniff`. Isso evita servir conteúdo como código ativo e limita resoluções abusivas, mas não é uma análise antivírus nem uma validação completa dos dados comprimidos, perfis de cor ou de todos os decodificadores de imagem.

Links simbólicos e junctions nos caminhos privados são rejeitados. O teste de junction de pasta foi executado no Windows. O teste de link simbólico de arquivo pode aparecer como ignorado quando a conta do sistema não possui permissão para criá-lo; essa condição precisa constar no resultado dos testes, sem ser apresentada como aprovação daquele cenário.

## Uso local e em equipe

O servidor escuta no endereço local do computador por padrão. Para colaboração, os usuários precisam acessar a mesma instalação do servidor: clonar o repositório não compartilha automaticamente o banco de dados.

Qualquer acesso por rede exige uma implantação controlada: HTTPS em um proxy configurado, firewall, origem pública explícita, contas ou integração de identidade corporativa e permissões adequadas. O servidor local não é uma plataforma pronta para exposição pública. Não publique a pasta `private/` em GitHub Pages nem a configure como pasta pública do proxy.

Todos os usuários autenticados desta versão possuem capacidade de editar o mesmo inventário. Antes de ampliar a equipe, avalie contas individuais, papéis de leitura e edição, revogação de acesso e identificação confiável no histórico. Campos de responsável no inventário não equivalem a identidade autenticada.

## Limites e recuperação

O banco e as imagens privadas não são criptografados pela aplicação em repouso. Proteja o computador, a conta do sistema e o disco; restrinja permissões da pasta e guarde backups em local protegido. Uma pessoa com acesso ao disco poderá ler ou alterar esses arquivos. Dados exportados também precisam de armazenamento privado.

Faça backups consistentes do banco com o serviço interrompido, incluindo as imagens necessárias. Teste a recuperação em ambiente separado antes de depender do backup. O GitHub não é backup do inventário. Trocar ou perder a senha exige ação do administrador local; esta edição não fornece recuperação de senha por e-mail.

O controle de concorrência impede a substituição silenciosa de uma revisão mais recente. Ao receber conflito, recarregue o estado e reaplique a alteração com cuidado. Ele não executa fusão automática de edições.

## Referências da revisão

- [OWASP: proteção contra CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP: gestão de sessões](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP: upload de arquivos](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [W3C: formato e cabeçalhos PNG](https://www.w3.org/TR/png-3/)
- [Google: contêiner WebP](https://developers.google.com/speed/webp/docs/riff_container)
- [libjpeg-turbo: leitura dos marcadores JPEG](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/src/jdmarker.c)
