/**
 * Rotas HTTP do Froc X Uber. Toda rota de dados exige login (token do Firebase) e as
 * permissões são decididas no servidor (server/services.ts), nunca pelo navegador.
 */
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppError, FrocService } from './services.ts';
import type { AuthUser } from './services.ts';
import { verifyMercadoPagoSignature } from './mercadoPago.ts';

export interface AppOptions {
  service: FrocService | (() => Promise<FrocService>);
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
  app.get('/api/health', async (_req, res) => {
    const firebase = options.diagnostics ? await options.diagnostics().catch((e) => ({ error: String(e?.message || e) })) : undefined;
    res.json({ ok: true, service: 'froc-x-uber', config: options.configStatus?.(), firebase });
  });
  app.get('/api/public-config', (_req, res) => res.json(options.publicConfig()));
  app.get('/api/maps-config', (_req, res) => res.json({ apiKey: options.publicConfig().mapsApiKey || '' }));

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

  // Agendador externo (ex.: cron do Render) para os prazos automáticos.
  app.post(
    '/api/cron/sweep',
    wrap(async (req) => {
      const key = String(req.headers['x-cron-key'] || '');
      if (!options.cronSecret || key !== options.cronSecret) throw new AppError(401, 'unauthorized', 'Chave inválida.');
      return (await service()).sweep(true);
    }),
  );

  // ----- com login
  const api = express.Router();
  api.use(requireAuth);
  const limited = rateLimit(20, 60_000);

  api.get('/bootstrap', wrap(async (req) => (await service()).bootstrap(a(req))));
  api.patch('/profile', wrap(async (req) => (await service()).updateProfile(a(req), req.body || {})));

  api.post('/rides/quote', wrap(async (req) => (await service()).quoteRide(a(req), req.body || {})));
  api.post('/driver/location', rateLimit(30, 60_000), wrap(async (req) => (await service()).updateLocation(a(req), req.body?.lat, req.body?.lng)));
  api.post('/sos', rateLimit(5, 60_000), wrap(async (req) => (await service()).createSos(a(req), req.body || {})));
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

  api.post('/wallet/topup', limited, wrap(async (req) => (await service()).createTopup(a(req), req.body?.amount)));
  api.post('/wallet/topups/:id/confirm', wrap(async (req) => (await service()).confirmTopup(id(req), a(req).uid)));
  api.post('/wallet/withdraw', limited, wrap(async (req) => (await service()).requestWithdrawal(a(req), req.body?.amount, req.body?.pixKey)));

  api.post(
    '/driver/documents',
    rateLimit(15, 60_000),
    wrap(async (req) => (await service()).uploadDocument(a(req), req.body?.kind, req.body?.docType, req.body?.contentType, req.body?.dataBase64)),
  );
  api.post('/driver/apply', limited, wrap(async (req) => (await service()).applyAsProvider(a(req), req.body?.kind, req.body || {})));

  api.get('/admin/overview', wrap(async (req) => (await service()).adminOverview(a(req))));
  api.post(
    '/admin/applications/:id',
    wrap(async (req) => (await service()).reviewApplication(a(req), id(req), req.body?.kind, req.body?.decision, req.body?.reason)),
  );
  api.get('/admin/users', wrap(async (req) => (await service()).adminUsers(a(req), req.query.q)));
  api.post('/admin/users/:id/block', wrap(async (req) => (await service()).setBlocked(a(req), id(req), req.body?.blocked, req.body?.reason)));
  api.get('/admin/reports', wrap(async (req) => (await service()).adminReports(a(req), req.query.days)));
  api.patch('/admin/settings', wrap(async (req) => (await service()).updateSettings(a(req), req.body || {})));
  api.post('/admin/sos/:id/resolve', wrap(async (req) => (await service()).resolveSos(a(req), id(req), req.body?.note)));
  api.post('/admin/withdrawals/:id', wrap(async (req) => (await service()).resolveWithdrawal(a(req), id(req), req.body?.decision)));

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  return app;
}
