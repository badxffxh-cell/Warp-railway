# WARP 0.2.0 — servidores, amigos e conversas

Pacotes independentes: **warp-api.zip**, **warp-web.zip**, **warp-desktop.zip**. Esta versão substitui a entrega 0.1.0. Comece por **ATUALIZAR-0.2.md** para atualizar os repositórios já usados no Render e na Vercel.

Inclui criação/edição/exclusão de servidores, convites com validade e limite, canais de texto/voz, proprietário/admin/membro, expulsão e transferência, amizade por @username, aceitar/recusar/cancelar, bloqueio, DM, histórico, editar/excluir mensagens, digitação, WebSocket com reconexão e integração LiveKit para voz/vídeo/tela.

Não está automaticamente publicado. Substitua os arquivos do GitHub pelos arquivos extraídos e faça deploy da API antes do site. O Dockerfile aplica migrations preservando contas existentes; faça backup antes de atualizar. O vercel.json já contém o destino Render informado pelo proprietário: https://warp-railway.onrender.com.

**Voz exige um LiveKit público configurado.** Sem isso, amigos/servidores/texto funcionam, mas não há chamadas pela internet. Veja **VOZ-LIVEKIT.md**. Nenhuma chave real está nos ZIPs. Não inclua os arquivos .env locais no GitHub.

## Documentos
- ATUALIZAR-0.2.md: passo a passo para seus projetos atuais Render/Vercel.
- DEPLOY_RAILWAY.md: instalação inicial da API no Railway e configuração de e-mail. Também mantenha PUBLIC_API_URL no domínio direto da API.
- DEPLOY_VERCEL.md: instalação inicial do site.
- VOZ-LIVEKIT.md: infraestrutura de mídia, portas, TURN e estimativa de banda.
- BUILD_WINDOWS.md: compilação do Tauri no Windows.
- TESTES-RELEASE.md: verificações executadas e limites da entrega.

Compartilhe https://warp-warp.vercel.app depois de confirmar os dois endpoints /health na versão 0.2.0 e testar login/servidor/amizade em duas contas. O computador de desenvolvimento não precisa ficar ligado após publicar API, banco, site e serviço de voz.

Esta entrega não implementa todo o escopo original: cargos personalizados, categorias/canais privados, grupos de DM, anexos/busca no chat, bots, banimentos e push offline continuam pendentes. Sem emojis na interface.
