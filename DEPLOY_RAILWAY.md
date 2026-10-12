# Publicar a API Warp no Railway

Este pacote é independente: contém `apps/api`, `packages/shared`, migrations, lockfile, Dockerfile e railway.json. Publique **todo o conteúdo da pasta warp-api**, incluindo as subpastas. Não publique somente `apps/api`. Recursos entregues: contas/perfis/sessões da Fase 1. Chat, servidores e voz ainda não existem. O cliente desktop usa esta mesma API.

## 1. Coloque o código no GitHub

Extraia `warp-api.zip`. Crie um repositório `warp-api` no GitHub. Envie o conteúdo da pasta extraída, deixando `package.json`, `Dockerfile` e `railway.json` na raiz do repositório. Você pode usar GitHub Desktop ou “Add file → Upload files” no site. Não envie o ZIP fechado; envie os arquivos extraídos e preserve as pastas. Não inclua `.env`.

## 2. Crie banco e serviço

No Railway, crie um projeto vazio. Adicione PostgreSQL por “New → Database → PostgreSQL”. Depois adicione um serviço por “New → GitHub Repo” e selecione `warp-api`. Mantenha Root Directory na raiz. Railway detectará o Dockerfile.

Se ocorrer uma primeira tentativa de deploy sem variáveis, ela pode falhar: configure as variáveis abaixo e refaça o deploy. Não coloque migrations no build; `railway.json` já usa `npm run db:migrate` como pre-deploy, quando o banco está acessível.

## 3. Prepare e-mail por HTTPS

O Railway só libera SMTP no plano Pro ou superior. Para Free/Trial/Hobby, esta versão suporta Resend por HTTPS. Crie sua conta no provedor, adicione e verifique um domínio de envio, gere uma chave de API e escolha um remetente desse domínio. O domínio de envio de e-mail é diferente do endereço gratuito `.vercel.app`. O remetente de teste do provedor possui restrições e não serve para enviar a todos os usuários.

Fonte: [Railway — rede de saída e e-mail](https://docs.railway.com/networking/outbound-networking). Contrato utilizado: [Resend — enviar e-mail](https://resend.com/docs/api-reference/emails/send-email).

## 4. Variáveis do serviço da API

Em Variables, preencha:

```dotenv
NODE_ENV=production
PORT=8080
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=COLE_UM_SEGREDO_ALEATORIO_AQUI
WEB_URL=https://SEU-SITE.vercel.app
CORS_ORIGINS=https://SEU-SITE.vercel.app
COOKIE_SAME_SITE=lax
MAIL_PROVIDER=resend
RESEND_API_KEY=COLE_SUA_CHAVE_RESEND_AQUI
MAIL_FROM=Warp <noreply@SEU-DOMINIO-VERIFICADO.com>
```

`Postgres` deve ser o nome real do serviço de banco; prefira usar “Add Reference” para selecionar `DATABASE_URL` desse serviço. Não copie a URL do banco local. Não defina `DEV_MAIL_DIR` em produção. A chave de e-mail e o segredo são configurados somente no Railway, nunca no frontend.

Gere o segredo no seu PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Se ainda não tem o endereço da Vercel, use temporariamente `https://example.com` em WEB_URL e CORS_ORIGINS **somente para inicializar o serviço**. Depois substitua pelo endereço de produção real da Vercel e faça redeploy antes de testar contas. Não distribua o site enquanto esses valores forem provisórios.

Se usar SMTP no Railway Pro, configure `MAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` e `MAIL_FROM`, em vez de RESEND_API_KEY.

## 5. Gere o domínio da API

Faça deploy. Em Settings → Networking → Public Networking, clique “Generate Domain”. Use a porta 8080 (ou a PORT que configurou). Copie o domínio HTTPS real exibido, por exemplo `https://warp-api-ALGUM-ID.up.railway.app` — esse exemplo não é um endereço já criado.

Abra `https://DOMINIO-REAL-DA-API/health`. O resultado deve incluir `"status":"ok"`. Erro 503 indica falha de banco; falha no início exige conferir variables, migrations e logs.

## 6. Conecte a Vercel

Siga `DEPLOY_VERCEL.md`. O site usará `/api` e o rewrite de `vercel.json` encaminhará ao domínio Railway. Isso mantém o cookie HttpOnly no domínio visitado pelo navegador, sem depender de cookie de terceiro entre `.vercel.app` e `.railway.app`.

Use em WEB_URL e CORS_ORIGINS exatamente o domínio público estável do site, com `https://` e sem barra final. Para mais de uma origem legítima, separe-as por vírgula. Não use `*`. Mantenha COOKIE_SAME_SITE=lax com o proxy descrito neste guia.

## 7. Validação pública

Abra o site da Vercel numa janela anônima, crie uma conta de teste, confirme o e-mail, feche e reabra o site, altere o perfil, entre em outro navegador e revogue a outra sessão. Teste “Esqueci a senha”. Outra pessoa pode repetir pelo próprio computador; os dados estarão no mesmo PostgreSQL.

Para esta primeira versão, mantenha uma única réplica. O rate limit é local à instância e usa o IP de conexão; atrás de proxy usuários podem compartilhar a mesma cota. A configuração de IP confiável e limite distribuído deve ser concluída antes de uso em escala. Cadastre backups no banco conforme suas necessidades.

## Estado da validação

Build TypeScript e testes locais executados; nenhum deploy na sua conta, imagem Docker ou entrega real por Resend é considerado validado automaticamente. Docker não estava disponível neste ambiente. O envio HTTPS foi testado com transporte controlado, sem enviar e-mails a terceiros. Finalize os testes públicos acima após cadastrar suas variáveis.

Fontes: [Deploy Railway](https://docs.railway.com/quick-start), [pre-deploy](https://docs.railway.com/deployments/pre-deploy-command).
