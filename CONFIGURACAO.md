# Froc X Uber — como deixar no ar (Vercel + Firebase)

Site: **https://froc-x-uber.vercel.app**

O app tem duas partes, e a Vercel publica as duas a cada merge na `main`:
- as **telas**, em React;
- o **servidor** (`/api`), que confere o login, guarda os dados no Firebase e cuida do dinheiro.

Tudo é configurado em **Vercel → projeto froc-x-uber → Settings → Environment Variables**. Depois de mudar
qualquer variável, faça **Redeploy**.

Para conferir o que está configurado, abra **https://froc-x-uber.vercel.app/api/health**. Essa página mostra
`true` ou `false` para cada item e nunca mostra os valores secretos.

---

## 1. Firebase (usando o projeto que você já tem)

Projeto: **Magia Das Crencas** (`gen-lang-client-0138178639`).
Os dados do Froc ficam em coleções próprias, com nomes começando por `froc_` (`froc_users`, `froc_rides`...),
e os documentos dos motoristas ficam na pasta `froc-x-uber/` do Storage. O outro app não é alterado.

### 1.1 Login por e-mail e senha
**Authentication → Método de login → E-mail/senha → Ativar.**
Em **Authentication → Configurações → Domínios autorizados**, adicione `froc-x-uber.vercel.app`.

Opcional, mas recomendado: **Authentication → Método de login → Google → Ativar**. Assim aparece o botão
**Entrar com Google** (o e-mail já vem confirmado pelo Google). Esse botão só funciona com o domínio autorizado acima.

### 1.2 Configuração web (pública)
Variável **FIREBASE_WEB_CONFIG**, numa linha só:
```
{"apiKey":"AIzaSyCdawPH99resDcxlPPDuTtDqy0VNheZdqw","authDomain":"gen-lang-client-0138178639.firebaseapp.com","projectId":"gen-lang-client-0138178639","storageBucket":"gen-lang-client-0138178639.firebasestorage.app","messagingSenderId":"544757898188","appId":"1:544757898188:web:38e80cbbadcec1460f9b69"}
```

### 1.3 Chave do servidor (secreta)
**Configurações do projeto → Contas de serviço → Gerar nova chave privada.** Abra o arquivo `.json` baixado,
copie todo o conteúdo e cole na variável **FIREBASE_SERVICE_ACCOUNT_KEY**.
⚠️ Essa chave dá acesso total ao projeto, inclusive ao outro app. Cole só na Vercel. Nunca no GitHub, no chat ou em print.

### 1.4 Qual banco de dados
Abra **Firestore**. No topo aparece o nome do banco:
- se for **(default)**, não precisa fazer nada;
- se for outro nome (projetos do AI Studio costumam usar algo como `ai-studio-...`), crie a variável
  **FIRESTORE_DATABASE_ID** com esse nome.

### 1.5 Regras de segurança: NÃO substitua as regras do outro app
O servidor do Froc acessa o banco com a chave de serviço, que não depende das regras. Então **não cole**
os arquivos `firestore.rules` e `storage.rules` por cima das regras atuais: isso quebraria o Magia Das Crenças.

Mas confira uma coisa. Se as regras atuais tiverem algo como
`match /{document=**} { allow read, write: if request.auth != null; }`, qualquer pessoa logada consegue ler
**todas** as coleções, inclusive as do Froc (saldos, telefones). Se encontrar isso no Firestore ou no Storage,
me mande as regras (elas não são secretas) para eu ajustar sem quebrar o outro app.

> Recomendação: o mais seguro é criar um projeto Firebase **só para o Froc X Uber**. Leva 5 minutos, pode usar
> a mesma conta de cobrança (Blaze) e evita que os dois apps compartilhem usuários, regras e chave de servidor.

## 2. Administração
Variável **ADMIN_EMAILS** = `brasilportalvip@gmail.com` (pode ter vários e-mails, separados por vírgula).
Pode colar com ou sem aspas, com vírgula ou ponto e vírgula entre vários e-mails.

A aba **Admin** aparece quando o e-mail está nessa lista **e** está confirmado:
- **Entrar com Google** com esse e-mail: já entra confirmado, a aba aparece na hora.
- **E-mail e senha** (inclusive conta que já existia no outro app): em **Conta**, toque em
  **Enviar link de confirmação**, abra o link no e-mail e volte ao site. A aba aparece sozinha em alguns segundos.

Para conferir sem mostrar o e-mail: `/api/health` mostra `"adminEmailsCount": 1`.

