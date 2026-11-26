# Bot do Discord — Goat Filter

Bot de **suporte** do servidor do Goat Filter: tickets privados, ajuda automática,
FAQ por comando e aviso de versão. Feito em [discord.js](https://discord.js.org) v14.

## O que ele faz

- **Monta o servidor inteiro com `/configurar`**: cargos (Admin, Moderador, Equipe, Criador de Conteúdo,
  Parceiro, Goat Pro, Membro, elos do Valorant e cargos de aviso), categorias **Início, Comunidade,
  Suporte, Voz, Equipe e Tickets**, uns 20 canais com as permissões certas, e as mensagens fixas
  (regras com botão de aceitar, como baixar, escolha de cargos, apresentação e painel de tickets).
  Pode rodar de novo quando quiser: ajusta o que existe e não duplica nada.
- **Verificação**: quem entra só vê #boas-vindas e #regras até clicar em *Li e aceito as regras*.
- **Cargos por botão**: avisos de atualização, eventos e vídeos (liga/desliga) e elo do Valorant.
- **Aviso automático de versão nova** do app em #atualizações (lê o site a cada 10 min).
- **Sugestões com votação** (👍/👎) e tópico de discussão; **clipes** ganham 🔥 e tópico de comentários.
- **Tickets privados**, **ajuda automática** (responde dúvidas comuns) e `/ajuda`, `/faq`, `/versao`, `/baixar`.
- **Moderação**: anti-convite, anti-spam, anti-menção em massa, `/limpar`, `/castigo`, `/aviso`
  (3 avisos = 1 h de castigo), `/expulsar`, `/banir`, e `/anunciar` (formulário que posta em #anúncios).
- **Registros** em #registros: entradas, saídas, mensagens apagadas/editadas, moderação e tickets.
- **Contador de membros** num canal de voz trancado.

## Passo a passo (do zero)

### 1. Criar o bot no Discord
1. Acesse <https://discord.com/developers/applications> e clique em **New Application**. Nome: `Goat Filter`.
2. Em **Bot**: clique em **Reset Token** e **copie o token** (é a senha do bot — não compartilhe).
3. Ainda em **Bot**, ligue **Privileged Gateway Intents**:
   - **Server Members Intent** (boas-vindas)
   - **Message Content Intent** (ajuda automática)
4. Convide com **Administrador** (o bot cria cargos, permissões e o cargo Admin):
   `https://discord.com/oauth2/authorize?client_id=SEU_CLIENT_ID&permissions=8&integration_type=0&scope=bot+applications.commands`
   Depois, em Configurações do servidor › Cargos, **arraste o cargo do bot para o topo**.

### 2. Configurar
Só precisa de duas coisas no `.env` (copie de `.env.example`): **DISCORD_TOKEN** e **CLIENT_ID**.
O bot registra os comandos sozinho em cada servidor quando liga.

### 3. Ligar e configurar o servidor
```bash
npm install
npm start
```
No Discord, rode **/configurar** (só administradores veem). Opções:
`verificacao` (padrão: sim) e `limpar_padrao` (apaga o #geral e o canal de voz Geral que o Discord cria).
Depois, dê os cargos **Admin**, **Moderador** ou **Equipe Goat Filter** para a sua equipe.

## Hospedar de graça na Discloud
1. Entre em <https://discloud.com> com a sua conta do Discord.
2. Crie um `.env` nesta pasta com `DISCORD_TOKEN=...` e `CLIENT_ID=1575604897645199511`.
3. Compacte **o conteúdo desta pasta** em um `.zip` **sem** a pasta `node_modules`
   (precisa ter `discloud.config`, `package.json`, `src/` e `.env`).
4. No painel da Discloud, faça o upload do `.zip`. O bot liga sozinho.

## Onde hospedar (para ficar 24h no ar)

O bot precisa rodar sempre. Opções:
- **Seu PC:** simples para testar, mas só funciona com o PC ligado.
- **VPS** (Hostinger, Contabo, Oracle Cloud grátis, etc.): o jeito "de verdade". Instale o Node,
  suba a pasta e rode com `pm2` (`npm i -g pm2 && pm2 start src/index.js --name goat-bot`).
- **Railway / Render / Fly.io:** sobem direto do GitHub. Coloque as variáveis do `.env` no painel do serviço.

## Segurança
- **Nunca** suba o `.env` nem o token para o GitHub (o `.gitignore` já bloqueia).
- Se o token vazar, vá no Developer Portal e clique em **Reset Token**.
