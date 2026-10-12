# WARP — pacotes independentes

Esta entrega contém a **Fase 1 funcional (contas, autenticação, perfil e sessões)**, com aplicativo Windows Tauri. Ainda não é a plataforma de comunicação completa: servidores, canais, mensagens, amizades, bots, voz e vídeo dependem das próximas fases.

| Arquivo            | Uso                                                |
| ------------------ | -------------------------------------------------- |
| `warp-api.zip`     | Backend Fastify/PostgreSQL para Railway            |
| `warp-web.zip`     | Site React/Vite para Vercel                        |
| `warp-desktop.zip` | Fontes Tauri e instalador Windows quando compilado |

Cada ZIP contém os pacotes compartilhados necessários, sem depender das pastas dos outros ZIPs. Não há senhas reais, banco local, node_modules ou credenciais nos arquivos.

## Colocar no ar e gerar o link

1. Extraia a API e siga **DEPLOY_RAILWAY.md**: envie os arquivos ao GitHub, crie PostgreSQL e o serviço, configure variáveis e e-mail, publique e gere o domínio HTTPS.
2. Extraia o site e siga **DEPLOY_VERCEL.md**: coloque o domínio Railway no `vercel.json`, envie ao GitHub e importe na Vercel. Use `VITE_API_URL=/api`.
3. Copie o domínio estável gerado pela Vercel para `WEB_URL` e `CORS_ORIGINS` da API. Faça redeploy da API.
4. Teste `/health` da API e `/api/health` no site. Crie conta, confirme e-mail e teste login em outro navegador.
5. Compartilhe **o link de produção do site**, semelhante a `https://seu-warp.vercel.app`. Esse exemplo não é um endereço já publicado. Seus usuários não precisam de conta Railway/Vercel.
6. Para Windows, siga **BUILD_WINDOWS.md** e configure os mesmos domínios públicos no aplicativo.

Depois do deploy de API, PostgreSQL e site, seu computador não precisa permanecer ligado. O desktop acessa o mesmo banco através da API.

## Contas necessárias

Railway, Vercel, GitHub e provedor de e-mail. Verificação e recuperação de senha precisam de remetente autorizado pelo provedor; o domínio gratuito da Vercel não é um domínio de envio de e-mail. Infraestrutura e e-mail estão sujeitos aos planos e limites de suas contas.

O estado da tentativa de publicação está em **TESTES-RELEASE.md**. Compilação local não é serviço publicado: sem URLs reais confirmadas nesse relatório, os pacotes ainda precisam de deploy.

## Atualizações

Mantenha os pacotes na mesma versão. Alterar `VITE_API_URL` exige novo build. Aplique novas migrations no pre-deploy da API. Mantenha backups do PostgreSQL; nunca envie `.env` ou chaves ao GitHub.
