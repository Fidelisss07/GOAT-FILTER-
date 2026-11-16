# Assinatura do `.exe` sem pagar

Sem assinatura digital, o Windows mostra "O Windows protegeu o computador" (SmartScreen)
na primeira vez que alguém abre o Goat Filter. O app funciona do mesmo jeito: basta clicar
em **Mais informações › Executar assim mesmo**.

Para tirar esse aviso existem três caminhos **gratuitos**. Todos dependem de uma ação do
dono do projeto, porque envolvem criar conta e aceitar termos.

## 1. SignPath Foundation: assinatura grátis para código aberto

A [SignPath Foundation](https://signpath.org) assina de graça projetos **open source**.

Requisitos:
- Repositório público (o Goat Filter já é).
- Uma **licença open source** no repositório: o projeto usa a licença [MIT](../LICENSE).
- Pedir a entrada no programa pelo site e esperar a aprovação.

Depois da aprovação, o workflow **Publicar versão** já está pronto:
1. Em *Settings › Secrets and variables › Actions*, crie o segredo `SIGNPATH_API_TOKEN`
   e a variável `SIGNPATH_ORGANIZATION_ID` com os dados que a SignPath fornecer.
2. Na SignPath, crie o projeto `goat-filter` com a política `release-signing`.
3. Rode **Publicar versão**: os `.exe` saem assinados.

## 2. Microsoft Store: a loja assina e distribui

A conta de desenvolvedor **individual** da Microsoft Store não tem custo. Dá para publicar o
próprio instalador `.exe` (o Goat Filter aceita instalação silenciosa com `/S`), apontando
para o link da versão em *Releases*. Quem instala pela Store não vê o aviso do SmartScreen.

Passos: criar a conta no Partner Center → "Novo produto › App EXE ou MSI" → informar o link
do instalador da versão → enviar para certificação.

## 3. winget: instalação pelo terminal

Enviar o Goat Filter para o repositório público do
[winget](https://github.com/microsoft/winget-pkgs) é grátis. Depois disso, qualquer pessoa
instala com:

```
winget install <identificador-do-goat-filter>
```

(o identificador é escolhido no envio, por exemplo `Fidelisss07.GoatFilter`).

Instalando pelo winget, normalmente o aviso do SmartScreen não aparece.

## E se não fizer nada?

O SmartScreen também cria "reputação" com o tempo: quanto mais pessoas baixam e executam o
mesmo arquivo sem problemas, menos o aviso aparece. Sem assinatura, isso é lento e recomeça a
cada versão nova.
