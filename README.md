# infinityTransmissão

Transmissão em tempo real, em alta qualidade e baixa latência, para assistir com amigos: **tela, câmera e microfone**,
no **computador e no celular**. Tema de Natal em vermelho, branco e preto. Sem anúncios, sem rastreamento e sem gravação.

Para publicar você só precisa de uma conta no **GitHub** e uma no **Render** (o plano gratuito serve).
**Não tem banco de dados, não usa Docker e nenhuma variável de ambiente é obrigatória.**

Tecnologias: Next.js 14 (App Router), React, TypeScript, Tailwind CSS, Socket.IO (só sinalização) e WebRTC nativo.
O vídeo vai direto de um navegador para o outro; o servidor só apresenta os dois.

## Publicar no Render (passo a passo)

1. Envie esta pasta para um repositório no GitHub. Antes, rode `npm install` uma vez no seu computador para criar o
   `package-lock.json` e inclua esse arquivo no commit.
2. No Render: **New +** → **Web Service** → conecte o GitHub e escolha o repositório.
3. Preencha:
   - **Runtime:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `node server.js`
   - **Health Check Path** (em *Advanced*): `/api/health`
4. Clique em **Create Web Service** e espere o deploy. No log deve aparecer `Servidor rodando em http://0.0.0.0:10000`.
5. Pronto: o endereço `https://SEU-SERVICO.onrender.com` é o link para divulgar.

