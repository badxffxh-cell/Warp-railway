# Voz, vídeo e tela no WARP

WARP usa WebRTC com **LiveKit open-source self-hosted**, sem API cobrada por minuto. O mesmo SFU atende chamadas privadas e canais de até 20 participantes. O cliente publica áudio Opus com alvo de 32 kbps, DTX/RED, cancelamento de eco e supressão de ruído. Vídeo/tela usam adaptação de qualidade. A permissão de entrada é emitida pela API somente para membro do canal ou amizade aceita.

## Produção

A hospedagem HTTP da API não substitui o servidor de mídia. Você precisa de uma VM Linux pública, domínio para voz, TLS e portas de mídia acessíveis. O deploy atual da API no Render e o site na Vercel continuam iguais.

1. Siga o gerador oficial: https://docs.livekit.io/transport/self-hosting/vm/ . Ele prepara LiveKit, TLS e TURN para uma VM. Use uma máquina dedicada ou adapte cuidadosamente o arquivo gerado; não substitua um servidor existente sem conferir o conteúdo.
2. Crie os registros DNS solicitados pelo gerador para a VM, por exemplo `voice.seudominio.com` e o domínio TURN indicado. O domínio gratuito `warp-warp.vercel.app` não permite criar esses subdomínios fora da Vercel.
3. Libere somente as portas indicadas pela configuração gerada. Referência: https://docs.livekit.io/transport/self-hosting/ports-firewall/ . A API de sinalização 7880 deve ficar atrás do proxy TLS; mídia usa ICE/UDP e fallback TCP/TURN. Não basta expor apenas HTTPS.
4. Gere e guarde a chave/segredo LiveKit na VM. Configure os mesmos valores no **Render → Warp-railway → Environment**:

```dotenv
LIVEKIT_URL=wss://voice.seudominio.com
LIVEKIT_API_KEY=chave-gerada-no-servidor
LIVEKIT_API_SECRET=segredo-aleatorio-com-pelo-menos-32-caracteres
```

5. Faça redeploy da API. As chaves nunca vão para Vercel ou para o aplicativo. Cada usuário recebe somente um token de sala temporário.
6. Abra o WARP em dois dispositivos: um no Wi-Fi e outro em dados móveis. Entre no mesmo canal ou inicie uma chamada entre amigos. Permita o microfone após clicar para entrar/atender. Confirme áudio nas duas direções; depois teste câmera, tela e reconexão.
7. Teste também uma rede restritiva para validar TURN. Uma chamada local aprovada não comprova NAT/TURN na internet.

O gerador oficial suporta TURN integrado ao LiveKit; não é necessário manter coturn separado nesse modo. Use WSS e certificado público válido. Para verificar participantes/falhas, consulte logs do LiveKit sem expor tokens.

## Custo e tráfego

Custos são VM, IPv4/domínio quando cobrados, armazenamento/logs e tráfego excedente. Não existe cobrança por minuto pelo software self-hosted. Verifique franquia e preço do provedor antes de contratar.

Estimativa de áudio contínuo a 32 kbps: um fluxo consome aproximadamente **14,4 MB/h** de payload. Se todos falarem ao mesmo tempo, saída do SFU ≈ `N × (N−1) × 14,4 MB/h`: 10 pessoas ≈ 1,3 GB/h, antes de overhead. DTX reduz silêncio. Vídeo de 1 Mbps representa ~450 MB/h por fluxo recebido; tela e várias câmeras aumentam muito o tráfego. TURN retransmite mídia e pode somar banda entre servidores, dependendo da topologia e cobrança. São estimativas, não uma cotação ou capacidade garantida.

## Teste local executado

LiveKit Server 1.13.9 no Windows, dois clientes nativos RTC Node e áudio sintético transmitido por WebRTC real. Houve recebimento de áudio nas duas direções, desconexão por moderador e conexão à sala privada de amigos. Isso não testa microfones físicos, câmera, compartilhamento de tela, Windows WebView2 nem aparelhos em redes distintas. Consulte TESTES-RELEASE.md.

## Limitações operacionais

Uma sala por sessão do WARP. A integração faz manutenção de permissões a cada 15 segundos e não depende de estado local do navegador para autorizar. Reservar chave/projeto LiveKit exclusivo para o WARP evita conflitos com a limpeza de salas `warp-*`. Use uma única réplica da API nesta versão. LiveKit/VM indisponível impede chamadas; a interface apresenta o erro e o chat continua independente.
