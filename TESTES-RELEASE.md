# Testes e publicação — 12/10/2026

## Executado nesta entrega

| Verificação | Resultado |
|---|---|
| Testes da API | 30 passaram, 0 falharam; 27 integrações com PostgreSQL real e 3 testes de configuração/transporte de e-mail |
| Build API e site no monorepo | Passou |
| API exportada independente | `npm ci`, Prisma generate e build passaram |
| Site exportado independente | `npm ci` e build com `VITE_API_URL=/api` passaram |
| Desktop exportado independente | `npm ci` e build React/TypeScript passaram; Cargo metadata offline com lockfile resolveu dentro da própria exportação |
| Aplicativo Windows x64 | Build Tauri 2 release concluído com Rust 1.99.0/MSVC; instalador NSIS gerado (2.976.349 bytes) |
| Testes Rust | 2 passaram: restrição de origens/caminhos e gravação/leitura/exclusão de uma credencial descartável no Gerenciador de Credenciais real do Windows |
| Inicialização do executável | Processo permaneceu ativo e criou `msedgewebview2.exe`; encerrado após a verificação |
| Auditoria npm dos pacotes | 0 vulnerabilidades reportadas durante as instalações executadas |

O teste de inicialização não comprova renderização, login completo, bandeja ou notificações pela interface. O controle das janelas do Windows retornou timeout em todas as tentativas, incluindo reinicialização da conexão; não foi possível executar testes visuais nativos. Os testes de navegador da entrega anterior estão registrados em `TESTES-FASE-1.md` no monorepo.

## Tentativa de publicação

**Nenhum site ou API foi publicado nesta execução. Não há URL pública criada.**

- Railway: a integração retornou `USER_NOT_LOGGED_IN` / conta não conectada. O navegador disponível mostrava login. A ferramenta de deploy também exige um repositório GitHub confirmado, ainda não fornecido.
- Vercel: a integração conectada respondeu às consultas de projetos/equipes, ambas vazias. A tentativa de criar o deploy retornou `Unknown tool: vercel.create_deployment`; nenhum deploy foi confirmado. O navegador disponível também estava na tela de login.
- Controle do PC: a listagem de aplicativos do Windows não respondeu, mesmo após a tentativa de recuperação. Não foi possível aproveitar uma eventual sessão aberta em outro navegador.
- Para a API de produção, falta configurar um provedor/remetente de e-mail e suas credenciais no Railway. Nenhuma credencial foi inventada ou incluída na entrega.

## Não executado / ainda indisponível

- Deploy público, build Docker, TLS/rewrite da Vercel e envio real de e-mails por Resend/SMTP.
- Instalação manual do NSIS em outro Windows e fluxo completo de login entre navegador e WebView2. O instalador não possui assinatura comercial de código.
- Testes em dispositivos/redes diferentes.
- Servidores, canais, permissões de comunicação, mensagens, amizades, bots, WebSocket, voz, vídeo e compartilhamento de tela: módulos ainda não implementados nesta Fase 1, portanto não testados.

Execute as validações finais dos guias após publicar. Não trate o instalador ou os ZIPs como comprovação de funcionamento de recursos ainda não implementados.