Não é preciso criar nenhuma variável (nem `PORT`: o Render define sozinho). Configurações opcionais estão
[mais abaixo](#configurações-opcionais).

**Sobre o plano gratuito:** o serviço "dorme" depois de cerca de 15 minutos sem acessos, e o primeiro acesso depois
disso demora até ~1 minuto. As salas ficam só na memória do servidor: quando ele reinicia (novo deploy ou depois de
dormir), as salas ativas somem e basta criar outra. Para uso contínuo, escolha um plano pago.

## Como usar

- **Apresentador:** abra o site → **Criar sala** → escolha **Compartilhar tela** ou **Usar câmera**. Envie o código, o
  link ou o QR Code aos amigos.
  - **Microfone:** ligue antes de começar ou durante a transmissão. O áudio da aba/sistema e o microfone são
    misturados e enviados em estéreo. Dá para ligar e desligar o microfone a qualquer momento (ao desligar, o
    aparelho solta o microfone de verdade).
  - **Câmera sobre a tela:** com a tela compartilhada, use **Câmera sobre a tela**. Os espectadores veem um balão com a
    câmera e podem ampliá-lo ou reduzi-lo tocando nele.
  - **Trocar fonte:** troque entre tela e câmera, escolha outra tela/janela/aba ou **Virar câmera** (frontal e traseira no
    celular), sem sair da sala.
  - Também há **Pausar**, **Parar transmissão** e **Encerrar sala**.
- **Espectadores (PC ou celular):** abra o link, ou digite o código de 6 caracteres na página inicial, e escolha um nome.
  Tem volume, tela cheia, Picture-in-Picture e um indicador de qualidade da conexão.

Para enviar o som de uma aba: no Chrome/Edge, escolha **uma aba** e marque *Compartilhar áudio da aba*.

## Qualidade e desempenho

- **Qualidade máxima:** perfis de 480p até **4K a 60 fps** (até 20 Mbps por espectador), com áudio Opus estéreo de 192 kbps.
  O padrão é **Máxima** no computador e **1080p** no celular. A escolha é um teto, não uma promessa.
- **Ajuste automático** a cada 2 segundos, por espectador: perda de pacotes, latência, **CPU do aparelho** e número de espectadores.
  O que não cabe é reduzido em etapas e volta a subir quando a rede se estabiliza.
- **Não envia mais do que a tela de cada espectador mostra:** um celular full HD recebe 1080p mesmo que você
  compartilhe uma tela 4K. Isso poupa o seu computador (cada espectador é uma codificação separada), a internet e a
  bateria de quem assiste.
- **Codecs:** H.264 (hardware) para 60 fps, 1440p+ e câmera; VP9 (texto nítido) nos demais. **Celulares** recebem H.264
  quando possível para decodificar em hardware.
- **Site leve:** sem fontes ou scripts externos, páginas e código divididos por rota, QR Code carregado só quando pedido,
  neve que pausa fora da tela (e cai para 30 quadros no celular), métricas atualizadas só onde aparecem, WebSocket de
  intervalos longos para poupar bateria.
- Dica: com **Máxima**, o computador precisa aguentar codificar 4K. Se esquentar ou o aviso de "aparelho no limite"
  aparecer, escolha 1080p ou 1440p.

## Celular

- **Como espectador:** funciona em Android e iPhone/iPad, com tela cheia, Picture-in-Picture (quando o sistema oferece),
  tela que não apaga durante o vídeo e controles de toque grandes.
- **Como apresentador:** pelo celular você transmite **pela câmera e pelo microfone**. Compartilhar a tela inteira
  depende do sistema (iOS e Android) e do navegador e, na maioria dos celulares, não está disponível; o site detecta
  isso e mostra a opção certa.
- Deixe o navegador aberto e a tela ligada ao transmitir pelo celular: o iPhone e o Android pausam a câmera quando o
  navegador vai para segundo plano (o site mantém a tela acesa por você).
- Câmera, microfone e tela exigem **HTTPS** (o Render já fornece). Para testar em casa use um túnel HTTPS.
- Dá para "instalar" o site na tela inicial do celular (Adicionar à tela inicial).

## Testar

**WebSocket:** na página inicial, o rodapé mostra **Servidor: Conectado** quando o Socket.IO está funcionando.
Também dá para abrir `https://SEU-SERVICO.onrender.com/api/health` (deve mostrar `{"status":"ok"}`) ou, no
navegador, DevTools → Network → **WS**, onde deve aparecer `socket.io/?EIO=4&transport=websocket` com status **101**.

**Entre dois dispositivos:**
1. No computador (Chrome ou Edge), crie a sala, ligue o microfone e clique em **Compartilhar tela**.
2. No celular, abra o link ou escaneie o **QR Code**, digite um nome e entre. A imagem aparece em poucos segundos
   e a qualidade sobe nos primeiros segundos.
3. Teste volume, tela cheia, Picture-in-Picture, **Pausar**, **Câmera sobre a tela** e **Trocar fonte**.
4. Teste o celular como apresentador: crie uma sala nele, escolha **Usar câmera** e **Virar câmera**.
5. Teste a reconexão: desligue o Wi-Fi do celular por alguns segundos e ligue de novo; ele volta para a mesma sala.

## Rodar no seu computador (opcional)

Requer Node 18.18 ou superior.

```bash
npm install
npm run dev        # http://localhost:3000
```

Tela, câmera e microfone só funcionam em HTTPS ou em `localhost`. Abrir `http://192.168.x.x:3000` em outro aparelho
permite **assistir**, mas não **transmitir**. Para testar tudo entre aparelhos sem publicar, use um túnel HTTPS, como
`cloudflared tunnel --url http://localhost:3000` ou `ngrok http 3000`.

## Domínio próprio

No Render: serviço → **Settings** → **Custom Domains** → **Add Custom Domain**, e crie no seu provedor de DNS o
registro que o Render indicar (normalmente um `CNAME`). O HTTPS é emitido automaticamente e os links das salas já
usam o domínio em que o site está aberto.

## Atualizar o projeto

Faça commit e `git push`: o Render publica a nova versão sozinho. Ou use **Manual Deploy** → **Deploy latest commit**.
Quem estiver numa sala ao reiniciar precisa criar uma nova (as salas ficam só na memória).

## Configurações opcionais

Cadastre em **Environment** no Render (ou num arquivo `.env` local) só o que quiser mudar:

| Variável | Para que serve | Padrão |
|---|---|---|
| `ROOM_INACTIVITY_MINUTES` | minutos sem ninguém na sala até ela expirar | `60` |
| `MAX_VIEWERS` | espectadores por sala | `8` |
| `ALLOWED_ORIGIN` | endereço do site, para liberar o WebSocket (sem ela, só a mesma origem, o que já é seguro) | vazio |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | servidor TURN próprio | vazio |
| `NEXT_PUBLIC_CHRISTMAS` | `off` desliga o tema de Natal (precisa de novo deploy) | ligado |

**TURN:** o site usa STUN público. Se algum amigo não conseguir ver a transmissão (comum em 4G de algumas operadoras e
redes de empresas), configure um TURN (coturn em uma VPS, ou um serviço como Metered ou Twilio). `TURN_URL` aceita
várias URLs separadas por vírgula, por exemplo `turn:turn.exemplo.com:3478,turns:turn.exemplo.com:5349`. As credenciais
não ficam no código do site: o servidor as entrega só a quem entra numa sala. O TURN faz o vídeo passar pelo servidor dele.

## Limitações importantes

- **A aba do apresentador precisa continuar aberta.** No computador a transmissão segue se ele trocar de aba ou
  minimizar o navegador, mas para se a aba for fechada. Nada é capturado com o site fechado.
- **Muitos espectadores:** cada um recebe uma conexão enviada pelo aparelho do apresentador, por isso o limite padrão
  é 8. Em 4K, quanto mais espectadores, mais o site reduz a resolução enviada para o aparelho aguentar.
- **iPhone e iPad:** o vídeo recebido pode pausar ao sair do navegador. No Android o comportamento varia.
- **Qualidade real:** depende do seu upload. Para 4K a 60 fps com vários espectadores é preciso internet e computador fortes.

## Como funciona (resumo)

- `server.js` roda o Next.js e o Socket.IO no mesmo servidor HTTP (porta `PORT`, endereço `0.0.0.0`), responde ao
  health check, redireciona HTTP para HTTPS e encerra com segurança no `SIGTERM`.
- `server/` guarda as salas na memória, valida entradas, limita abusos (rate limit simples) e repassa a sinalização WebRTC.
- `src/lib/capture.ts` captura câmera e mistura áudio (aba/sistema + microfone) em uma faixa estéreo única.
- `src/lib/webrtc.ts` envia vídeo principal, áudio e câmera-balão para cada espectador, com qualidade adaptativa,
  ICE restart e reconexão automática. `src/lib/room-session.ts` junta Socket.IO, captura e WebRTC no navegador.
- **Segurança e privacidade:** nenhum vídeo ou áudio é gravado ou armazenado; a senha da sala (opcional) fica só como
  hash na memória; código, nome e mensagens de sinalização são validados; o WebSocket aceita só a própria origem;
  câmera e microfone só ligam com a sua permissão e o microfone é solto ao desligar; não há anúncios, scripts de
  terceiros nem fontes externas.
- **SFU no futuro:** para muitas pessoas, troque `HostBroadcaster` e `ViewerReceiver` (em `src/lib/webrtc.ts`) por um
  cliente de LiveKit, mediasoup ou Janus. O restante da interface não muda.

## Tema de Natal

Neve na página inicial (com botão para desligar e respeitando "reduzir movimento"), gorro no logotipo e no apresentador,
fita de bengala de doce e contagem regressiva. Dentro da sala nada é animado, para não competir com a transmissão.
Para remover tudo, use `NEXT_PUBLIC_CHRISTMAS=off` e faça um novo deploy.

## Problemas comuns

- **"Servidor offline":** o serviço pode estar acordando (plano gratuito). Espere um minuto e recarregue.
- **Vídeo não abre em redes diferentes:** configure o TURN.
- **Sem áudio:** compartilhe uma **aba** e marque *Compartilhar áudio da aba* (Chrome/Edge), ou ligue o microfone.
  Em alguns sistemas o áudio da tela inteira não é oferecido.
- **Câmera ou microfone bloqueados:** clique no cadeado ao lado do endereço, libere o acesso e tente de novo.
- **Computador esquentando ou travando:** reduza a qualidade (1080p) ou o número de espectadores.
- **Build falhou no Render:** abra o log do deploy. Erros de tipo não derrubam o build; para vê-los, rode `npx tsc --noEmit`.
