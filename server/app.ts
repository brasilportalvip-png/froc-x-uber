/**
 * Rotas HTTP do Froc X Uber. Toda rota de dados exige login (token do Firebase) e as
 * permissões são decididas no servidor (server/services.ts), nunca pelo navegador.
 */
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppError, FrocService } from './services.ts';
import type { AuthUser } from './services.ts';
import { verifyMercadoPagoSignature } from './mercadoPago.ts';
import type { SupportDesk } from './support.ts';
import type { BlogService } from './blog.ts';
import { SERVICE_PAGES, renderBlogIndex, renderCoverSvg, renderPost, renderServicePage, rssFeed, sitemapBlog, sitemapIndex, sitemapPages } from './blog.ts';
import type { AiTeam } from './ai/team.ts';
import { consumeQuota } from './rateLimit.ts';
import type { Store } from './store.ts';
import type { IdentityReviewer } from './ai/identityCheck.ts';
import { GUIDE_RENDERERS } from './guidePages.ts';
import { authenticateApiKey, createApiKey, listApiKeys, revokeApiKey } from './merchants.ts';

export interface PlatformParts {
  store: Store;
  support: SupportDesk;
  blog: BlogService;
  team: AiTeam;
  /** Conferência de CPF por leitura de documento (IA). */
  identity?: IdentityReviewer;
}

export interface AppOptions {
  service: FrocService | (() => Promise<FrocService>);
  /** Atendimento, blog e Equipe IA (opcional nos testes antigos). */
  platform?: () => Promise<PlatformParts>;
  /** Endereço público do site (para canonical, sitemaps e RSS). */
  siteUrl?: () => string;
  verifyToken: (token: string) => Promise<AuthUser>;
  publicConfig: () => Record<string, unknown>;
  webhookSecret?: string;
  /** Chave para o agendador externo chamar /api/cron/sweep. */
  cronSecret?: string;
  /** O que está configurado (sem mostrar valores secretos). */
  configStatus?: () => Record<string, unknown>;
  /** Diagnóstico do Firebase (projetos e chave), sem segredos. */
  diagnostics?: () => Promise<Record<string, unknown>>;
  /** Explica por que um token foi recusado. */
  explainTokenError?: (error: unknown) => { status: number; message: string; reason: string };
}

type AuthedRequest = Request & { auth?: AuthUser };

/** Limite simples por IP para evitar abuso (cadastros, recargas, documentos). */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = (req.ip || 'ip') + req.path;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return next();
    }
    if (++entry.count > max) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
    return next();
  };
}