## 3. Google Maps
Variável **VITE_GOOGLE_MAPS_API_KEY**: a mesma chave que você usa no AI Studio. No Google Cloud, a chave
precisa permitir o domínio `froc-x-uber.vercel.app`.

## 4. Mercado Pago (pode ser depois)
- **MERCADO_PAGO_ACCESS_TOKEN**: em mercadopago.com.br/developers → Suas integrações → Credenciais.
  Comece com o token **de teste**.
- Em **Webhooks**, cadastre a URL `https://froc-x-uber.vercel.app/api/webhooks/mercadopago` com o evento
  **Pagamentos** e copie a assinatura secreta para **MERCADO_PAGO_WEBHOOK_SECRET**.
- **PUBLIC_SITE_URL** = `https://froc-x-uber.vercel.app` (opcional na Vercel, que já informa o domínio).

Sem o Mercado Pago, o app funciona, mas a recarga da carteira aparece como "em configuração".

## 5. Prazos automáticos (recomendado)
Crie **CRON_SECRET** com uma senha longa. Em <https://cron-job.org> (grátis), agende a cada 5 minutos:
**POST** `https://froc-x-uber.vercel.app/api/cron/sweep`, com o cabeçalho `x-cron-key: <a senha>`.
Assim, corridas sem motorista são canceladas e estornadas mesmo quando ninguém está com o app aberto.

## 6. Resumo das variáveis

| Variável | Obrigatória | Onde pegar |
|---|---|---|
| FIREBASE_WEB_CONFIG | sim | item 1.2 (já pronta acima) |
| FIREBASE_SERVICE_ACCOUNT_KEY | sim | item 1.3 |
| FIRESTORE_DATABASE_ID | só se o banco não for (default) | item 1.4 |
| ADMIN_EMAILS | sim | seu e-mail |
| VITE_GOOGLE_MAPS_API_KEY | sim | Google Cloud / AI Studio |
| MERCADO_PAGO_ACCESS_TOKEN | para recargas | Mercado Pago |
| MERCADO_PAGO_WEBHOOK_SECRET | para recargas | Mercado Pago |
| CRON_SECRET | recomendado | você inventa |
| GEMINI_API_KEY | para a Equipe IA, o atendimento e o blog | a mesma chave da Froc.IA (Google AI Studio → Get API key) |
| GEMINI_MODEL | não | deixe vazio (usa os modelos da Froc.IA automaticamente) |
| GOOGLE_SITE_VERIFICATION | para o Google Search Console | só o código da metatag (item 7) |
| BING_SITE_VERIFICATION | para o Bing Webmaster | só o código da metatag (item 7) |

## 7. Equipe IA, atendimento e blog

**Ligar a IA:** cadastre `GEMINI_API_KEY` na Vercel (a mesma chave da Froc.IA) e faça **Redeploy**.
O `/api/health` passa a mostrar `"ai": true`.

**Equipe IA (Admin → 🤖 Equipe IA):** a Froc central e 19 especialistas (atendimento, cadastros,
financeiro, antifraude, SOS, manutenção, preços, marketing/SEO, redes sociais, relatórios, jurídico/LGPD...).
Todos falam com a voz da Froc e consultam o sistema de verdade.
- Eles **leem tudo**, respondem pessoas, resolvem SOS, escrevem posts e anotam pendências **sozinhos**.
- **Dinheiro, banimento, aprovação de cadastro e configurações** ficam em
  **"Aguardando sua aprovação"**: nada disso acontece sem o seu toque em **Aprovar**.
- Tudo fica em **Admin → Auditoria** (quem fez, o quê, quando — pessoa ou agente).
- Eles não veem as fotos dos documentos: confira as imagens antes de aprovar um cadastro.

**Atendimento:** o botão rosa no canto do app abre o chat com a Froc. Ela responde na hora com os dados
da conta da própria pessoa e chama a equipe quando precisa (Admin → Atendimento).
Limite: 60 mensagens por pessoa por dia (protege a sua conta do Gemini).

**Blog diário:** o mesmo agendador do item 5 dispara, a partir das 7h, 1 post por dia em `/blog`, com SEO
(título, descrição, palavra-chave, perguntas frequentes, dados estruturados) e avisa o Bing na hora (IndexNow).
Post fora do padrão vira rascunho em vez de ir ao ar. Admin → Blog e SEO: gerar outro na hora, publicar ou tirar do ar.
Relatório diário da Froc: Admin → Equipe IA → Relatórios diários.

