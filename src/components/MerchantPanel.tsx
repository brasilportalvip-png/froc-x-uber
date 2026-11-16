import React, { useEffect, useState } from 'react';
import { Bike, Copy, KeyRound, Package, Store, Webhook } from 'lucide-react';
import { api } from '../lib/session.ts';
import { BRAZIL_LOCATIONS, formatBRL } from '../data/locations.ts';
import type { DeliveryView, GeoPoint, UserProfile } from '../types/mobility.ts';
import { PlacePicker } from './PlacePicker.tsx';

interface Props {
  profile: UserProfile;
  deliveries: DeliveryView[];
  mapsEnabled: boolean;
  onChanged: () => Promise<void> | void;
  onToast: (msg: string) => void;
}

interface ApiKeyView {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string;
  revoked: boolean;
}

const CATEGORIES: [string, string][] = [
  ['lanchonete', 'Lanchonete'],
  ['pastelaria', 'Pastelaria'],
  ['restaurante', 'Restaurante'],
  ['pizzaria', 'Pizzaria'],
  ['padaria', 'Padaria'],
  ['mercado', 'Mercado'],
  ['farmacia', 'Farmácia'],
  ['pet', 'Pet shop'],
  ['loja', 'Loja'],
  ['outro', 'Outro'],
];

const blankPoint = (): GeoPoint => ({ ...BRAZIL_LOCATIONS[0], id: 'escolher', name: 'Toque para buscar o endereço' });
const input = 'w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 text-xs';
const card = 'rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-3 text-xs';
const ACTIVE = ['procurando_entregador', 'entregador_a_caminho', 'entregador_na_loja', 'saiu_para_entrega'];

/** Froc Entregas: cadastro da loja, chamar entregador, acompanhar entregas e integrar o sistema da loja. */
export const MerchantPanel: React.FC<Props> = ({ profile, deliveries, mapsEnabled, onChanged, onToast }) => {
  const status = profile.merchantStatus || 'none';
  const [open, setOpen] = useState(status !== 'none');
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) onToast(ok);
      await onChanged();
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setBusy(null);
    }
  };

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${card} w-full text-left flex items-center gap-3 cursor-pointer hover:border-emerald-500`}>
        <Store className="w-5 h-5 text-emerald-600 shrink-0" />
        <span>
          <span className="block text-sm font-bold text-slate-900 dark:text-white">Tem loja, lanchonete ou restaurante?</span>
          <span className="block text-slate-500">Use os entregadores da Froc: pelo painel ou integrando o seu sistema.</span>
        </span>
      </button>
    );

  if (status === 'pending')
    return (
      <div className={card}>
        <div className="text-sm font-bold text-slate-900 dark:text-white">Froc para lojas · cadastro em análise</div>
        <p className="text-slate-500">A equipe confere o CNPJ e libera em breve. Enquanto isso, recarregue a carteira para pagar as entregas.</p>
      </div>
    );

  if (status !== 'approved') return <MerchantApply profile={profile} busy={busy} run={run} mapsEnabled={mapsEnabled} />;

  return (
    <div className="space-y-3">
      <NewDelivery profile={profile} busy={busy} run={run} />
      <DeliveryList deliveries={deliveries} busy={busy} run={run} />
      <Integration profile={profile} onToast={onToast} onChanged={onChanged} />
    </div>
  );
};

type Run = (key: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>;

const MerchantApply: React.FC<{ profile: UserProfile; busy: string | null; run: Run; mapsEnabled: boolean }> = ({ profile, busy, run, mapsEnabled }) => {
  const [companyName, setCompanyName] = useState(profile.merchant?.companyName || '');
  const [cnpj, setCnpj] = useState(profile.merchant?.cnpj || '');
  const [phone, setPhone] = useState(profile.merchant?.phone || profile.phone || '');
  const [category, setCategory] = useState(profile.merchant?.category || 'lanchonete');
  const [pickup, setPickup] = useState<GeoPoint>(profile.merchant?.pickup || blankPoint());
  const [pickupNote, setPickupNote] = useState(profile.merchant?.pickupNote || '');
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const decl = [
    { id: 'responsavel', label: 'A loja é responsável pelo conteúdo, embalagem e nota fiscal de cada pedido.' },
    { id: 'proibidos', label: 'Não envio itens proibidos (armas, drogas, inflamáveis, animais) e bebida/cigarro só para maiores de 18 anos.' },
    { id: 'veracidade', label: 'Os dados da empresa são verdadeiros.' },
  ];
  return (
    <form
      className={card}
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          'apply',
          () => api('/api/merchant/apply', { body: { companyName, cnpj, phone, category, pickup, pickupNote, declarations: checks } }),
          'Cadastro da loja enviado para análise!',
        );
      }}
    >
      <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
        <Store className="w-4 h-4 text-emerald-600" /> Froc para lojas · cadastre sua loja
      </div>
      {profile.merchantStatus === 'rejected' && <div className="rounded-xl bg-red-50 dark:bg-red-950/30 p-2 text-red-700">Cadastro recusado: {profile.rejectionReason}. Corrija e envie de novo.</div>}
      <p className="text-slate-500">
        CNPJ (MEI aceito) e endereço de coleta. Depois de aprovada, a loja chama entregadores pelo painel ou pelo próprio sistema.{' '}
        <a href="/desenvolvedores" target="_blank" rel="noreferrer" className="underline font-semibold text-emerald-700 dark:text-emerald-400">
          Como funciona
        </a>
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Nome da loja (ex.: Pastelaria do Ricardo)" className={input} />
        <input required value={cnpj} onChange={(e) => setCnpj(e.target.value)} inputMode="numeric" placeholder="CNPJ" className={input} />
        <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefone com DDD" className={input} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${input} bg-slate-50 dark:bg-slate-900`}>
          {CATEGORIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {mapsEnabled ? (
        <PlacePicker label="Endereço de coleta (onde o entregador retira)" value={pickup} onChange={setPickup} mode="address" placeholder="Rua, número e cidade" />
      ) : (
        <p className="text-amber-600">O mapa não carregou. Recarregue a página para buscar o endereço de coleta.</p>
      )}
      <input value={pickupNote} onChange={(e) => setPickupNote(e.target.value)} placeholder="Referência para o entregador (opcional)" className={input} />
      {decl.map((d) => (
        <label key={d.id} className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={Boolean(checks[d.id])} onChange={(e) => setChecks((c) => ({ ...c, [d.id]: e.target.checked }))} className="mt-0.5 w-4 h-4 shrink-0" />
          <span className="text-slate-700 dark:text-slate-300">{d.label}</span>
        </label>
      ))}
      <button
        type="submit"
        disabled={busy !== null || pickup.id === 'escolher' || decl.some((d) => !checks[d.id])}
        className="w-full min-h-[44px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white font-bold disabled:opacity-50 cursor-pointer"
      >
        {busy === 'apply' ? 'Enviando...' : 'Enviar cadastro da loja'}
      </button>
    </form>
  );
};