export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.use('/api/driver/documents', express.json({ limit: '5mb' }));
  app.use(express.json({ limit: '200kb' }));

  const service = async () => (typeof options.service === 'function' ? options.service() : options.service);

  const wrap =
    (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
    async (req: AuthedRequest, res: Response) => {
      try {
        const result = await fn(req, res);
        if (!res.headersSent) res.json(result);
      } catch (error) {
        if (error instanceof AppError) return res.status(error.status).json({ error: error.message, code: error.code });
        console.error('Erro no servidor:', error);
        return res.status(500).json({ error: 'Erro interno. Tente novamente em instantes.' });
      }
    };

  const requireAuth = async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Faça login para continuar.', code: 'unauthenticated' });
    try {
      req.auth = await options.verifyToken(token);
      if (!req.auth.email) return res.status(401).json({ error: 'Conta sem e-mail.', code: 'unauthenticated' });
    } catch (error) {
      const why = options.explainTokenError?.(error) ?? { status: 401, message: 'Sessão expirada. Entre novamente.', reason: 'unknown' };
      console.error('Login recusado pelo servidor:', why.reason, String((error as Error)?.message || error).slice(0, 300));
      return res.status(why.status).json({ error: why.message, code: why.status === 401 ? 'unauthenticated' : 'server_config', reason: why.reason });
    }
    try {
      await (await service()).checkAccess(req.auth);
      return next();
    } catch (error) {
      if (error instanceof AppError) return res.status(error.status).json({ error: error.message, code: error.code });
      console.error('Falha ao conferir acesso:', error);
      return res.status(503).json({ error: 'Serviço indisponível. Tente em instantes.' });
    }
  };

  const a = (req: AuthedRequest) => req.auth as AuthUser;
  const id = (req: Request) => String(req.params.id || '').slice(0, 80);

  // ----- públicas
  // Público: só o essencial (sim/não). Detalhes completos só para a administração (/api/admin/health).
  app.get('/api/health', async (_req, res) => {
    const fb = options.diagnostics ? await options.diagnostics().catch((e) => ({ adminInit: String(e?.message || e).slice(0, 80) })) : undefined;
    const c = (options.configStatus?.() || {}) as Record<string, unknown>;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      service: 'froc-x-uber',
      config: { firebaseWebConfig: Boolean(c.firebaseWebConfig), ai: Boolean(c.ai), googleMaps: Boolean(c.googleMaps), mercadoPago: Boolean(c.mercadoPago), cron: Boolean(c.cron) },
      firebase: fb ? { adminInit: (fb as Record<string, unknown>).adminInit === 'ok' ? 'ok' : 'erro', sameProject: Boolean((fb as Record<string, unknown>).sameProject) } : undefined,
    });
  });
  app.get('/api/public-config', (_req, res) => res.json(options.publicConfig()));
  app.get('/api/maps-config', (_req, res) => res.json({ apiKey: options.publicConfig().mapsApiKey || '' }));

  // Erros que acontecem no navegador das pessoas (a equipe vê no Admin / Equipe IA → Manutenção).
  app.post('/api/client-error', rateLimit(10, 60_000), async (req: Request, res: Response) => {
    try {
      if (options.platform) {
        const { store } = await options.platform();
        // Teto diário para ninguém lotar o banco com erros falsos.
        await consumeQuota(store, 'client-error:global', 3000, 864e5, 'limite');
        const b = (req.body || {}) as Record<string, unknown>;
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await store.set('client_errors', id, {
          id,
          message: String(b.message || '').slice(0, 500),
          stack: String(b.stack || '').slice(0, 3000),
          extra: String(b.extra || '').slice(0, 1500),
          url: String(b.url || '').slice(0, 200),
          ua: String(b.ua || '').slice(0, 200),
          createdAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.warn('Não foi possível salvar o erro do navegador:', error);
    }
    res.status(204).end();
  });

  // Aviso automático do Mercado Pago (pagamento aprovado → credita a recarga).
  app.post(
    '/api/webhooks/mercadopago',
    wrap(async (req) => {
      const dataId = String((req.query['data.id'] as string) || req.body?.data?.id || '');
      const ok = verifyMercadoPagoSignature({
        secret: options.webhookSecret,
        signatureHeader: String(req.headers['x-signature'] || ''),
        requestId: String(req.headers['x-request-id'] || ''),
        dataId,
      });
      if (!ok) throw new AppError(401, 'invalid_signature', 'Assinatura inválida.');
      const type = String(req.query.type || req.body?.type || '');
      if (type && type !== 'payment') return { ignored: true };
      return (await service()).handlePaymentNotification(dataId);
    }),
  );

  // Agendador: cron-job.org (a cada 5 min, POST com o cabeçalho x-cron-key) ou o cron da Vercel
  // (GET com "Authorization: Bearer CRON_SECRET"). Os dois rodam a mesma rotina.
  const cronHandler = wrap(async (req) => {
      const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const key = String(req.headers['x-cron-key'] || '') || bearer;
      if (!options.cronSecret || key !== options.cronSecret) throw new AppError(401, 'unauthorized', 'Chave inválida.');
      const sweep = await (await service()).sweep(true);
      // Rotina diária (post do blog + relatório da Equipe IA): roda 1x por dia, a partir das 7h de Brasília.
      let daily: unknown = null;
      const hourBr = (new Date().getUTCHours() + 21) % 24;
      if (options.platform && hourBr >= 7) daily = await (await options.platform()).team.daily().catch((e) => ({ erro: String(e?.message || e) }));
      // Capa com IA para posts que ainda não têm (1 por vez, para caber no tempo do servidor).
      const images = options.platform ? await (await options.platform()).blog.fillMissingImages(1).catch((e) => ({ erro: String(e?.message || e) })) : null;
      // Equipe IA confere o CPF dos motoristas pendentes lendo a CNH (2 por rodada).
      const cpf = options.platform ? await ((await options.platform()).identity?.reviewPending(2) ?? Promise.resolve(null)).catch((e) => ({ erro: String(e?.message || e) })) : null;
      return { sweep, daily, images, cpf };
    });
  app.post('/api/cron/sweep', cronHandler);
  app.get('/api/cron/sweep', cronHandler);

  // ----- páginas públicas para o Google e o Bing (HTML pronto, sem depender de JavaScript)
  const site = () => (options.siteUrl?.() || '').replace(/\/+$/, '');
  const platform = async () => {
    if (!options.platform) throw new AppError(503, 'unavailable', 'Recurso indisponível.');
    return options.platform();
  };
  const sendPage = (res: Response, type: string, body: string, maxAge = 600) => {
    res.setHeader('Content-Type', `${type}; charset=utf-8`);
    res.setHeader('Cache-Control', `public, max-age=60, s-maxage=${maxAge}, stale-while-revalidate=86400`);
    res.send(body);
  };
  const publicPage =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        await fn(req, res);
      } catch (error) {
        console.error('Erro em página pública:', error);
        if (!res.headersSent) res.status(503).type('text/plain').send('Página temporariamente indisponível. Tente em instantes.');
      }
    };
  app.get('/sitemap.xml', publicPage(async (_req, res) => {
    const posts = await (await platform()).blog.list({ limit: 1 }).catch(() => []);
    sendPage(res, 'application/xml', sitemapIndex(site(), posts[0]?.updatedAt || posts[0]?.publishedAt));
  }));
  app.get('/sitemap-paginas.xml', publicPage(async (_req, res) => sendPage(res, 'application/xml', sitemapPages(site()), 86400)));
  app.get('/sitemap-blog.xml', publicPage(async (_req, res) => sendPage(res, 'application/xml', sitemapBlog(site(), await (await platform()).blog.list()))));
  app.get('/rss.xml', publicPage(async (_req, res) => sendPage(res, 'application/rss+xml', rssFeed(site(), await (await platform()).blog.list({ limit: 50 })))));
  app.get('/blog', publicPage(async (_req, res) => sendPage(res, 'text/html', renderBlogIndex(await (await platform()).blog.list({ limit: 200 }), site()), 120)));
  // Capa gerada pela IA (guardada no Storage; servida daqui com cache longo).
  app.get('/blog/img/:file', publicPage(async (req, res) => {
    const id = String(req.params.file || '').replace(/\.(png|jpg)$/i, '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 60);
    const img = await (await platform()).blog.readImage(id);
    if (!img) {
      res.status(404).type('text/plain').send('Imagem não encontrada.');
      return;
    }
    res.setHeader('Content-Type', img.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    res.send(Buffer.from(img.bytes));
  }));
  // Capa da marca (quando ainda não há foto da IA).
  app.get('/blog/capa/:file', publicPage(async (req, res) => {
    const slug = String(req.params.file || '').replace(/\.svg$/i, '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);
    const post = await (await platform()).blog.get(slug);
    sendPage(res, 'image/svg+xml', renderCoverSvg(post ?? { title: 'Blog Froc X Uber', keyword: '' }), 3600);
  }));
  app.get('/blog/:slug', publicPage(async (req, res) => {
    const { blog } = await platform();
    const slug = String(req.params.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);
    const post = await blog.get(slug);
    if (!post || !post.published) {
      res.status(404);
      return sendPage(res, 'text/html', renderBlogIndex(await blog.list({ limit: 30 }), site()).replace('<h1>', '<p class="meta">Este artigo não existe ou saiu do ar. Veja os mais recentes:</p><h1>'), 60);
    }
    const related = (await blog.list({ limit: 6 })).filter((p) => p.slug !== post.slug).slice(0, 4);
    sendPage(res, 'text/html', renderPost(post, site(), related), 300);
  }));
  for (const [slug, render] of Object.entries(GUIDE_RENDERERS)) {
    app.get(`/${slug}`, publicPage(async (_req, res) => sendPage(res, 'text/html', render(site()), 3600)));
  }
  for (const page of SERVICE_PAGES) {
    app.get(`/${page.slug}`, publicPage(async (_req, res) => {
      const latest = await (await platform()).blog.list({ limit: 3 }).catch(() => []);
      sendPage(res, 'text/html', renderServicePage(page, site(), latest), 3600);
    }));
  }

  // ----- acompanhar viagem por link (público, sem login; só dados mínimos)
  app.get(
    '/api/track/:token',
    rateLimit(120, 60_000),
    wrap(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex');
      return (await service()).trackShare(String(req.params.token || '').slice(0, 60));
    }),
  );

  // ----- API para lojas (Froc Entregas): autenticação por chave "froc_live_..."
  type MerchantRequest = Request & { merchantUid?: string };
  const v1 = express.Router();
  v1.use(async (req: MerchantRequest, res: Response, next: NextFunction) => {
    try {
      const { store } = await platform();
      const { uid, keyId } = await authenticateApiKey(store, req.headers.authorization);
      await consumeQuota(store, `apiv1:${keyId}`, 300, 60_000, 'Limite de 300 chamadas por minuto atingido. Aguarde alguns segundos.');
      req.merchantUid = uid;
      res.setHeader('Cache-Control', 'no-store');
      return next();
    } catch (error) {
      if (error instanceof AppError) return res.status(error.status).json({ error: error.message, code: error.code });
      console.error('Falha na autenticação da API de lojas:', error);
      return res.status(503).json({ error: 'Serviço indisponível. Tente em instantes.', code: 'unavailable' });
    }
  });
  const mid = (req: MerchantRequest) => String(req.merchantUid);
  const withUrl = <T extends { trackingPath: string }>(d: T) => ({ ...d, trackingUrl: d.trackingPath ? site() + d.trackingPath : '' });
  v1.get('/me', wrap(async (req) => {
    const svc = await service();
    const m = await svc.approvedMerchant(mid(req));
    const p = svc.profileView(m as never, { uid: m.uid, email: m.email, emailVerified: true });
    return { merchant: p.merchant, walletBalance: p.walletBalance };
  }));
  v1.post('/deliveries/quote', wrap(async (req) => (await service()).quoteDelivery(mid(req), req.body || {})));
  v1.post('/deliveries', wrap(async (req, res) => {
    const d = await (await service()).createDelivery(mid(req), req.body || {}, 'api');
    res.status(201);
    return { delivery: withUrl(d) };
  }));
  v1.get('/deliveries', wrap(async (req) => {
    const r = await (await service()).listDeliveries(mid(req), req.query.status ? String(req.query.status) : undefined);
    return { deliveries: r.deliveries.map(withUrl) };
  }));
  v1.get('/deliveries/:id', wrap(async (req) => ({ delivery: withUrl(await (await service()).getDelivery(mid(req), id(req))) })));
  v1.post('/deliveries/:id/cancel', wrap(async (req) => ({ delivery: withUrl(await (await service()).cancelDelivery(mid(req), id(req))) })));
  v1.use((_req: Request, res: Response) => res.status(404).json({ error: 'Rota não encontrada. Veja /desenvolvedores.', code: 'not_found' }));
  app.use('/api/v1', v1);

  // ----- com login
  const api = express.Router();
  api.use(requireAuth);
  const limited = rateLimit(20, 60_000);
  /**
   * Limite que vale para todas as instâncias (fica no banco), por conta. Se o banco falhar,
   * não bloqueia a pessoa (o limite em memória continua valendo).
   */
  const guard =
    (bucket: string, max: number, windowMs: number, message: string) => async (req: AuthedRequest, res: Response, next: NextFunction) => {
      if (!options.platform) return next();
      try {
        const { store } = await options.platform();
        await consumeQuota(store, `${bucket}:${(req.auth as AuthUser).uid}`, max, windowMs, message);
        return next();
      } catch (error) {
        if (error instanceof AppError) return res.status(error.status).json({ error: error.message, code: error.code });
        console.warn('Limite persistente indisponível:', error);
        return next();
      }
    };

  api.get('/bootstrap', wrap(async (req) => (await service()).bootstrap(a(req))));
  api.patch('/profile', wrap(async (req) => (await service()).updateProfile(a(req), req.body || {})));
  // CPF: poucas tentativas por dia (ninguém fica testando CPF dos outros).
  api.post(
    '/identity/cpf',
    rateLimit(5, 60_000),
    guard('cpf', 8, 864e5, 'Muitas tentativas de CPF hoje. Tente amanhã ou fale com o Atendimento.'),
    wrap(async (req) => (await service()).registerCpf(a(req), req.body || {}, req.headers['x-froc-device'])),
  );
  // Passageiro envia documento com foto: a IA lê e confere o CPF na hora (selo verde).
  api.post(
    '/identity/document',
    rateLimit(5, 60_000),
    guard('iddoc', 6, 864e5, 'Muitos envios de documento hoje. Tente amanhã.'),
    wrap(async (req) => {
      const svc = await service();
      const { path } = await svc.uploadIdentityDocument(a(req), req.body?.contentType, req.body?.dataBase64);
      const reviewer = options.platform ? (await options.platform()).identity : undefined;
      const result = reviewer ? await reviewer.review(a(req).uid, path, 'documento') : { ok: false, status: 'ia_indisponivel', reasons: ['A conferência automática está desligada; a equipe vai conferir.'] };
      return { result, profile: svc.profileView((await svc.store.get('users', a(req).uid)) as never, a(req)) };
    }),
  );
  api.post('/device', rateLimit(10, 60_000), wrap(async (req) => (await service()).recordDevice(a(req), req.headers['x-froc-device'])));

  api.post('/rides/quote', wrap(async (req) => (await service()).quoteRide(a(req), req.body || {})));
  api.get('/drivers/nearby', rateLimit(40, 60_000), wrap(async (req) => (await service()).nearbyDrivers(a(req), req.query.lat, req.query.lng)));
  api.post('/trips/:kind/:id/share', limited, wrap(async (req) => (await service()).shareTrip(a(req), req.params.kind, id(req))));
  api.post('/trips/:kind/:id/recording', rateLimit(20, 60_000), wrap(async (req) => (await service()).recordingNotice(a(req), req.params.kind, id(req), req.body?.mode)));
  api.post('/driver/location', rateLimit(30, 60_000), wrap(async (req) => (await service()).updateLocation(a(req), req.body?.lat, req.body?.lng)));
  api.post('/sos', rateLimit(5, 60_000), guard('sos', 20, 3600_000, 'Muitos alertas em pouco tempo. Em emergência ligue 190.'), wrap(async (req) => (await service()).createSos(a(req), req.body || {})));
  api.post('/wallet/redeem', limited, wrap(async (req) => (await service()).redeemPoints(a(req))));
  api.post('/rides', limited, wrap(async (req) => (await service()).createRide(a(req), req.body || {})));
  api.patch('/rides/:id', wrap(async (req) => ({ ride: await (await service()).rideAction(a(req), id(req), req.body || {}) })));

  api.post('/indrive', limited, wrap(async (req) => (await service()).createInDrive(a(req), req.body || {})));
  api.post('/indrive/:id/offers', wrap(async (req) => (await service()).sendInDriveOffer(a(req), id(req), req.body || {})));
  api.post('/indrive/:id/accept', wrap(async (req) => ({ request: await (await service()).acceptInDriveOffer(a(req), id(req), req.body?.offerId) })));
  api.post('/indrive/:id/complete', wrap(async (req) => ({ request: await (await service()).completeInDrive(a(req), id(req)) })));
  api.post('/indrive/:id/cancel', wrap(async (req) => ({ request: await (await service()).cancelInDrive(a(req), id(req)) })));

  api.post('/carpools', limited, wrap(async (req) => (await service()).publishCarpool(a(req), req.body || {})));
  api.post('/carpools/:id/book', wrap(async (req) => ({ trip: await (await service()).bookCarpool(a(req), id(req), req.body?.seats) })));
  api.post('/carpools/:id/cancel-booking', wrap(async (req) => ({ trip: await (await service()).cancelCarpoolBooking(a(req), id(req)) })));
  api.post('/carpools/:id/complete', wrap(async (req) => ({ trip: await (await service()).finishCarpool(a(req), id(req), 'completed') })));
  api.post('/carpools/:id/cancel', wrap(async (req) => ({ trip: await (await service()).finishCarpool(a(req), id(req), 'cancelled') })));

  api.post('/empty-trucks', limited, wrap(async (req) => (await service()).publishEmptyTruck(a(req), req.body || {})));
  api.post('/empty-trucks/:id/reserve', wrap(async (req) => ({ route: await (await service()).reserveEmptyTruck(a(req), id(req)) })));
  api.post('/empty-trucks/:id/complete', wrap(async (req) => ({ route: await (await service()).finishEmptyTruck(a(req), id(req), 'complete') })));
  api.post('/empty-trucks/:id/cancel', wrap(async (req) => ({ route: await (await service()).finishEmptyTruck(a(req), id(req), 'cancel') })));

  api.post('/freights', limited, wrap(async (req) => (await service()).createFreight(a(req), req.body || {})));
  api.post('/freights/:id/bids', wrap(async (req) => (await service()).bidFreight(a(req), id(req), req.body || {})));
  api.post('/freights/:id/accept', wrap(async (req) => ({ freight: await (await service()).acceptFreightBid(a(req), id(req), req.body?.bidId) })));
  api.post('/freights/:id/deliver', wrap(async (req) => ({ freight: await (await service()).finishFreight(a(req), id(req), 'deliver') })));
  api.post('/freights/:id/cancel', wrap(async (req) => ({ freight: await (await service()).finishFreight(a(req), id(req), 'cancel') })));

  api.post('/wallet/topup', limited, guard('topup', 15, 3600_000, 'Muitas recargas em uma hora. Tente mais tarde.'), wrap(async (req) => (await service()).createTopup(a(req), req.body?.amount)));
  api.post('/wallet/topups/:id/confirm', wrap(async (req) => (await service()).confirmTopup(id(req), a(req).uid)));
  api.post('/wallet/withdraw', limited, guard('withdraw', 5, 864e5, 'Limite de 5 pedidos de saque por dia.'), wrap(async (req) => (await service()).requestWithdrawal(a(req), req.body?.amount, req.body?.pixKey, req.body?.pixKeyType)));

  api.post(
    '/driver/documents',
    rateLimit(15, 60_000),
    guard('docs', 40, 864e5, 'Muitos envios de documentos hoje. Tente amanhã.'),
    wrap(async (req) => (await service()).uploadDocument(a(req), req.body?.kind, req.body?.docType, req.body?.contentType, req.body?.dataBase64)),
  );
  api.post(
    '/driver/apply',
    limited,
    guard('apply', 10, 864e5, 'Muitas tentativas de cadastro hoje.'),
    wrap(async (req) => {
      const profile = await (await service()).applyAsProvider(a(req), req.body?.kind, req.body || {});
      // A IA já lê a CNH e confere CPF, nome, nascimento, validade e EAR (o resultado aparece para a equipe).
      if (options.platform && req.body?.kind !== 'merchant') {
        // A IA lê CNH, CRLV e antecedentes e já decide (com autonomia ligada). Se demorar, o agendador termina.
        const reviewer = (await options.platform()).identity;
        if (reviewer) await reviewer.reviewProvider(a(req).uid, req.body?.kind === 'trucker' ? 'trucker' : 'driver').catch((e) => console.warn('Conferência do cadastro falhou:', e));
        return (await service()).profileView((await (await service()).store.get('users', a(req).uid)) as never, a(req));
      }
      return profile;
    }),
  );

  // ----- painel da loja (Froc Entregas)
  api.post('/merchant/apply', limited, guard('apply', 10, 864e5, 'Muitas tentativas de cadastro hoje.'), wrap(async (req) => (await service()).applyAsMerchant(a(req), req.body || {})));
  const merchantStore = async (req: AuthedRequest) => {
    await (await service()).approvedMerchant(a(req).uid);
    return (await platform()).store;
  };
  api.get('/merchant/keys', wrap(async (req) => ({ keys: await listApiKeys(await merchantStore(req), a(req).uid) })));
  api.post('/merchant/keys', limited, wrap(async (req) => {
    const created = await createApiKey(await merchantStore(req), a(req).uid, req.body?.label);
    await (await service()).audit(a(req), 'chave_api_criada', a(req).uid, { prefixo: created.prefix });
    return created;
  }));
  api.post('/merchant/keys/:id/revoke', wrap(async (req) => {
    const r = await revokeApiKey(await merchantStore(req), a(req).uid, id(req).slice(0, 64));
    await (await service()).audit(a(req), 'chave_api_revogada', a(req).uid);
    return r;
  }));
  api.post('/merchant/webhook', limited, wrap(async (req) => (await service()).setMerchantWebhook(a(req), req.body?.url, req.body?.rotate === true)));
  api.post('/merchant/webhook/test', rateLimit(5, 60_000), wrap(async (req) => {
    const svc = await service();
    await svc.approvedMerchant(a(req).uid);
    if (!svc.deps.webhooks) throw new AppError(503, 'unavailable', 'Webhooks indisponíveis no momento.');
    return svc.deps.webhooks.test(a(req).uid);
  }));
  api.post('/merchant/quote', wrap(async (req) => (await service()).quoteDelivery(a(req).uid, req.body || {})));
  api.post('/merchant/deliveries', limited, wrap(async (req) => (await service()).createDelivery(a(req).uid, req.body || {}, 'painel')));
  api.get('/merchant/deliveries', wrap(async (req) => (await service()).listDeliveries(a(req).uid)));
  api.post('/merchant/deliveries/:id/cancel', wrap(async (req) => (await service()).cancelDelivery(a(req).uid, id(req))));

  api.get('/admin/health', wrap(async (req) => {
    if (!(await service()).isAdmin(a(req))) throw new AppError(403, 'forbidden', 'Acesso restrito à administração.');
    const firebase = options.diagnostics ? await options.diagnostics().catch((e) => ({ error: String(e?.message || e) })) : undefined;
    return { ok: true, config: options.configStatus?.(), firebase };
  }));
  api.get('/admin/overview', wrap(async (req) => (await service()).adminOverview(a(req))));
  api.post(
    '/admin/applications/:id',
    wrap(async (req) => (await service()).reviewApplication(a(req), id(req), req.body?.kind, req.body?.decision, req.body?.reason)),
  );
  api.get('/admin/users', wrap(async (req) => (await service()).adminUsers(a(req), req.query.q)));
  api.get('/admin/risk-zones', wrap(async (req) => (await service()).listRiskZones(a(req))));
  api.post('/admin/risk-zones', wrap(async (req) => (await service()).saveRiskZone(a(req), req.body || {})));
  api.get('/admin/users/:id/identity', wrap(async (req) => ({ identity: await (await service()).adminIdentity(a(req), id(req)) })));
  api.post('/admin/users/:id/cpf', wrap(async (req) => (await service()).adminSetCpfStatus(a(req), id(req), req.body?.decision, req.body?.reason)));
  api.post('/admin/users/:id/block', wrap(async (req) => (await service()).setBlocked(a(req), id(req), req.body?.blocked, req.body?.reason)));
  api.get('/admin/reports', wrap(async (req) => (await service()).adminReports(a(req), req.query.days)));
  api.patch('/admin/settings', wrap(async (req) => (await service()).updateSettings(a(req), req.body || {})));
  api.post('/admin/sos/:id/resolve', wrap(async (req) => (await service()).resolveSos(a(req), id(req), req.body?.note)));
  api.post('/admin/withdrawals/:id', wrap(async (req) => (await service()).resolveWithdrawal(a(req), id(req), req.body?.decision)));

  // ----- atendimento (pessoa ↔ Froc ↔ equipe)
  const quota = async (req: AuthedRequest, bucket: string, max: number, windowMs: number, message: string) => {
    const { store } = await platform();
    await consumeQuota(store, `${bucket}:${a(req).uid}`, max, windowMs, message);
  };
  api.get('/support', wrap(async (req) => (await platform()).team.supportView(a(req))));
  api.post(
    '/support',
    limited,
    wrap(async (req) => {
      await quota(req, 'support', 60, 864e5, 'Você atingiu o limite de mensagens de hoje. A equipe continua vendo sua conversa.');
      return (await platform()).team.supportMessage(a(req), req.body?.message);
    }),
  );

  // ----- administração: Equipe IA, atendimento, blog e auditoria
  const admin = async (req: AuthedRequest) => {
    const svc = await service();
    if (!svc.isAdmin(a(req))) throw new AppError(403, 'forbidden', 'Acesso restrito à administração.');
    return platform();
  };
  api.get('/admin/ai/agents', wrap(async (req) => {
    const p = await admin(req);
    return { configured: p.team.configured, agents: p.team.agents() };
  }));
  api.post('/admin/ai/chat', wrap(async (req) => {
    const p = await admin(req);
    await quota(req, 'ai-admin', 400, 864e5, 'Limite diário de mensagens para a Equipe IA atingido (protege sua conta do Gemini).');
    return p.team.chat(a(req), req.body?.agentId, req.body?.message, req.body?.conversationId);
  }));
  api.get('/admin/ai/health', wrap(async (req) => (await admin(req)).team.aiHealth(a(req))));
  api.post('/admin/ai/ping', wrap(async (req) => (await admin(req)).team.aiPing(a(req))));
  api.get('/admin/ai/conversations/:id', wrap(async (req) => (await admin(req)).team.conversation(a(req), id(req))));
  api.get('/admin/ai/proposals', wrap(async (req) => (await admin(req)).team.proposals(a(req), String(req.query.status || 'pending'))));
  api.post('/admin/ai/proposals/:id', wrap(async (req) => (await admin(req)).team.decide(a(req), id(req), req.body?.decision)));
  api.get('/admin/ai/reports', wrap(async (req) => (await admin(req)).team.reports(a(req))));
  api.post('/admin/ai/daily', wrap(async (req) => (await admin(req)).team.daily(true)));
  api.get('/admin/audit', wrap(async (req) => (await service()).auditLog(a(req), Number(req.query.limit) || 150)));
  api.get('/admin/support', wrap(async (req) => (await admin(req)).support.listOpen(100)));
  api.get('/admin/support/:id', wrap(async (req) => ((await admin(req)).support.get(id(req))).then((c) => c ?? { messages: [] })));
  api.post('/admin/support/:id/reply', wrap(async (req) => {
    const p = await admin(req);
    const chat = await p.support.get(id(req));
    if (!chat) throw new AppError(404, 'not_found', 'Conversa não encontrada.');
    const r = await p.support.append({ uid: chat.uid }, 'equipe', String(req.body?.text || ''), a(req).email);
    await (await service()).audit(a(req), 'atendimento_respondido', chat.uid);
    return r;
  }));
  api.post('/admin/support/:id/close', wrap(async (req) => (await admin(req)).support.close(id(req))));
  api.get('/admin/blog', wrap(async (req) => (await admin(req)).blog.list({ includeDrafts: true, limit: 200 })));
  api.post('/admin/blog/generate', wrap(async (req) => {
    const p = await admin(req);
    const out = await p.blog.generate({ topic: req.body?.topic ? String(req.body.topic).slice(0, 200) : undefined, author: 'Froc IA · Marketing e SEO' });
    await (await service()).audit(a(req), 'post_criado', out.post.slug, { publicado: out.post.published });
    // Tenta já colocar a capa; se não der tempo, o agendador coloca nos próximos minutos.
    const image = out.post.published ? await p.blog.attachImage(out.post.slug).catch((e) => ({ ok: false, error: String(e?.message || e) })) : null;
    return { slug: out.post.slug, title: out.post.title, published: out.post.published, problems: out.problems, image };
  }));
  api.post('/admin/blog/:id/image', wrap(async (req) => {
    const p = await admin(req);
    const r = await p.blog.attachImage(id(req));
    await (await service()).audit(a(req), 'capa_gerada', id(req), { modelo: r.model });
    return r;
  }));
  api.post('/admin/blog/:id/delete', wrap(async (req) => {
    const p = await admin(req);
    const r = await p.blog.remove(id(req));
    if (!r) throw new AppError(404, 'not_found', 'Post não encontrado.');
    await (await service()).audit(a(req), 'post_apagado', r.slug, { titulo: r.title });
    return r;
  }));
  api.post('/admin/blog/:id/publish', wrap(async (req) => {
    const p = await admin(req);
    const r = await p.blog.setPublished(id(req), req.body?.published === true);
    if (!r) throw new AppError(404, 'not_found', 'Post não encontrado.');
    await (await service()).audit(a(req), req.body?.published === true ? 'post_publicado' : 'post_retirado', id(req));
    return r;
  }));

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  return app;
}