**Google Search Console (dia 1):**
1. <https://search.google.com/search-console> → **Adicionar propriedade** → **Prefixo do URL** → `https://froc-x-uber.vercel.app/`.
2. Método **Tag HTML**: copie só o código de dentro de `content="..."`, cadastre em `GOOGLE_SITE_VERIFICATION` na Vercel e faça **Redeploy**. Volte e clique **Verificar**.
3. Em **Sitemaps**, envie `sitemap.xml`.
4. Em **Inspeção de URL**, peça indexação da página inicial, de `/blog` e das 4 páginas de serviço.

**Bing Webmaster (dia 1):** <https://www.bing.com/webmasters> → **Importar do Google Search Console**
(ou use a metatag em `BING_SITE_VERIFICATION`). Envie o `sitemap.xml`. O IndexNow já está ligado.

**Sobre "1º lugar":** nenhum sistema garante a primeira posição no Google ou no Bing. O que está pronto é a
parte técnica perfeita + 1 conteúdo útil por dia + aviso imediato aos buscadores. A posição vem com o tempo,
com **links de outros sites** (parceiros, imprensa local, perfis da marca) e com gente usando o app.
Se trocar para um domínio próprio, atualize `PUBLIC_SITE_URL`, o `robots.txt` e o `index.html` (canonical).

## 8. Proteção
- Cabeçalhos de segurança no site inteiro (HTTPS obrigatório, anti-clickjacking, anti-sniffing, permissões do navegador).
- Política de conteúdo (CSP) em modo **observação**: registra no console o que seria bloqueado, sem quebrar nada.
- Limites por conta que valem para todos os servidores: recargas, saques, SOS, documentos, cadastro, atendimento e Equipe IA.
- Auditoria de toda ação administrativa (pessoa ou IA). Agente de IA nunca aprova a própria proposta.
- Na Vercel: **Settings → Security → Attack Challenge Mode** liga um desafio anti-robô se o site sofrer ataque.
- No Firebase: **Authentication → Configurações → Proteção contra enumeração de e-mail** (ative).

## 9. Teste de pessoa real (navegador de verdade)
- O instalador roda `npm run e2e`: um Chrome de verdade abre o site novo no **computador** e num **celular**
  (Pixel 7) e usa como uma pessoa: pop-up, contagem regressiva, botões, perguntas, tamanho da tela.
- Depois que a Vercel publicar, rode **TESTAR_PRODUCAO.cmd**: testa o site no ar (servidor, proteção da API,
  cabeçalhos, todos os sitemaps e páginas, SEO). Para testar também o login, crie uma conta de **teste** e
  coloque `E2E_EMAIL` e `E2E_PASSWORD` no arquivo `.env` da pasta.

## Como o dinheiro funciona

| Situação | O que acontece |
|---|---|
| Passageiro paga pela carteira | O valor sai do saldo e fica **retido** até o serviço terminar |
| Serviço concluído | O prestador recebe o valor menos a comissão (12% por padrão, ajustável no Admin) |
| Cancelamento antes do fim | O valor retido **volta inteiro** para quem pagou |
| Corrida paga em dinheiro | O motorista recebe em mãos e a comissão sai da carteira dele |
| Saque | O valor sai do saldo; você faz o Pix e marca "Já paguei" no Admin |

## O que o Admin faz
- **Pendências:** aprovar ou recusar motoristas e caminhoneiros (vendo os documentos) e pagar os saques.
- **SOS:** alertas de emergência com telefone, viagem, placa e localização.
- **Usuários:** buscar e bloquear contas, sempre com motivo.
- **Relatórios:** serviços, volume e receita por modalidade.
- **Configurações:** comissão, preço dinâmico (H3), prazos automáticos e pontos.
- **Equipe IA, Atendimento, Blog e SEO, Auditoria:** veja o item 7.

## Testes
`npm test` roda 58 testes automáticos (regras de negócio, Equipe IA, atendimento, blog/SEO e limites). `npm run e2e` e `npm run e2e:prod` rodam o teste no navegador.

## Antes de abrir ao público
- Preencha os campos entre colchetes em `public/legal/termos.html` e `public/legal/privacidade.html`
  (razão social, CNPJ, endereço, e-mail e encarregado de dados) e peça a revisão de um advogado.
- Verifique as regras da sua cidade para transporte por aplicativo (Lei 13.640/2018) e a ANTT para fretes.
