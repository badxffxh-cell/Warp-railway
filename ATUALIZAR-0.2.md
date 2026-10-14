# Atualizar seu WARP para 0.2.0

Esta versão adiciona servidores, canais, convites, amigos por @username, conversas privadas e chat ao vivo. Voz/vídeo/tela usam LiveKit e exigem um serviço de mídia publicado separadamente. Não compre infraestrutura antes de ler VOZ-LIVEKIT.md.

## 1. API no Render primeiro

1. Faça um backup do PostgreSQL pelo seu provedor antes da atualização.
2. Extraia **warp-api.zip**. Entre na pasta **warp-api**. É o conteúdo dessa pasta que vai para a raiz do repositório **badxffxh-cell/Warp-railway**.
3. Pelo GitHub Desktop, substitua os arquivos antigos pelos novos em um único commit. Preserve a pasta `.git`. Não envie `.env`, `node_modules` nem o ZIP inteiro. Preserve suas configurações de ambiente no Render.
4. No serviço **Warp-railway → Environment**, adicione:

```dotenv
PUBLIC_API_URL=https://warp-railway.onrender.com
WEB_URL=https://warp-warp.vercel.app
CORS_ORIGINS=https://warp-warp.vercel.app
COOKIE_SAME_SITE=lax
```

5. Mantenha **DATABASE_URL**, **SESSION_SECRET** e a configuração de e-mail existentes. Não troque o segredo nem recrie o banco.
6. Serviço Docker: raiz do repositório, Dockerfile `Dockerfile`, **Docker Command vazio**. O novo Dockerfile executa `npm run db:migrate` antes de iniciar. Não copie comandos com aspas para o campo de comando.
7. Faça commit/push e aguarde o deploy. Se não iniciar automaticamente, escolha **Manual Deploy → Deploy latest commit**. As duas novas migrations acrescentam tabelas sem apagar contas existentes.
8. Abra https://warp-railway.onrender.com/health e confirme `version: "0.2.0"`.

## 2. Site na Vercel

1. Extraia **warp-web.zip**. Copie o conteúdo de **warp-web** para a raiz do repositório **badxffxh-cell/Warp-Website**, substituindo os arquivos do site no mesmo commit.
2. O pacote contém `package.json` e `package-lock.json` correspondentes. Envie os dois. Os workspaces são explícitos, para pastas antigas de desktop/API não entrarem no build do site.
3. Vercel: **Root Directory vazio/raiz**, framework **Vite**, instalação **npm ci**, build **npm run build**, saída **apps/web/dist**.
4. Em Environment Variables, mantenha **VITE_API_URL=/api** para Production. Não coloque segredos no frontend.
5. O `vercel.json` deste pacote já encaminha `/api` para **https://warp-railway.onrender.com**. Não resta endereço de exemplo Railway.
6. Faça commit/push e espere a publicação mais recente ficar **Ready**. Abra https://warp-warp.vercel.app/api/health: a versão também deve ser `0.2.0`.
7. Recarregue o site. Entre na conta. A página inicial autenticada agora mostra **Amigos e conversas**, e a barra lateral possui **+ Criar servidor**.

Se ocorrer erro, veja o deploy mais recente, não tente republicar uma versão antiga. Se `/api/health` disser Application not found, confira o destino do rewrite. Se o site abrir mas ficar Reconectando, confira PUBLIC_API_URL e CORS_ORIGINS; o WebSocket usa diretamente `wss://warp-railway.onrender.com/v1/realtime`.

## 3. Usar com outras pessoas

- **Adicionar amigo:** informe o @username exato. A outra pessoa abre **Pendentes → Aceitar**. Não é o nome de exibição nem o e-mail.
- **Conversar:** use o botão de mensagem do amigo ou sua conversa na lateral. Enter envia, Shift+Enter quebra linha.
- **Servidor:** clique em **+**, dê um nome e salve. `geral` e `Sala de voz` aparecem automaticamente.
- **Convidar:** abra o servidor, clique em Convidar, escolha validade/limite e compartilhe o link.
- **Administrar:** o proprietário pode atribuir administrador, expulsar membros e transferir propriedade. Administradores gerenciam canais/mensagens; não podem excluir o servidor nem expulsar o proprietário.
- **Chamar amigo:** botão de telefone envia um convite visível enquanto ele estiver conectado. Ao atender, entra na chamada. A chamada toca como aviso visual, sem som de campainha e sem abrir microfone antes de atender.
- **Bloquear/remover amizade:** encerra acesso e exclui a conversa privada. A confirmação da interface avisa isso. Desbloquear não restaura a amizade ou mensagens.

## 4. Ativar voz

Leia **VOZ-LIVEKIT.md** e publique o SFU. Depois, no Render, configure `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` e faça redeploy. Sem essas variáveis, texto e amizades funcionam; voz mostra um erro claro de configuração.

## 5. Windows

Instale a versão nova disponível dentro do ZIP desktop ou compile conforme BUILD_WINDOWS.md. Configure API `https://warp-railway.onrender.com` e site `https://warp-warp.vercel.app`. O aplicativo acessa as mesmas contas e conversas. Use sempre os três pacotes da mesma versão.

## Escopo e limites desta entrega

Inclui cargos proprietário/administrador/membro. Ainda não inclui cargos personalizáveis, categorias, canais privados por cargo, grupos de DM, anexos no chat, busca, reações, bots, banimentos ou notificações push com o aplicativo fechado. A voz não foi verificada entre aparelhos/redes diferentes. Não é uma cópia completa do Discord.

API/WebSocket em uma única instância: não aumente réplicas sem adicionar distribuição de eventos. Histórico é paginado de 50 em 50. Mensagens novas são incrementais por WebSocket; reconexão reconcilia mensagens recentes. Sessões revogadas e permissões de voz são revisadas a cada 15 segundos; indisponibilidade do SFU pode atrasar a expulsão. Tokens de entrada duram 30 segundos. Revogações não são instantâneas.
