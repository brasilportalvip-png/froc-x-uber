# Froc X Uber — como deixar no ar

O app agora é uma plataforma de verdade: cada pessoa tem conta própria com login e senha. Motoristas e
caminhoneiros só trabalham depois que você aprova os documentos, e o dinheiro passa pela carteira com
valor retido até o serviço ser concluído. Nada mais é simulado.

Para funcionar, ele precisa de 3 serviços externos. Todos têm plano gratuito para começar.

---

## 1. Firebase (login, banco de dados e documentos)

1. Entre em <https://console.firebase.google.com> e clique em **Adicionar projeto**. Nome sugerido: `froc-x-uber`.
2. Menu **Authentication → Começar → E-mail/senha → Ativar**.
3. Menu **Firestore Database → Criar banco de dados → modo de produção → região `southamerica-east1` (São Paulo)**.
   Depois, na aba **Regras**, cole o conteúdo do arquivo `firestore.rules` e publique.
4. Menu **Storage → Começar**. Na aba **Regras**, cole o conteúdo de `storage.rules` e publique.
   (O Storage pode pedir para ativar o plano Blaze, que é pago por uso. Com poucos usuários o custo fica perto de zero.)
5. **Configurações do projeto (engrenagem) → Seus apps → ícone `</>` (Web)**. Registre o app e copie o
   objeto `firebaseConfig`. Ele vira a variável **FIREBASE_WEB_CONFIG** em formato JSON, por exemplo:
   `{"apiKey":"AIza...","authDomain":"froc-x-uber.firebaseapp.com","projectId":"froc-x-uber","storageBucket":"froc-x-uber.firebasestorage.app","appId":"1:..."}`
6. **Configurações do projeto → Contas de serviço → Gerar nova chave privada**. Abra o arquivo baixado e
   copie o conteúdo inteiro para a variável **FIREBASE_SERVICE_ACCOUNT_KEY**.
   ⚠️ Esse arquivo dá acesso total ao banco: nunca o coloque no GitHub nem mande por chat.
7. **Authentication → Configurações → Domínios autorizados**: adicione o domínio onde o site vai ficar.

## 2. Administração

Na variável **ADMIN_EMAILS**, coloque o seu e-mail (ou vários, separados por vírgula). Depois:
1. Crie sua conta no app com esse e-mail.
2. Confirme o e-mail pelo link que o Firebase envia.
3. A aba **Admin** aparece. Lá você aprova motoristas e caminhoneiros (vendo CNH, CRLV e ANTT) e marca os saques como pagos.

## 3. Mercado Pago (recargas por Pix e cartão)

1. Em <https://www.mercadopago.com.br/developers>, abra **Suas integrações → Criar aplicação** (tipo *Checkout Pro*).
2. Em **Credenciais de produção**, copie o **Access Token** (`APP_USR-...`) para **MERCADO_PAGO_ACCESS_TOKEN**.
   Para testar sem dinheiro de verdade, use primeiro o token das **Credenciais de teste**.
3. Em **Webhooks**, configure a URL `https://SEU-SITE/api/webhooks/mercadopago` com o evento **Pagamentos**
   e copie a **assinatura secreta** para **MERCADO_PAGO_WEBHOOK_SECRET**.
4. Em **PUBLIC_SITE_URL**, coloque o endereço do site (ex.: `https://froc-x-uber.onrender.com`), sem barra no final.

Sem essas variáveis, o app funciona, mas a recarga da carteira fica desativada (aparece o aviso "em configuração").
Corridas e negociações em dinheiro continuam funcionando normalmente.

## 4. Google Maps

A chave **VITE_GOOGLE_MAPS_API_KEY** é a mesma que você já usa no AI Studio (Maps JavaScript, Routes e Places).

## 5. Prazos automáticos (opcional, recomendado)

O app cancela sozinho (e devolve o dinheiro) as corridas que ficam sem motorista e expira negociações
sem resposta. Isso já acontece sempre que alguém abre o app. Para garantir que rode mesmo de madrugada:
1. Crie a variável **CRON_SECRET** com uma senha longa qualquer.
2. Em <https://cron-job.org> (grátis) ou no **Cron Job** do Render, agende a cada 5 minutos uma chamada
   **POST** para `https://SEU-SITE/api/cron/sweep`, com o cabeçalho `x-cron-key: <a mesma senha>`.

## 6. Publicar

O app tem servidor próprio (Node.js + Express). Funciona em qualquer serviço de hospedagem Node. O mais simples é o **Render**:

1. Em <https://render.com>, escolha **New → Web Service** e conecte o repositório `froc-x-uber`.
2. Configure:
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
3. Em **Environment**, adicione todas as variáveis acima, mais `NODE_ENV=production`.
4. Depois do primeiro deploy, coloque o endereço gerado em `PUBLIC_SITE_URL`, nos domínios autorizados do Firebase e no webhook do Mercado Pago.

Também funciona no Google Cloud Run (onde o AI Studio publica), com as mesmas variáveis.

## Como o dinheiro funciona

| Situação | O que acontece |
|---|---|
| Passageiro paga pela carteira | O valor sai do saldo e fica **retido** até o serviço terminar |
| Serviço concluído | O motorista ou caminhoneiro recebe **88%**; a plataforma fica com 12% |
| Cancelamento antes do fim | O valor retido **volta inteiro** para quem pagou |
| Corrida paga em dinheiro | O motorista recebe em mãos e a taxa de 12% sai da carteira dele |
| Saque | O valor sai do saldo; você faz o Pix e marca "Já paguei" no Admin |

## O que o Admin faz

- **Pendências:** aprovar ou recusar motoristas e caminhoneiros (vendo os documentos) e pagar os saques por Pix.
- **SOS:** alertas de emergência com nome, telefone, viagem, placa e localização no mapa.
- **Usuários:** buscar e bloquear ou desbloquear contas, sempre com motivo.
- **Relatórios:** serviços concluídos, volume movimentado e receita da plataforma por modalidade (7, 30 ou 90 dias).
- **Configurações:** comissão, preço dinâmico (liga/desliga e limite), prazos automáticos e regras de pontos.

## Como funciona o mapa por regiões (H3)

O app usa o **H3**, biblioteca aberta da Uber que divide o mapa em hexágonos de ~0,7 km².
- **Despacho:** o motorista online (com a localização do celular ligada) vê os pedidos num raio de ~3,5 km.
- **Preço dinâmico:** se na região do passageiro há mais pedidos que motoristas, o preço sobe (até o limite
  configurado no Admin). O valor sempre aparece antes de confirmar.
- **Ao vivo:** o celular do motorista envia a posição a cada ~10 segundos, e o passageiro vê o carro no mapa.

## Testes

`npm test` roda 35 testes automáticos das regras de negócio: dinheiro retido e liberado, estornos, permissões,
PIN, aprovação de motoristas, recarga só depois de aprovada, assinatura do Mercado Pago, despacho e preço
dinâmico por região, prazos automáticos, SOS, avaliação dos dois lados, pontos, bloqueio, relatórios e preços mínimos.

## Antes de abrir ao público

- Preencha os campos entre colchetes em `public/legal/termos.html` e `public/legal/privacidade.html`
  (razão social, CNPJ, endereço, e-mail e encarregado de dados) e peça a revisão de um advogado.
- Verifique as regras da sua cidade para transporte por aplicativo (Lei 13.640/2018) e a ANTT para fretes.
- Confirme com um contador como a plataforma deve emitir nota da taxa de 12%.
