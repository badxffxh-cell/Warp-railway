# Validação WARP 0.2.0 — 13 e 14/10/2026

## Executado e aprovado

- Build TypeScript da API, shared e UI; build Vite do site e frontend desktop.
- npm ci e build em cada pacote exportado, em pastas independentes. Prisma Client gerado no pacote da API. Nenhum depende das pastas dos demais ZIPs.
- **41 testes automatizados**, PostgreSQL real no banco dedicado warp_test. Rodados na fonte e novamente no pacote da API exportado. Nenhum teste pulado.
- Autenticação Argon2id, login, cookies persistentes, renovação/revogação, CSRF, recuperação/verificação, perfil, avatar e exclusão de conta continuam cobertos.
- Servidor cria canais texto/voz; terceiros não acessam; convite de uso único sob joins concorrentes; proprietário concede administrador; membro não escala privilégio; admin não exclui servidor.
- Mensagens persistidas e entregues por WebSocket real; reenvio idempotente; edição só pelo autor; exclusão moderada; paginação; revogação de sessão e ticket de uso único.
- Amizades por @username normalizado; somente destinatário aceita; terceiros não acessam DM; bloqueio revoga conversa e impede pedidos; expulsão revoga acesso.
- Voz sem configuração retorna 503 VOICE_UNAVAILABLE com mensagem sobre LiveKit, sem simular conexão.
- Navegador local: login, recebimento/aceite de amizade, envio de DM, recebimento ao vivo de mensagem de segunda conta, criação de servidor com canais automáticos e aviso visual de chamada. Layout compacto e desktop inspecionados.
- **LiveKit Server 1.13.9 local**: dois clientes RTC Node reais transmitiram tons sintéticos via WebRTC/Opus nas duas direções. Última execução: 218 e 221 frames recebidos, energia de áudio não nula em ambos. Desconexão por moderador e entrada em sala privada de amigos aprovadas.
- Instalador Windows x64 Warp_0.2.0_x64-setup.exe compilado com Tauri 2/NSIS. Incluído em warp-desktop/instalador/.
- Teste Rust restrict_origins_and_paths passou, incluindo novas rotas e paginação. Resultados não foram simulados.

## Não executado / limites

- Não publicado automaticamente nos projetos de produção. Atualize os repositórios e espere Render/Vercel concluírem o deploy.
- Não testados microfones físicos, câmera/tela, áudio entre aparelhos diferentes, Wi-Fi/dados móveis distintos, NAT/TURN na internet ou chamada entre navegador e WebView2. Teste local com áudio sintético não comprova essas condições.
- Compilar o instalador não comprova todos os fluxos nativos de microfone, compartilhamento e notificações. Validar no Windows de destino.
- Sem teste de carga, múltiplas réplicas, execução Docker neste host ou garantia de capacidade em hospedagem gratuita. Esta versão exige uma única instância da API.
- Vite avisou sobre chunk de voz com aproximadamente 570 kB antes de gzip; carregado sob demanda. Build concluído.
- Funções ainda ausentes estão em ATUALIZAR-0.2.md. Esta versão não é a plataforma completa do pedido inicial.

## Reproduzir

Na API, configure DATABASE_URL e TEST_DATABASE_URL em apps/api/.env. O segundo deve terminar em _test e ser um banco dedicado, nunca produção. Execute npm ci, npm run db:generate, npm run build e npm test. O runner aplica migrations no banco de teste.

Para áudio, configure um LiveKit somente local e inicie a API em localhost:3001, com origem localhost:5173 e e-mail de desenvolvimento. Instale @livekit/rtc-node@1.1.0 num ambiente de teste e execute node apps/api/scripts/test-voice-local.mjs. O script cria contas temporárias em localhost, transmite tons e apaga seus próprios dados. Resultado em voice-test-result.json. Não usa microfone nem comprova chamadas entre dispositivos.

No Windows com Rust/MSVC, execute cargo test --release --manifest-path apps/desktop/src-tauri/Cargo.toml restrict_origins_and_paths. No pacote desktop, npm run desktop:build gera o instalador.
