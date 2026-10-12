# Warp para Windows

O pacote `warp-desktop.zip` contém o código Tauri 2, a interface compartilhada e seus contratos. Não precisa das pastas dos outros ZIPs. Esta versão oferece contas, perfis e sessões da Fase 1. Chat, servidores, chamadas, câmera e compartilhamento de tela ainda não foram implementados.

## Usar o instalador

Se a pasta `instalador` estiver presente, execute `Warp_0.1.0_x64-setup.exe`. Ele instala para seu usuário e pode baixar o WebView2 oficial da Microsoft se necessário. A compilação não tem certificado comercial de assinatura de código.

Na primeira abertura, preencha:

1. **Endereço da API:** domínio HTTPS gerado pelo Railway, sem `/v1` ou `/health`.
2. **Endereço do site:** domínio HTTPS de produção da Vercel, igual ao `WEB_URL`/`CORS_ORIGINS` da API.
3. Salve a conexão e entre na sua conta. O site e o aplicativo usam as mesmas contas.

O endereço da API deve ser direto para o Railway; não use `/api` aqui. O aplicativo verifica `/health` antes de salvar a conexão. Em produção exige HTTPS.

Marque **Manter conectado** para persistir a sessão no Gerenciador de Credenciais do Windows. A credencial não vai para localStorage nem para o JavaScript da interface. Sem essa opção, a sessão fica somente na memória até encerrar o processo. Fechar a janela mantém o Warp na bandeja; selecione **Sair** no menu da bandeja para encerrar. A configuração fica em `%APPDATA%\app.warp.desktop\connection.json`, sem senhas.

**Conexão** permite alterar os endereços e testar notificações nativas. Trocar a conexão remove a credencial local anterior; revogue sessões antigas pela conta, se necessário. Notificações de mensagens serão conectadas quando o módulo de mensagens existir. Links de verificação e recuperação de e-mail abrem o site; conclua a ação lá e volte ao aplicativo.

## Compilar no Windows

Instale Node.js 24 LTS, Rust stable para `x86_64-pc-windows-msvc`, Visual Studio Build Tools com **Desenvolvimento para desktop com C++**, Windows SDK e WebView2 Runtime. Reinicie o terminal após instalar as ferramentas.

Abra o PowerShell na raiz extraída `warp-desktop`:

```powershell
npm.cmd ci
npm.cmd run desktop:build
```

Instalador: `apps/desktop/src-tauri/target/release/bundle/nsis/`. Executável: `apps/desktop/src-tauri/target/release/warp-desktop.exe`.

Para desenvolvimento:

```powershell
npm.cmd run desktop:dev
```

Somente builds de desenvolvimento aceitam HTTP em localhost/127.0.0.1. O instalador exige API remota HTTPS, sem servidor Node no computador do usuário.

## Verificação antes de distribuir

Teste em outro Windows: instalar, configurar API, entrar, marcar Manter conectado, encerrar pela bandeja, reabrir, alterar perfil e conferir a alteração no site. Revogue a sessão do desktop pelo navegador e confirme que o aplicativo exige login. Teste login temporário, avatar, bandeja e notificação.

`TESTES-RELEASE.md` informa o que foi executado. Build não equivale a teste manual de todos os recursos no WebView2. Não há teste de voz entre redes porque o módulo ainda não existe.

Referências: [pré-requisitos](https://v2.tauri.app/start/prerequisites/), [instalador Windows](https://v2.tauri.app/distribute/windows-installer/), [bandeja](https://v2.tauri.app/learn/system-tray/).
