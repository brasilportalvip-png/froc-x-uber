/**
 * Páginas públicas de ajuda, regras/leis e documentação para lojas (HTML pronto para o
 * Google e o Bing). O conteúdo vem de src/data/legal.ts — a mesma fonte que os agentes de IA usam.
 */
import { escapeHtml as e, layout, ORG, SITE_NAME } from './blog.ts';
import {
  CITY_VEHICLE_AGE,
  DEFAULT_MAX_VEHICLE_AGE,
  FAQ,
  HOW_IT_WORKS,
  LEGAL_UPDATED,
  QUALITY_CONTROL,
  RECORDING_RULES,
  REQUIREMENTS,
  SHARE_RULES,
} from '../src/data/legal.ts';
import { RIDE_POLICY_TEXT } from '../src/data/ridePolicy.ts';
import { PRICING_TEXT } from '../src/data/pricing.ts';

const EXTRA_STYLE = `<style>
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:15px}td,th{border:1px solid rgba(255,255,255,.12);padding:8px 10px;text-align:left}th{color:#f2c14e}
pre{background:#0d0d10;border:1px solid rgba(212,175,55,.3);border-radius:12px;padding:14px;overflow:auto;font-size:13px;line-height:1.5}code{font-family:ui-monospace,Menlo,Consolas,monospace;color:#ffd1e8}
.toc a{display:inline-block;margin:4px 8px 4px 0}.note{color:#a1a1aa;font-size:14px}ol li,ul li{margin:4px 0}
</style>`;

const list = (items: string[], ordered = false) => `<${ordered ? 'ol' : 'ul'}>${items.map((i) => `<li>${e(i)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
const crumbs = (label: string) => `<nav class="crumbs"><a href="/">Início</a> › ${e(label)}</nav>`;
const cta = `<div class="card"><h2 style="margin-top:0">Pronto para começar?</h2><p>Crie sua conta grátis. Inauguração em 10 de março de 2027 — quem se cadastra antes ganha o selo de membro fundador.</p><a class="btn" href="/#entrar">Criar conta grátis</a> <a class="btn gold" href="/seja-motorista">Quero ser motorista</a></div>`;

function page(site: string, slug: string, title: string, description: string, body: string, jsonLd: unknown[]) {
  const url = `${site}/${slug}`;
  return layout({
    title,
    description,
    canonical: url,
    body: EXTRA_STYLE + body,
    jsonLd: [
      ORG(site),
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Início', item: `${site}/` },
          { '@type': 'ListItem', position: 2, name: title.split(' | ')[0], item: url },
        ],
      },
      ...jsonLd,
    ],
  });
}

