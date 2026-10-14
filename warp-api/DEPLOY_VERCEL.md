> **Atualização 0.2.0:** para os projetos existentes, siga primeiro ATUALIZAR-0.2.md. Configure PUBLIC_API_URL na API e consulte VOZ-LIVEKIT.md para chamadas. O roteiro abaixo documenta a instalação inicial.

# Publicar o site Warp e obter um link para compartilhar

Use o novo `warp-web.zip`, que contém frontend, UI e contratos compartilhados. Ele não depende da pasta da API. Esta entrega publica somente as funcionalidades da Fase 1.

## 1. Configure o destino da API

Extraia o ZIP. Abra o `vercel.json` **na raiz da pasta warp-web**. Troque somente o domínio de exemplo pelo domínio HTTPS real que o Railway gerou:

```json
{
  "source": "/api/:path*",
  "destination": "https://SEU-DOMINIO-REAL.up.railway.app/:path*"
}
```

Preserve `/:path*` no final. Não adicione `/v1` ao destino: o cliente já inclui `/v1`. A API permanece no Railway; a Vercel encaminha as requisições do navegador.

Se o domínio Railway ainda não foi gerado, publique o site com o arquivo de exemplo apenas para descobrir seu endereço Vercel. As funções de conta não funcionarão até substituir o destino e publicar novamente.

## 2. Envie ao GitHub

Crie um repositório `warp-web`. Envie **todo o conteúdo de dentro da pasta warp-web**, incluindo `apps`, `packages`, lockfile, `tsconfig.base.json` e `vercel.json`. O `package.json` deve aparecer na raiz. Não envie o ZIP fechado nem `.env`.

Não selecione `apps/web` como raiz na Vercel: o pacote já tem uma raiz independente com seus workspaces internos.

## 3. Importe na Vercel

Na Vercel: Add New → Project → importe `warp-web`. Configure:

| Campo            | Valor                      |
| ---------------- | -------------------------- |
| Root Directory   | raiz do repositório (`./`) |
| Framework        | Vite                       |
| Node.js          | 24.x                       |
| Install Command  | `npm ci`                   |
| Build Command    | `npm run build`            |
| Output Directory | `apps/web/dist`            |

O `vercel.json` já define comandos e diretório. Em Environment Variables, antes do deploy, adicione para Production:

```dotenv
VITE_API_URL=/api
```

Não use a URL Railway nessa variável para este modo: `/api` faz o navegador usar a mesma origem e a Vercel encaminha a requisição. Não coloque SESSION_SECRET, RESEND_API_KEY nem DATABASE_URL na Vercel.

Clique Deploy. Copie o **domínio de produção estável** exibido no projeto, semelhante a `https://seu-projeto.vercel.app`. O nome pode variar conforme disponibilidade; não existe um endereço previamente reservado neste pacote.

## 4. Autorize o domínio no Railway

Volte às variáveis da API e configure:

```dotenv
WEB_URL=https://DOMINIO-REAL-DO-SEU-SITE.vercel.app
CORS_ORIGINS=https://DOMINIO-REAL-DO-SEU-SITE.vercel.app
COOKIE_SAME_SITE=lax
```

Salve e faça redeploy da API. Se alterou o destino em vercel.json, envie a alteração ao GitHub e espere o novo deploy da Vercel. Se alterou VITE_API_URL, faça novo build/deploy; variáveis Vite são incorporadas no build.

## 5. Compartilhe o link correto

Abra o endereço estável do site em uma janela anônima. Ele deve mostrar o Warp sem pedir login da Vercel. Se pedir login da Vercel, confira Deployment Protection e use a URL de produção; ajuste o escopo para deixar o domínio de produção público. Não é necessário tornar todos os previews públicos.

Compartilhe **o endereço do site Vercel**, não o endereço da API ou `/health`. Para usuário final, a única conta necessária deve ser a conta Warp.

## 6. Confira a conexão

Abra `https://DOMINIO-DO-SITE.vercel.app/api/health`. Deve retornar JSON com `"status":"ok"`. Depois teste cadastro, login, confirmação de e-mail e persistência em dois navegadores.

| Problema                          | Verifique                                                                   |
| --------------------------------- | --------------------------------------------------------------------------- |
| `/api/health` retorna HTML        | Rewrite da API deve vir antes do fallback SPA; confira domínio destino      |
| 502 ou erro de conexão            | Deploy Railway, domínio/porta e endpoint `/health`                          |
| Erro de origem                    | WEB_URL/CORS_ORIGINS devem corresponder ao domínio realmente aberto         |
| Login perde sessão                | VITE_API_URL deve ser `/api`; COOKIE_SAME_SITE=lax; HTTPS nos dois serviços |
| E-mail não chega                  | Resend, domínio remetente verificado, chave, quotas e pasta de spam         |
| Link enviado abre endereço errado | Atualize WEB_URL no Railway e peça novo link                                |

O proxy descrito é para HTTP da Fase 1. A configuração WSS/WebRTC será entregue com as fases de comunicação, sem prometer suporte WebSocket por este rewrite.

Fontes: [Vite na Vercel](https://vercel.com/docs/frameworks/frontend/vite), [rewrites para API externa](https://vercel.com/docs/routing/rewrites), [proteção de deploys](https://vercel.com/docs/deployment-protection).
