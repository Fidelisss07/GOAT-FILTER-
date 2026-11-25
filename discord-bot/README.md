# Bot do Discord — Goat Filter

Bot de **suporte** do servidor do Goat Filter: tickets privados, ajuda automática,
FAQ por comando e aviso de versão. Feito em [discord.js](https://discord.js.org) v14.

## O que ele faz

- **Tickets** (`/painel`): um menu fixo onde a pessoa escolhe o assunto (Suporte, Erro,
  Pagamento/Pro, Sugestão), descreve o problema e o bot cria um **canal privado** só com ela
  e a equipe. Ao fechar, ele **salva a conversa** (transcrição) no canal de registros e apaga o canal.
- **Ajuda automática:** quando alguém escreve uma dúvida comum no chat ("deu aviso ao instalar",
  "vai tomar ban?", "funciona com AMD?"), o bot responde sozinho com a resposta certa (sem spam:
  no máximo 1 vez por minuto por pessoa, e nunca dentro de um ticket).
- **Comandos:** `/ajuda` (menu de dúvidas), `/faq assunto:` (resposta direta), `/versao`
  (versão mais nova, lida do site), `/baixar` (link oficial), `/painel` (equipe: publica o painel de tickets).
- **Boas-vindas:** mensagem para quem entra no servidor.
- **Confiável:** registra erros num canal, trata quedas de conexão e não cai por um erro solto.

## Passo a passo (do zero)

### 1. Criar o bot no Discord
1. Acesse <https://discord.com/developers/applications> e clique em **New Application**. Nome: `Goat Filter`.
2. Em **Bot**: clique em **Reset Token** e **copie o token** (é a senha do bot — não compartilhe).
3. Ainda em **Bot**, ligue **Privileged Gateway Intents**:
   - **Server Members Intent** (boas-vindas)
   - **Message Content Intent** (ajuda automática)
4. Em **OAuth2 → URL Generator**: marque **bot** e **applications.commands**; nas permissões do bot,
   marque **Manage Channels**, **Manage Roles**, **Send Messages**, **Embed Links**, **Attach Files**,
   **Read Message History**. Abra a URL gerada e **adicione o bot ao seu servidor**.

### 2. Configurar
1. Tenha o **Node.js 18+** instalado.
2. Nesta pasta, rode `npm install`.
3. Copie `.env.example` para `.env` e preencha (veja os comentários no arquivo). Para pegar os IDs,
   ligue o **Modo Desenvolvedor** no Discord (Configurações → Avançado) e clique com o botão direito
   para "Copiar ID".

### 3. Ligar
```bash
npm run deploy   # registra os comandos de barra (uma vez, e sempre que mudar os comandos)
npm start        # liga o bot
```
No servidor, vá ao canal de suporte e rode **/painel** para publicar o menu de tickets.

## Onde hospedar (para ficar 24h no ar)

O bot precisa rodar sempre. Opções:
- **Seu PC:** simples para testar, mas só funciona com o PC ligado.
- **VPS** (Hostinger, Contabo, Oracle Cloud grátis, etc.): o jeito "de verdade". Instale o Node,
  suba a pasta e rode com `pm2` (`npm i -g pm2 && pm2 start src/index.js --name goat-bot`).
- **Railway / Render / Fly.io:** sobem direto do GitHub. Coloque as variáveis do `.env` no painel do serviço.

## Segurança
- **Nunca** suba o `.env` nem o token para o GitHub (o `.gitignore` já bloqueia).
- Se o token vazar, vá no Developer Portal e clique em **Reset Token**.