const NewDelivery: React.FC<{ profile: UserProfile; busy: string | null; run: Run }> = ({ profile, busy, run }) => {
  const [dropoff, setDropoff] = useState<GeoPoint>(blankPoint());
  const [complement, setComplement] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [items, setItems] = useState('');
  const [note, setNote] = useState('');
  const [vehicle, setVehicle] = useState<'moto' | 'carro' | 'qualquer'>('moto');
  const [quote, setQuote] = useState<{ price: number; distanceKm: number; durationMin: number } | null>(null);
  const ready = dropoff.id !== 'escolher';
  const dropBody = () => ({ address: [dropoff.name, complement].filter(Boolean).join(' · '), lat: dropoff.lat, lng: dropoff.lng, city: dropoff.city, state: dropoff.state });

  useEffect(() => {
    if (!ready) {
      setQuote(null);
      return;
    }
    let alive = true;
    api<{ price: number; distanceKm: number; durationMin: number }>('/api/merchant/quote', { body: { dropoff: dropBody() } })
      .then((q) => {
        if (alive) setQuote(q);
      })
      .catch(() => {
        if (alive) setQuote(null);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropoff.lat, dropoff.lng, ready]);

  return (
    <form
      className={card}
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          'deliver',
          async () => {
            await api('/api/merchant/deliveries', {
              body: { dropoff: dropBody(), recipient: { name, phone }, items, note: [complement && `Complemento: ${complement}`, note].filter(Boolean).join(' · '), vehicle },
            });
            setDropoff(blankPoint());
            setComplement('');
            setName('');
            setPhone('');
            setItems('');
            setNote('');
          },
          'Entregador chamado! Mande o link e o código para o cliente.',
        );
      }}
    >
      <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
        <Package className="w-4 h-4 text-emerald-600" /> {profile.merchant?.companyName || 'Minha loja'} · chamar entregador
      </div>
      <PlacePicker label="Endereço do cliente" value={dropoff} onChange={setDropoff} mode="address" placeholder="Rua, número e bairro" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input value={complement} onChange={(e) => setComplement(e.target.value)} placeholder="Complemento (apto, bloco)" className={input} />
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do cliente" className={input} />
        <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefone do cliente com DDD" className={input} />
        <select value={vehicle} onChange={(e) => setVehicle(e.target.value as typeof vehicle)} className={`${input} bg-slate-50 dark:bg-slate-900`}>
          <option value="moto">Moto (até 20 kg)</option>
          <option value="carro">Carro</option>
          <option value="qualquer">Qualquer (mais rápido)</option>
        </select>
      </div>
      <input value={items} onChange={(e) => setItems(e.target.value)} placeholder="O que vai (ex.: 2 pastéis e 1 caldo de cana)" className={input} />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Observação para o entregador (opcional)" className={input} />
      {quote && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 px-3 py-2 flex justify-between">
          <span>
            {quote.distanceKm} km · ~{quote.durationMin} min
          </span>
          <strong className="font-mono-num">{formatBRL(quote.price)}</strong>
        </div>
      )}
      <button type="submit" disabled={busy !== null || !ready} className="w-full min-h-[44px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white font-bold disabled:opacity-50 cursor-pointer inline-flex items-center justify-center gap-2">
        <Bike className="w-4 h-4" /> {busy === 'deliver' ? 'Chamando...' : quote ? `Chamar entregador · ${formatBRL(quote.price)}` : 'Chamar entregador'}
      </button>
      <p className="text-[11px] text-slate-500">O valor sai da carteira da loja e fica retido. Só vai para o entregador quando o cliente informa o código de entrega.</p>
    </form>
  );
};

