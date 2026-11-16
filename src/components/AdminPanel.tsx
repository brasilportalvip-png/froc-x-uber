import React, { useCallback, useEffect, useState } from 'react';
import { formatBRL } from '../data/locations.ts';
import { api } from '../lib/session.ts';
import { AiTeamPanel, AuditPanel, BlogAdminPanel, ProposalsBox, SupportAdminPanel } from './AdminAiPanels.tsx';
import type { AdminOverview, AdminReport, AdminUserRow, PlatformSettingsView } from '../types/mobility.ts';

const DOC_LABEL: Record<string, string> = { cnh: 'CNH', crlv: 'CRLV', antt: 'ANTT', antecedentes: 'antecedentes' };
const DECL_LABEL: Record<string, string> = {
  ear: 'EAR na CNH',
  inss: 'INSS',
  seguroApp: 'seguro APP',
  lei12009: 'Lei 12.009 (moto)',
  rntrc: 'RNTRC ativo',
  ciotPiso: 'CIOT e piso ANTT',
  responsavel: 'responsável pelos pedidos',
  proibidos: 'itens proibidos',
  veracidade: 'veracidade',
};
const KIND_NAME: Record<string, string> = { driver: 'Motorista', trucker: 'Transportador de carga', merchant: 'Loja (Froc Entregas)' };
const KIND_LABEL: Record<string, string> = {
  corrida: 'Corridas (Uber/99)',
  indrive: 'Negociadas (inDrive)',
  carona: 'Caronas',
  frete: 'Fretes e mudanças',
  retorno_vazio: 'Retorno vazio',
  fidelidade: 'Bônus de fidelidade (custo)',
};
type Tab = 'equipe' | 'pendencias' | 'sos' | 'atendimento' | 'usuarios' | 'relatorios' | 'blog' | 'config' | 'auditoria';