export function renderRules(site: string) {
  const body = `${crumbs('Regras e requisitos')}
<h1>Regras, leis e requisitos para dirigir, entregar e transportar</h1>
<p class="lead">Tudo o que a lei brasileira e a Froc exigem de motoristas, mototaxistas, motoboys, transportadores de carga, lojas e passageiros — explicado sem juridiquês.</p>
<p class="note">Atualizado em ${e(LEGAL_UPDATED.split('-').reverse().join('/'))}. Não é parecer jurídico: cada prefeitura tem decreto próprio e, quando ela é mais rígida, vale a regra dela.</p>
<p class="toc">${REQUIREMENTS.map((s) => `<a href="#${s.id}">${e(s.title.split(' (')[0])}</a>`).join('')}<a href="#ano">Ano do veículo</a><a href="#cancelamento">Cancelamento e espera</a><a href="#gravacao">Gravação</a><a href="#compartilhar">Compartilhar viagem</a></p>
${REQUIREMENTS.map(
  (s) => `<h2 id="${s.id}">${e(s.title)}</h2><p>${e(s.summary)}</p>${list(s.items)}<p class="note">Base legal: ${e(s.sources.join('; '))}.</p>`,
).join('')}
<h2 id="ano">Ano do veículo: qual é aceito?</h2>
<p>Não existe uma idade máxima única no país: a lei federal manda cada cidade definir. A regra geral da Froc é <strong>até ${DEFAULT_MAX_VEHICLE_AGE} anos de fabricação</strong>. Onde a prefeitura é mais rígida, vale a regra dela. O app confere o ano no cadastro.</p>
<table><thead><tr><th>Cidade</th><th>Idade máxima</th><th>Fonte</th></tr></thead><tbody>
${CITY_VEHICLE_AGE.map((c) => `<tr><td>${e(c.city)}/${e(c.state)}</td><td>até ${c.maxYears} anos</td><td>${e(c.note)}</td></tr>`).join('')}
<tr><td>Demais cidades</td><td>até ${DEFAULT_MAX_VEHICLE_AGE} anos (padrão Froc)</td><td>Confira também o decreto da sua prefeitura.</td></tr>
</tbody></table>
<h2 id="gravacao">${e(RECORDING_RULES.title)}</h2>${list(RECORDING_RULES.items)}
<h2 id="compartilhar">${e(SHARE_RULES.title)}</h2>${list(SHARE_RULES.items)}
<h2 id="cancelamento">${e(RIDE_POLICY_TEXT.title)}</h2>
<p>O motorista se desloca até o passageiro. Estas regras, cobradas automaticamente pela carteira, protegem o tempo de quem dirige e o dinheiro de quem viaja.</p>
<h3>Cancelamento</h3>${list(RIDE_POLICY_TEXT.cancel)}
<h3>Tempo de espera no embarque</h3>${list(RIDE_POLICY_TEXT.wait)}
<h2>Controle de qualidade Froc</h2>${list(QUALITY_CONTROL)}
<p>Dúvidas? Veja as <a href="/perguntas-frequentes">perguntas frequentes</a> ou fale com o Atendimento dentro do app.</p>
${cta}`;
  return page(
    site,
    'regras-e-requisitos',
    'Regras e requisitos para motorista de aplicativo, motoboy e frete | Froc X Uber',
    'EAR na CNH, ano do veículo aceito, antecedentes, INSS, RNTRC, CIOT, piso de frete e regras para lojas. Tudo o que a lei exige, explicado de forma simples.',
    body,
    [{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Regras e requisitos', dateModified: LEGAL_UPDATED, inLanguage: 'pt-BR', url: `${site}/regras-e-requisitos` }],
  );
}

export function renderHowItWorks(site: string) {
  const body = `${crumbs('Como funciona')}
<h1>Como funciona a ${SITE_NAME}</h1>
<p class="lead">Um app só para corridas, negociar o preço, caronas entre cidades, fretes e mudanças — e entregas para lojas. Em todo o Brasil.</p>
${HOW_IT_WORKS.map((h) => `<h2>${e(h.title)}</h2>${list(h.steps, true)}`).join('')}
<h2>Quanto custa e quanto fica com cada um</h2>${list(PRICING_TEXT)}
<h2>Segurança em toda viagem</h2>
${list([
  'Mapa ao vivo: veja os carros por perto antes de pedir e o seu motorista se movendo até você.',
  'PIN de embarque, chat, avaliação dos dois lados e botão SOS.',
  'Grave áudio ou vídeo da viagem pelo próprio celular (a outra parte é avisada).',
  'Compartilhe o link da viagem: sua família acompanha o carro em tempo real.',
])}
<h2>Controle de qualidade</h2>${list(QUALITY_CONTROL)}
<p>Veja também: <a href="/regras-e-requisitos">regras e leis</a> · <a href="/perguntas-frequentes">perguntas frequentes</a> · <a href="/desenvolvedores">entregas para lojas</a>.</p>
${cta}`;
  return page(
    site,
    'como-funciona',
    'Como funciona a Froc X Uber: corridas, caronas, fretes e entregas',
    'Passo a passo de corridas, negociação de preço, caronas, fretes, mudanças e entregas para lojas. Mapa ao vivo, PIN, SOS, gravação e link para a família acompanhar.',
    body,
    HOW_IT_WORKS.map((h) => ({
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: h.title,
      step: h.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, text: s })),
    })),
  );
}

export function renderFaq(site: string) {
  const body = `${crumbs('Perguntas frequentes')}
<h1>Perguntas frequentes</h1>
<p class="lead">Respostas rápidas sobre cadastro, documentos, ano do carro, segurança, pagamentos e entregas.</p>
${FAQ.map(([q, a]) => `<details><summary>${e(q)}</summary><p>${e(a)}</p></details>`).join('')}
<p>Não achou? Fale com o Atendimento dentro do app — ele responde na hora e chama a equipe quando precisa.</p>
${cta}`;
  return page(
    site,
    'perguntas-frequentes',
    'Perguntas frequentes | Froc X Uber',
    'EAR na CNH, ano mínimo do carro, documentos, gravação da viagem, link de acompanhamento, pagamentos e entregas para lojas: tire suas dúvidas.',
    body,
    [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }],
  );
}

const code = (s: string) => `<pre><code>${e(s.trim())}</code></pre>`;