const DeliveryList: React.FC<{ deliveries: DeliveryView[]; busy: string | null; run: Run }> = ({ deliveries, busy, run }) => {
  if (!deliveries.length) return null;
  const link = (d: DeliveryView) => window.location.origin + d.trackingPath;
  const message = (d: DeliveryView) =>
    `Olá, ${d.recipient.name.split(' ')[0]}! Seu pedido saiu pela Froc Entregas. Acompanhe em tempo real: ${link(d)}\nCódigo de entrega: ${d.deliveryCode} (informe ao entregador só quando receber).`;
  const waNumber = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    return digits.length <= 11 ? `55${digits}` : digits;
  };
  return (
    <div className={card}>
      <div className="text-sm font-bold text-slate-900 dark:text-white">Entregas</div>
      {deliveries.slice(0, 30).map((d) => (
        <div key={d.id} className={`rounded-xl border p-3 space-y-1.5 ${ACTIVE.includes(d.status) ? 'border-emerald-400' : 'border-slate-200 dark:border-slate-800 opacity-80'}`}>
          <div className="flex justify-between gap-2">
            <strong className="text-slate-900 dark:text-white">{d.recipient.name}</strong>
            <span className="font-mono-num">{formatBRL(d.price)}</span>
          </div>
          <div className="text-slate-500 truncate">{d.dropoff.name}</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold">{d.statusLabel}</span>
            {ACTIVE.includes(d.status) && (
              <span>
                Código: <strong className="font-mono-num tracking-widest">{d.deliveryCode}</strong>
              </span>
            )}
            {d.courier && (
              <span className="text-slate-500">
                {d.courier.firstName} · {d.courier.vehicle} {d.courier.plate}
              </span>
            )}
            {d.orderRef && <span className="text-slate-400">Pedido {d.orderRef}</span>}
            {d.source === 'api' && <span className="text-slate-400">via sistema</span>}
          </div>
          {ACTIVE.includes(d.status) && (
            <div className="flex flex-wrap gap-2 pt-1">
              <a href={`https://wa.me/${waNumber(d.recipient.phone)}?text=${encodeURIComponent(message(d))}`} target="_blank" rel="noreferrer" className="px-3 min-h-[34px] inline-flex items-center rounded-lg bg-emerald-600 text-white font-semibold">
                Enviar link ao cliente
              </a>
              <a href={d.trackingPath} target="_blank" rel="noreferrer" className="px-3 min-h-[34px] inline-flex items-center rounded-lg border border-slate-300 dark:border-slate-700 font-semibold">
                Ver no mapa
              </a>
              {['procurando_entregador', 'entregador_a_caminho', 'entregador_na_loja'].includes(d.status) && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    if (window.confirm('Cancelar esta entrega? O valor volta para a carteira da loja.'))
                      void run(`cancel-${d.id}`, () => api(`/api/merchant/deliveries/${d.id}/cancel`, { body: {} }), 'Entrega cancelada. Valor devolvido.');
                  }}
                  className="px-3 min-h-[34px] rounded-lg border border-red-300 text-red-700 font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const Integration: React.FC<{ profile: UserProfile; onToast: (m: string) => void; onChanged: () => Promise<void> | void }> = ({ profile, onToast, onChanged }) => {
  const [show, setShow] = useState(false);
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [label, setLabel] = useState('');
  const [newKey, setNewKey] = useState('');
  const [hook, setHook] = useState(profile.merchant?.webhookUrl || '');
  const [secret, setSecret] = useState('');
  const load = () => {
    void api<{ keys: ApiKeyView[] }>('/api/merchant/keys').then((r) => setKeys(r.keys), () => undefined);
  };
  useEffect(() => {
    if (show) load();
  }, [show]);
  const copy = (v: string) => {
    void navigator.clipboard?.writeText(v).then(() => onToast('Copiado.'), () => undefined);
  };
  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Não foi possível concluir.');
    }
  };

  if (!show)
    return (
      <button type="button" onClick={() => setShow(true)} className={`${card} w-full text-left flex items-center gap-3 cursor-pointer hover:border-emerald-500`}>
        <KeyRound className="w-5 h-5 text-emerald-600 shrink-0" />
        <span>
          <span className="block text-sm font-bold text-slate-900 dark:text-white">Integrar o sistema da loja (API)</span>
          <span className="block text-slate-500">Seu sistema de pedidos chama o entregador sozinho e recebe cada mudança de situação.</span>
        </span>
      </button>
    );

  return (
    <div className={card}>
      <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-emerald-600" /> Integração (API)
      </div>
      <p className="text-slate-500">
        Passe a chave para quem cuida do seu sistema, junto com a{' '}
        <a href="/desenvolvedores" target="_blank" rel="noreferrer" className="underline font-semibold text-emerald-700 dark:text-emerald-400">
          documentação
        </a>
        . Nunca coloque a chave no site ou no app do cliente.
      </p>
      {newKey && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
          <div className="font-bold text-amber-800 dark:text-amber-200">Guarde agora: esta chave não aparece de novo.</div>
          <div className="flex gap-2 items-center">
            <code className="flex-1 break-all font-mono text-[11px]">{newKey}</code>
            <button type="button" onClick={() => copy(newKey)} className="p-2 rounded-lg border cursor-pointer" aria-label="Copiar chave">
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nome da chave (ex.: Sistema do caixa)" className={input} />
        <button
          type="button"
          onClick={() =>
            void act(async () => {
              const r = await api<{ key: string }>('/api/merchant/keys', { body: { label } });
              setNewKey(r.key);
              setLabel('');
              load();
            })
          }
          className="px-3 min-h-[40px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white font-semibold whitespace-nowrap cursor-pointer"
        >
          Criar chave
        </button>
      </div>
      {keys.map((k) => (
        <div key={k.id} className="flex items-center gap-2">
          <span className={`flex-1 truncate ${k.revoked ? 'line-through text-slate-400' : ''}`}>
            {k.label} · <code>{k.prefix}…</code> · {k.lastUsedAt ? `usada ${new Date(k.lastUsedAt).toLocaleString('pt-BR')}` : 'nunca usada'}
          </span>
          {!k.revoked && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Revogar esta chave? O sistema que usa ela para de funcionar na hora.'))
                  void act(async () => {
                    await api(`/api/merchant/keys/${k.id}/revoke`, { body: {} });
                    load();
                  });
              }}
              className="px-2 min-h-[32px] rounded-lg border border-red-300 text-red-700 font-semibold cursor-pointer"
            >
              Revogar
            </button>
          )}
        </div>
      ))}

      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
        <div className="font-semibold flex items-center gap-1.5">
          <Webhook className="w-4 h-4 text-emerald-600" /> Webhook (aviso automático no seu sistema)
        </div>
        <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://seusistema.com.br/froc/webhook" className={input} />
        {secret && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
            <div className="font-bold text-amber-800 dark:text-amber-200">Segredo de assinatura (guarde agora):</div>
            <div className="flex gap-2 items-center">
              <code className="flex-1 break-all font-mono text-[11px]">{secret}</code>
              <button type="button" onClick={() => copy(secret)} className="p-2 rounded-lg border cursor-pointer" aria-label="Copiar segredo">
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['Salvar', false],
              ['Trocar segredo', true],
            ] as [string, boolean][]
          ).map(([text, rotate]) => (
            <button
              key={text}
              type="button"
              onClick={() =>
                void act(async () => {
                  const r = await api<{ secret: string }>('/api/merchant/webhook', { body: { url: hook, rotate } });
                  if (r.secret) setSecret(r.secret);
                  onToast(hook ? 'Webhook salvo.' : 'Webhook removido.');
                  await onChanged();
                })
              }
              className="px-3 min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
            >
              {text}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              void act(async () => {
                const r = await api<{ ok: boolean; status: number; error?: string }>('/api/merchant/webhook/test', { body: {} });
                onToast(r.ok ? `Teste recebido pelo seu sistema (HTTP ${r.status}).` : `O teste falhou: ${r.error || `HTTP ${r.status}`}`);
              })
            }
            className="px-3 min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
          >
            Enviar teste
          </button>
        </div>
      </div>
    </div>
  );
};