/** Painel da administração: cadastros, saques, SOS, usuários, relatórios e configurações. */
export const AdminPanel: React.FC<{ onToast: (msg: string) => void }> = ({ onToast }) => {
  const [tab, setTab] = useState<Tab>('equipe');
  const [data, setData] = useState<AdminOverview | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [identities, setIdentities] = useState<Record<string, { cpf: string; birthDate: string; declaredName: string; legalName: string } | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [report, setReport] = useState<AdminReport | null>(null);
  const [days, setDays] = useState(30);
  const [settings, setSettings] = useState<PlatformSettingsView | null>(null);

  const load = useCallback(async () => {
    try {
      const overview = await api<AdminOverview>('/api/admin/overview');
      setData(overview);
      setSettings((s) => s ?? overview.settings);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  const loadUsers = async (q = search) => setUsers(await api<AdminUserRow[]>(`/api/admin/users?q=${encodeURIComponent(q)}`));
  const loadReport = async (d = days) => setReport(await api<AdminReport>(`/api/admin/reports?days=${d}`));

  useEffect(() => {
    if (tab === 'usuarios' && !users) void loadUsers().catch((e) => onToast(e.message));
    if (tab === 'relatorios') void loadReport().catch((e) => onToast(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const act = async (fn: () => Promise<unknown>, msg: string, after?: () => Promise<unknown>) => {
    try {
      await fn();
      onToast(msg);
      await load();
      if (after) await after();
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Erro.');
    }
  };

  if (!data)
    return error ? (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 space-y-2">
        <div>{error}</div>
        <button type="button" onClick={() => void load()} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold cursor-pointer">
          Tentar novamente
        </button>
      </div>
    ) : (
      <div className="text-sm text-slate-500">Carregando...</div>
    );

  const card = 'rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-2';
  const input = 'w-full min-h-[38px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3';
  const tabs: [Tab, string][] = [
    ['equipe', '🤖 Equipe IA'],
    ['pendencias', `Pendências (${data.totals.pendingApplications + data.totals.pendingWithdrawals})`],
    ['sos', `SOS (${data.totals.openSos})`],
    ['atendimento', 'Atendimento'],
    ['usuarios', 'Usuários'],
    ['relatorios', 'Relatórios'],
    ['blog', 'Blog e SEO'],
    ['config', 'Configurações'],
    ['auditoria', 'Auditoria'],
  ];

  return (
    <div className="space-y-4 text-xs">
      {data.totals.openSos > 0 && (
        <button type="button" onClick={() => setTab('sos')} className="w-full rounded-2xl bg-red-600 text-white font-bold p-3 animate-pulse cursor-pointer">
          ⚠ {data.totals.openSos} alerta(s) de SOS aberto(s): toque para ver
        </button>
      )}
      <div className="flex gap-1.5 overflow-x-auto froc-scroll pb-1">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 min-h-[36px] rounded-full font-semibold whitespace-nowrap cursor-pointer ${
              tab === id ? 'bg-slate-900 text-white dark:bg-emerald-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'equipe' && <AiTeamPanel onToast={onToast} />}
      {tab !== 'equipe' && <ProposalsBox onToast={onToast} />}
      {tab === 'atendimento' && <SupportAdminPanel onToast={onToast} />}
      {tab === 'blog' && <BlogAdminPanel onToast={onToast} />}
      {tab === 'auditoria' && <AuditPanel onToast={onToast} />}

      {tab === 'pendencias' && (
        <>
          <div className="text-slate-500">Usuários cadastrados: {data.totals.users}</div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">Cadastros aguardando análise</h4>
          {data.applications.length === 0 && <div className="text-slate-500">Nenhum cadastro pendente.</div>}
          {data.applications.map((app) => {
            const key = app.uid + app.kind;
            return (
              <div key={key} className={card}>
                <div className="font-bold text-sm text-slate-900 dark:text-white">
                  {app.name} · {KIND_NAME[app.kind] || app.kind}
                  {app.kind === 'driver' && app.vehicleType === 'moto' ? ' · MOTO' : ''}
                </div>
                <div className="text-slate-600 dark:text-slate-300">
                  {app.email} · {app.phone}
                </div>
                {app.kind === 'merchant' ? (
                  <div className="text-slate-600 dark:text-slate-300 space-y-0.5">
                    <div>
                      <strong>{app.companyName}</strong> · {app.category}
                    </div>
                    <div>
                      CNPJ <strong className="font-mono-num">{app.cnpj}</strong> ·{' '}
                      <a href="https://solucoes.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_solicitacao.asp" target="_blank" rel="noreferrer" className="font-semibold text-emerald-700 dark:text-emerald-400 underline">
                        conferir na Receita
                      </a>
                    </div>
                    <div>Coleta: {app.pickupAddress}</div>
                  </div>
                ) : (
                  <div className="text-slate-600 dark:text-slate-300 space-y-0.5">
                    <div>
                      {app.vehicle} · placa <strong className="font-mono-num">{app.plate}</strong>
                      {app.vehicleYear ? ` · ano ${app.vehicleYear}` : ''}
                      {app.truckType ? ` · ${app.truckType}` : ''}
                      {app.companyName ? ` · ${app.companyName}` : ''}
                    </div>
                    {app.city && (
                      <div>
                        Trabalha em {app.city}/{app.state}
                        {app.minVehicleYear ? (
                          <span className={app.vehicleYear && app.vehicleYear < app.minVehicleYear ? 'text-red-600 font-bold' : ''}>
                            {' '}
                            · ano mínimo {app.minVehicleYear}
                          </span>
                        ) : null}
                      </div>
                    )}
                    {app.cnhExpiry && <div>CNH válida até {app.cnhExpiry.split('-').reverse().join('/')} · confira a observação EAR na foto da CNH</div>}
                    {app.aiDocCheck && (
                      <div className={app.aiDocCheck.ok ? 'text-emerald-600' : 'text-amber-600'}>
                        🤖 IA leu a CNH:{' '}
                        {app.aiDocCheck.ok ? 'CPF, nome e nascimento conferem (CPF verificado)' : app.aiDocCheck.reasons.join(' ')}
                        {app.aiDocCheck.ear === true ? ' · EAR encontrada' : app.aiDocCheck.ear === false ? ' · SEM EAR na CNH' : ''}
                        {app.aiDocCheck.validade ? ` · validade lida ${app.aiDocCheck.validade.split('-').reverse().join('/')}` : ''}
                      </div>
                    )}
                    {app.cpf ? (
                      <div>
                        CPF informado <strong className="font-mono-num">{app.cpf}</strong> · nome {app.legalName} — <strong>confira se é o mesmo da CNH</strong> (aprovar marca o CPF como verificado)
                      </div>
                    ) : (
                      <div className="text-amber-600">Sem CPF cadastrado.</div>
                    )}
                  </div>
                )}
                {app.declarations && Object.keys(app.declarations).length > 0 && (
                  <div className="text-[11px] text-slate-500">Declarou: {Object.keys(app.declarations).map((k) => DECL_LABEL[k] || k).join(' · ')}</div>
                )}
                {app.kind === 'trucker' && (
                  <div className="text-slate-600 dark:text-slate-300">
                    RNTRC <strong className="font-mono-num">{app.rntrc || 'não informado'}</strong>
                    {app.rntrc && (
                      <>
                        {' · '}
                        <a href="https://consultapublica.antt.gov.br/Site/ConsultaRNTRC.aspx" target="_blank" rel="noreferrer" className="font-semibold text-emerald-700 dark:text-emerald-400 underline">
                          conferir na ANTT
                        </a>
                      </>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {app.documents.map((d) => (
                    <a key={d.type} href={d.url} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 font-semibold text-emerald-700 dark:text-emerald-400">
                      Ver {DOC_LABEL[d.type] || d.type}
                    </a>
                  ))}
                </div>
                <input placeholder="Motivo (obrigatório para recusar)" value={reasons[key] || ''} onChange={(e) => setReasons((r) => ({ ...r, [key]: e.target.value }))} className={input} />
                <div className="flex gap-2">
                  <button type="button" onClick={() => act(() => api(`/api/admin/applications/${app.uid}`, { body: { kind: app.kind, decision: 'approved' } }), 'Cadastro aprovado.')} className="flex-1 min-h-[38px] rounded-lg bg-emerald-600 text-white font-bold cursor-pointer">
                    Aprovar
                  </button>
                  <button
                    type="button"
                    onClick={() => act(() => api(`/api/admin/applications/${app.uid}`, { body: { kind: app.kind, decision: 'rejected', reason: reasons[key] || '' } }), 'Cadastro recusado.')}
                    className="flex-1 min-h-[38px] rounded-lg border border-red-300 text-red-700 font-bold cursor-pointer"
                  >
                    Recusar
                  </button>
                </div>
              </div>
            );
          })}

          <h4 className="text-sm font-bold text-slate-900 dark:text-white pt-2">Saques para pagar</h4>
          {data.withdrawals.length === 0 && <div className="text-slate-500">Nenhum saque pendente.</div>}
          {data.withdrawals.map((w) => (
            <div key={w.id} className={card}>
              <div className="font-bold text-slate-900 dark:text-white">
                {w.name} · {formatBRL(w.amount)}
              </div>
              <div>
                Chave Pix{w.pixKeyType ? ` (${w.pixKeyType})` : ''}: <strong className="font-mono-num select-all">{w.pixKey}</strong>
              </div>
              <div className={w.status === 'approved' ? 'text-emerald-600 font-semibold' : 'text-slate-500'}>
                {w.status === 'approved'
                  ? 'Liberado pela Equipe IA (regras conferidas). Falta só o Pix: ligue o envio automático do Mercado Pago para nem isso precisar.'
                  : 'Em análise pelo Financeiro da Equipe IA (fora das regras de liberação automática).'}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => act(() => api(`/api/admin/withdrawals/${w.id}`, { body: { decision: 'paid' } }), 'Saque marcado como pago.')} className="flex-1 min-h-[38px] rounded-lg bg-emerald-600 text-white font-bold cursor-pointer">
                  Já paguei
                </button>
                <button type="button" onClick={() => act(() => api(`/api/admin/withdrawals/${w.id}`, { body: { decision: 'rejected' } }), 'Saque recusado e devolvido.')} className="flex-1 min-h-[38px] rounded-lg border border-red-300 text-red-700 font-bold cursor-pointer">
                  Recusar (devolver)
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'sos' && (
        <>
          {data.sos.length === 0 && <div className="text-slate-500">Nenhum alerta aberto.</div>}
          {data.sos.map((a) => (
            <div key={a.id} className="rounded-2xl border-2 border-red-500 bg-red-50 dark:bg-red-950/30 p-4 space-y-1.5">
              <div className="font-bold text-sm text-red-700 dark:text-red-300">
                SOS · {a.name} · {new Date(a.createdAt).toLocaleString('pt-BR')}
              </div>
              <div>
                Telefone: <a className="underline font-mono-num" href={`tel:${a.phone}`}>{a.phone || 'não informado'}</a> · {a.email}
              </div>
              {a.trip && (
                <div>
                  {a.trip.origin} → {a.trip.destination}
                  {a.trip.driverName ? ` · motorista ${a.trip.driverName} (${a.trip.vehicleModel} · ${a.trip.vehiclePlate})` : ''}
                  {a.trip.passengerName ? ` · passageiro ${a.trip.passengerName}` : ''}
                </div>
              )}
              {a.message && <div>Mensagem: {a.message}</div>}
              {a.lat != null && a.lng != null && (
                <a className="underline text-emerald-700" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${a.lat},${a.lng}`}>
                  Ver localização no mapa
                </a>
              )}
              <input placeholder="O que foi feito (opcional)" value={reasons[a.id] || ''} onChange={(e) => setReasons((r) => ({ ...r, [a.id]: e.target.value }))} className={input} />
              <button type="button" onClick={() => act(() => api(`/api/admin/sos/${a.id}/resolve`, { body: { note: reasons[a.id] || '' } }), 'Alerta resolvido.')} className="w-full min-h-[38px] rounded-lg bg-slate-900 text-white font-bold cursor-pointer">
                Marcar como resolvido
              </button>
            </div>
          ))}
        </>
      )}

      {tab === 'usuarios' && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void loadUsers().catch((err) => onToast(err.message));
            }}
            className="flex gap-2"
          >
            <input placeholder="Buscar por e-mail exato, CPF, nome ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} className={input} />
            <button type="submit" className="px-4 rounded-xl bg-slate-900 dark:bg-emerald-600 text-white font-bold cursor-pointer">
              Buscar
            </button>
          </form>
          {users?.length === 0 && <div className="text-slate-500">Nenhum usuário encontrado.</div>}
          {users?.map((u) => (
            <div key={u.uid} className={card}>
              <div className="font-bold text-slate-900 dark:text-white">
                {u.name} {u.blocked && <span className="text-red-600">· BLOQUEADO</span>}
                {u.qualityAlert && <span className="text-amber-600"> · REVISAR QUALIDADE ({u.qualityAlert})</span>}
                {u.merchantStatus === 'approved' && <span className="text-emerald-600"> · LOJA</span>}
                {u.multiAccountFlag && <span className="text-red-600"> · POSSÍVEL MULTICONTA ({u.multiAccountFlag})</span>}
              </div>
              <div className="text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-2">
                <span>
                  CPF {u.cpfMasked || 'não cadastrado'} ·{' '}
                  {u.cpfStatus === 'verified' ? `verificado (${u.cpfSource})` : u.cpfStatus === 'basic' ? 'cadastrado, falta conferir' : u.cpfStatus === 'rejected' ? 'recusado' : 'pendente'}
                  {u.aiDocCheck && !u.aiDocCheck.ok ? ` · IA: ${u.aiDocCheck.reasons.join(' ')}` : ''}
                </span>
                {u.cpfMasked && (
                  <button
                    type="button"
                    onClick={() =>
                      act(async () => {
                        const r = await api<{ identity: { cpf: string; birthDate: string; declaredName: string; legalName: string } | null }>(`/api/admin/users/${u.uid}/identity`);
                        setIdentities((m) => ({ ...m, [u.uid]: r.identity }));
                      }, 'Dados do CPF abertos (acesso registrado na auditoria).')
                    }
                    className="underline font-semibold cursor-pointer"
                  >
                    Ver CPF
                  </button>
                )}
              </div>
              {identities[u.uid] && (
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2 space-y-1">
                  <div>
                    <strong className="font-mono-num select-all">{identities[u.uid]!.cpf}</strong> · nascimento {identities[u.uid]!.birthDate.split('-').reverse().join('/')} · nome: {identities[u.uid]!.legalName}
                  </div>
                  <a href="https://servicos.receita.fazenda.gov.br/servicos/cpf/consultasituacao/consultapublica.asp" target="_blank" rel="noreferrer" className="underline font-semibold text-emerald-700 dark:text-emerald-400">
                    Conferir na Receita (CPF + nascimento)
                  </a>
                  {u.cpfStatus !== 'verified' && (
                    <div className="flex gap-2 pt-1">
                      <button type="button" onClick={() => act(() => api(`/api/admin/users/${u.uid}/cpf`, { body: { decision: 'verified' } }), 'CPF marcado como conferido.', () => loadUsers())} className="px-3 min-h-[34px] rounded-lg bg-emerald-600 text-white font-bold cursor-pointer">
                        Conferido: nome bate
                      </button>
                      <button
                        type="button"
                        onClick={() => act(() => api(`/api/admin/users/${u.uid}/cpf`, { body: { decision: 'rejected', reason: reasons['c' + u.uid] || 'CPF não confere com o nome' } }), 'CPF recusado: a pessoa terá de informar de novo.', () => loadUsers())}
                        className="px-3 min-h-[34px] rounded-lg border border-red-300 text-red-700 font-bold cursor-pointer"
                      >
                        CPF não confere
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div className="text-slate-600 dark:text-slate-300">
                {u.email} · {u.phone || 'sem telefone'} · desde {new Date(u.createdAt).toLocaleDateString('pt-BR')}
              </div>
              <div className="text-slate-600 dark:text-slate-300">
                Saldo {formatBRL(u.balance)} · {u.completedTrips} serviços · ★ motorista {u.rating} · ★ passageiro {u.passengerRating} · motorista: {u.driverStatus} · caminhoneiro: {u.truckerStatus}
              </div>
              {u.blocked ? (
                <button type="button" onClick={() => act(() => api(`/api/admin/users/${u.uid}/block`, { body: { blocked: false } }), 'Conta desbloqueada.', () => loadUsers())} className="px-3 min-h-[36px] rounded-lg border border-emerald-400 text-emerald-700 font-bold cursor-pointer">
                  Desbloquear
                </button>
              ) : (
                <div className="flex gap-2">
                  <input placeholder="Motivo do bloqueio" value={reasons['b' + u.uid] || ''} onChange={(e) => setReasons((r) => ({ ...r, ['b' + u.uid]: e.target.value }))} className={input} />
                  <button
                    type="button"
                    onClick={() => act(() => api(`/api/admin/users/${u.uid}/block`, { body: { blocked: true, reason: reasons['b' + u.uid] || '' } }), 'Conta bloqueada.', () => loadUsers())}
                    className="px-3 rounded-lg border border-red-300 text-red-700 font-bold cursor-pointer whitespace-nowrap"
                  >
                    Bloquear
                  </button>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {tab === 'relatorios' && (
        <>
          <div className="flex gap-2">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDays(d);
                  void loadReport(d).catch((e) => onToast(e.message));
                }}
                className={`px-3 min-h-[34px] rounded-full font-semibold cursor-pointer ${days === d ? 'bg-slate-900 text-white dark:bg-emerald-600' : 'bg-slate-100 dark:bg-slate-800'}`}
              >
                {d} dias
              </button>
            ))}
          </div>
          {!report ? (
            <div className="text-slate-500">Carregando...</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Serviços concluídos', String(report.completedServices)],
                  ['Volume movimentado', formatBRL(report.grossVolume)],
                  ['Receita da plataforma', formatBRL(report.platformRevenue)],
                  ['Motoristas online agora', String(report.driversOnline)],
                ].map(([label, value]) => (
                  <div key={label} className={card}>
                    <div className="text-slate-500">{label}</div>
                    <div className="text-lg font-bold font-mono-num text-slate-900 dark:text-white">{value}</div>
                  </div>
                ))}
              </div>
              <div className={card}>
                <div className="font-bold text-slate-900 dark:text-white">Por modalidade</div>
                {Object.keys(report.byKind).length === 0 && <div className="text-slate-500">Sem serviços no período.</div>}
                {(Object.entries(report.byKind) as [string, { count: number; gross: number; fee: number }][]).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 py-1 border-b border-slate-100 dark:border-slate-800">
                    <span>{KIND_LABEL[k] || k}</span>
                    <span className="font-mono-num">
                      {v.count} · {formatBRL(v.gross)} · taxa {formatBRL(v.fee)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {tab === 'config' && settings && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => setSettings(await api<PlatformSettingsView>('/api/admin/settings', { method: 'PATCH', body: settings })), 'Configurações salvas.');
          }}
          className={card}
        >
          {(
            [
              ['commissionPercent', 'Comissão da plataforma (%)', 0, 40, 1],
              ['maxSurge', 'Preço dinâmico máximo (x)', 1, 3, 0.1],
              ['rideSearchTimeoutMin', 'Cancelar corrida sem motorista após (min)', 3, 60, 1],
              ['indriveOpenTimeoutMin', 'Expirar negociação sem resposta após (min)', 5, 240, 1],
              ['pointsPerReal', 'Pontos por R$ 1 gasto', 0, 10, 1],
              ['pointsPerRedeem', 'Pontos para R$ 5 de crédito', 20, 10000, 1],
              ['maxVehicleAgeYears', 'Idade máxima do veículo (anos; a cidade mais rígida prevalece)', 3, 25, 1],
              ['platformFeeMin', 'Ganho mínimo da Froc por corrida (R$)', 0, 20, 0.5],
              ['platformFeeMax', 'Ganho máximo da Froc por corrida (R$)', 1, 40, 0.5],
              ['platformFeeMaxPct', 'Froc nunca fica com mais que (% da corrida)', 5, 50, 1],
              ['autoPayoutLimit', 'Equipe IA libera saque sozinha até (R$)', 0, 20000, 50],
            ] as [keyof PlatformSettingsView, string, number, number, number][]
          ).map(([key, label, min, max, step]) => (
            <label key={key} className="flex items-center justify-between gap-3">
              <span>{label}</span>
              <input
                type="number"
                min={min}
                max={max}
                step={step}
                value={Number(settings[key])}
                onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
                className="w-24 min-h-[36px] rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2 font-mono-num"
              />
            </label>
          ))}
          <label className="flex items-center justify-between gap-3">
            <span>Preço dinâmico por região (H3) ligado</span>
            <input type="checkbox" checked={settings.surgeEnabled} onChange={(e) => setSettings({ ...settings, surgeEnabled: e.target.checked })} className="w-5 h-5" />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>Dinâmico por horário (madrugada, picos, almoço, noite, fim de semana)</span>
            <input type="checkbox" checked={settings.timeSurgeEnabled} onChange={(e) => setSettings({ ...settings, timeSurgeEnabled: e.target.checked })} className="w-5 h-5" />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-2">
            <span>
              <strong>Autonomia total da Equipe IA</strong>: pagar, aprovar, verificar, bloquear e configurar sozinha (tudo fica na Auditoria)
            </span>
            <input type="checkbox" checked={settings.agentAutonomy} onChange={(e) => setSettings({ ...settings, agentAutonomy: e.target.checked })} className="w-5 h-5" />
          </label>
          <button type="submit" className="w-full min-h-[40px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white font-bold cursor-pointer">
            Salvar configurações
          </button>
          <p className="text-slate-500">
            Corridas, negociação e entregas: a Froc fica com um valor fixo entre o mínimo e o máximo acima. A comissão % vale para caronas e fretes. Mudanças valem para os próximos pedidos.
          </p>
        </form>
      )}
      {tab === 'config' && <RiskZonesBox onToast={onToast} />}
    </div>
  );
};

/** Áreas de risco: acréscimo que vai todo para o motorista (a Equipe IA também cadastra). */
const RiskZonesBox: React.FC<{ onToast: (m: string) => void }> = ({ onToast }) => {
  const [zones, setZones] = useState<{ id: string; name: string; lat: number; lng: number; radiusKm: number; surchargePct: number; when: string; active: boolean }[]>([]);
  const [form, setForm] = useState({ name: '', lat: '', lng: '', radiusKm: '1', surchargePct: '15', when: 'sempre' });
  const load = () => {
    void api<{ zones: typeof zones }>('/api/admin/risk-zones').then((r) => setZones(r.zones), () => undefined);
  };
  useEffect(() => {
    load();
  }, []);
  const save = async (body: Record<string, unknown>, msg: string) => {
    try {
      await api('/api/admin/risk-zones', { body });
      onToast(msg);
      load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Erro.');
    }
  };
  const field = 'min-h-[36px] rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2';
  return (
    <div className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-2 text-xs mt-3">
      <h4 className="text-sm font-bold text-slate-900 dark:text-white">Áreas de risco</h4>
      <p className="text-slate-500">Corridas que começam ou terminam aqui custam mais (o acréscimo vai todo para o motorista) e a taxa da Froc sobe R$ 1.</p>
      {zones.length === 0 && <div className="text-slate-500">Nenhuma área cadastrada.</div>}
      {zones.map((z) => (
        <div key={z.id} className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 py-1.5">
          <span className={z.active ? '' : 'line-through text-slate-400'}>
            {z.name} · raio {z.radiusKm} km · +{z.surchargePct}% · {z.when}
          </span>
          <button type="button" onClick={() => void save({ ...z, active: !z.active }, z.active ? 'Área desativada.' : 'Área ativada.')} className="underline font-semibold cursor-pointer">
            {z.active ? 'Desativar' : 'Ativar'}
          </button>
        </div>
      ))}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
        <input placeholder="Nome da área" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${field} col-span-2 sm:col-span-3`} />
        <input placeholder="Latitude" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} className={field} />
        <input placeholder="Longitude" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} className={field} />
        <button
          type="button"
          onClick={() =>
            navigator.geolocation?.getCurrentPosition((p) => setForm((f) => ({ ...f, lat: p.coords.latitude.toFixed(5), lng: p.coords.longitude.toFixed(5) })))
          }
          className={`${field} font-semibold cursor-pointer`}
        >
          Usar onde estou
        </button>
        <input placeholder="Raio (km)" value={form.radiusKm} onChange={(e) => setForm({ ...form, radiusKm: e.target.value })} className={field} />
        <input placeholder="Acréscimo %" value={form.surchargePct} onChange={(e) => setForm({ ...form, surchargePct: e.target.value })} className={field} />
        <select value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} className={`${field} bg-slate-50 dark:bg-slate-900`}>
          <option value="sempre">O dia todo</option>
          <option value="noite">Só à noite (19h–6h)</option>
        </select>
      </div>
      <button
        type="button"
        onClick={() => void save({ ...form, lat: Number(form.lat), lng: Number(form.lng), radiusKm: Number(form.radiusKm), surchargePct: Number(form.surchargePct) }, 'Área de risco salva.')}
        className="w-full min-h-[38px] rounded-xl bg-slate-900 dark:bg-emerald-600 text-white font-bold cursor-pointer"
      >
        Salvar área
      </button>
    </div>
  );
};