export function renderDevelopers(site: string) {
  const base = `${site}/api/v1`;
  const body = `${crumbs('Para lojas e desenvolvedores')}
<h1>Froc Entregas: integre sua loja e chame entregadores automaticamente</h1>
<p class="lead">Pastelaria, lanchonete, restaurante, farmácia ou loja: quando entra um pedido no seu sistema, a Froc chama o entregador mais perto, o cliente acompanha pelo link e você recebe cada mudança de situação no seu sistema.</p>
<p class="toc"><a href="#comecar">Começar</a><a href="#sem-codigo">Sem programar</a><a href="#auth">Autenticação</a><a href="#cotacao">Cotação</a><a href="#criar">Criar entrega</a><a href="#consultar">Consultar e cancelar</a><a href="#webhooks">Webhooks</a><a href="#erros">Erros e limites</a></p>

<h2 id="comecar">Começar em 5 passos</h2>
${list(
  [
    'Crie a conta no app e vá em Conta › Froc para lojas.',
    'Envie o nome da loja, o CNPJ (MEI aceito), o telefone e o endereço de coleta. A equipe Froc confere e libera.',
    'Recarregue a carteira (Pix ou cartão). Cada entrega usa o saldo: o valor fica retido e só vai para o entregador quando o cliente informa o código de entrega.',
    'No painel da loja, crie uma chave de API (ela aparece uma única vez — guarde em local seguro, nunca no site ou no app do cliente).',
    'Cadastre o endereço do seu webhook e teste. Pronto: seu sistema já chama entregas sozinho.',
  ],
  true,
)}

<h2 id="sem-codigo">Sem programar</h2>
<p>Não tem sistema? Use o painel da loja dentro do app: digite o endereço do cliente, nome e telefone e toque em "Chamar entregador". Você vê o entregador no mapa e manda o link de acompanhamento para o cliente pelo WhatsApp.</p>

<h2 id="auth">Autenticação</h2>
<p>Todas as chamadas vão para <code>${e(base)}</code> com o cabeçalho:</p>
${code('Authorization: Bearer froc_live_SUA_CHAVE')}
<p>A Froc guarda só a impressão digital (SHA-256) da chave. Se ela vazar, revogue no painel e crie outra. As chamadas são de servidor para servidor (não chame a API direto do navegador).</p>

<h2 id="cotacao">Cotação (preço antes de chamar)</h2>
${code(`
POST ${base}/deliveries/quote
Content-Type: application/json

{
  "dropoff": { "address": "Rua das Flores, 120 - Centro, Campinas - SP", "lat": -22.9056, "lng": -47.0608 }
}
`)}
<p>Resposta: <code>{ "price": 14.9, "currency": "BRL", "distanceKm": 4.3, "durationMin": 14, "surge": 1 }</code>. Sem <code>pickup</code>, a coleta é o endereço cadastrado da loja.</p>

<h2 id="criar">Criar entrega</h2>
${code(`
POST ${base}/deliveries
Content-Type: application/json

{
  "orderRef": "PED-1029",
  "dropoff": { "address": "Rua das Flores, 120 - apto 32", "lat": -22.9056, "lng": -47.0608 },
  "recipient": { "name": "Maria Souza", "phone": "19988887777" },
  "items": "2 pastéis de carne, 1 caldo de cana",
  "note": "Interfone 32. Troco não precisa.",
  "vehicle": "moto"
}
`)}
<ul>
<li><code>orderRef</code>: o número do pedido no seu sistema. Mandou duas vezes? A Froc devolve a mesma entrega (não cobra em dobro).</li>
<li><code>dropoff</code>: envie <code>lat</code> e <code>lng</code>. Só tem o endereço em texto? Envie <code>address</code> — a Froc localiza quando a busca de endereços está ativada na plataforma.</li>
<li><code>vehicle</code>: <code>moto</code>, <code>carro</code> ou <code>qualquer</code> (padrão).</li>
<li>Até 60 km e 20 kg em moto. Para cargas maiores, use o módulo Cargas.</li>
</ul>
<p>Resposta <code>201</code>:</p>
${code(`
{
  "delivery": {
    "id": "8f1c...",
    "status": "procurando_entregador",
    "statusLabel": "Procurando entregador",
    "price": 14.9,
    "deliveryCode": "4821",
    "trackingUrl": "${site}/acompanhar/Xy7...",
    "orderRef": "PED-1029",
    "courier": null
  }
}
`)}
<p>Envie ao cliente o <strong>link de acompanhamento</strong> e o <strong>código de entrega</strong>. O entregador só conclui a entrega quando o cliente informa o código — é isso que libera o pagamento.</p>

<h2 id="consultar">Consultar e cancelar</h2>
${code(`
GET  ${base}/deliveries/{id}
GET  ${base}/deliveries?status=saiu_para_entrega
POST ${base}/deliveries/{id}/cancel
GET  ${base}/me
`)}
<p>Situações: <code>procurando_entregador</code> → <code>entregador_a_caminho</code> → <code>entregador_na_loja</code> → <code>saiu_para_entrega</code> → <code>entregue</code> (ou <code>cancelada</code>). Dá para cancelar até o entregador coletar o pedido; o valor volta para a carteira. Sem entregador em 20 minutos, a entrega é cancelada sozinha e o valor volta.</p>

<h2 id="webhooks">Webhooks (aviso automático no seu sistema)</h2>
<p>A cada mudança, a Froc faz um <code>POST</code> JSON no endereço cadastrado (precisa ser <code>https</code> público). Eventos: <code>delivery.created</code>, <code>delivery.courier_assigned</code>, <code>delivery.courier_at_pickup</code>, <code>delivery.picked_up</code>, <code>delivery.delivered</code>, <code>delivery.cancelled</code> e <code>webhook.test</code>.</p>
${code(`
POST https://seusistema.com.br/froc/webhook
X-Froc-Event: delivery.picked_up
X-Froc-Signature: t=1763300000,v1=5f2c...
Content-Type: application/json

{ "id": "evt...", "type": "delivery.picked_up", "createdAt": "2026-11-16T18:20:00.000Z", "data": { "id": "8f1c...", "status": "saiu_para_entrega", ... } }
`)}
<p>Confira a assinatura com o segredo <code>whsec_...</code> mostrado ao cadastrar o webhook (HMAC-SHA256 de <code>t + "." + corpo</code>):</p>
${code(`
import crypto from 'node:crypto';

export function assinaturaValida(segredo, corpoBruto, cabecalho) {
  const partes = Object.fromEntries(cabecalho.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(partes.t)) > 300) return false; // mais de 5 min: recusa
  const esperado = crypto.createHmac('sha256', segredo).update(partes.t + '.' + corpoBruto).digest('hex');
  const a = Buffer.from(esperado), b = Buffer.from(partes.v1 || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
`)}
<p>Responda com status 2xx em até 5 segundos. Se falhar, a Froc tenta de novo em 1, 5, 15 e 60 minutos, 3 h e 12 h. Use o campo <code>id</code> do evento para não processar o mesmo aviso duas vezes.</p>

<h2 id="erros">Erros e limites</h2>
<table><thead><tr><th>Status</th><th>Quando</th></tr></thead><tbody>
<tr><td>400</td><td>Dados inválidos (endereço, telefone, distância acima de 60 km). A mensagem explica o que corrigir.</td></tr>
<tr><td>401</td><td>Chave ausente, inválida ou revogada.</td></tr>
<tr><td>402</td><td>Saldo insuficiente na carteira da loja.</td></tr>
<tr><td>403</td><td>Loja ainda não aprovada ou bloqueada.</td></tr>
<tr><td>404</td><td>Entrega não encontrada (ou de outra loja).</td></tr>
<tr><td>409</td><td>Ação impossível na situação atual (ex.: cancelar depois da coleta).</td></tr>
<tr><td>429</td><td>Mais de 300 chamadas por minuto por chave.</td></tr>
</tbody></table>
<p>Todas as respostas de erro têm o formato <code>{ "error": "mensagem em português", "code": "codigo_curto" }</code>.</p>
<p>Regras para lojas (CNPJ, itens proibidos, bebidas para maiores de 18): veja <a href="/regras-e-requisitos#lojista">regras e requisitos</a>.</p>
${cta}`;
  return page(
    site,
    'desenvolvedores',
    'API de entregas para lojas e restaurantes | Froc Entregas',
    'Integre sua loja, lanchonete ou restaurante à Froc: API REST para chamar entregadores, link de acompanhamento para o cliente e webhooks assinados.',
    body,
    [
      {
        '@context': 'https://schema.org',
        '@type': 'TechArticle',
        headline: 'API de entregas Froc para lojas',
        inLanguage: 'pt-BR',
        dateModified: LEGAL_UPDATED,
        url: `${site}/desenvolvedores`,
        author: { '@type': 'Organization', name: SITE_NAME },
      },
    ],
  );
}

export const GUIDE_RENDERERS: Record<string, (site: string) => string> = {
  'como-funciona': renderHowItWorks,
  'regras-e-requisitos': renderRules,
  'perguntas-frequentes': renderFaq,
  desenvolvedores: renderDevelopers,
};
