import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, ExternalLink, FileText, Loader2, RefreshCw, Send, ShieldAlert, X } from 'lucide-react';
import { api } from '../lib/session.ts';

type Toast = (msg: string) => void;

const card = 'rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-2';
const input = 'w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3';

interface Agent {
  id: string;
  name: string;
  emoji: string;
  area: string;
  mission: string;
}
interface ActionLog {
  tool: string;
  level: string;
  ok: boolean;
  result?: string;
  proposalId?: string;
}
interface ChatMsg {
  from: 'admin' | 'agent';
  text: string;
  agent?: string;
  actions?: ActionLog[];
}
interface Proposal {
  id: string;
  tool: string;
  summary: string;
  agentName: string;
  requestedBy: string;
  createdAt: string;
  status: string;
}

const LEVEL_LABEL: Record<string, string> = { ler: 'consultou', agir: 'fez', confirmar: 'preparou para você aprovar', negada: 'bloqueado' };

/** Propostas da Equipe IA que precisam do seu clique (dinheiro, banimento, aprovação, configurações). */
export const ProposalsBox: React.FC<{ onToast: Toast; refreshKey?: number }> = ({ onToast, refreshKey }) => {
  const [items, setItems] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setItems(await api<Proposal[]>('/api/admin/ai/proposals'));
    } catch {
      /* silencioso: a lista volta na próxima atualização */
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20000);
    return () => clearInterval(t);
  }, [load, refreshKey]);
  if (!items.length) return null;
  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(id);
    try {
      await api(`/api/admin/ai/proposals/${id}`, { body: { decision } });
      onToast(decision === 'approve' ? 'Aprovado e executado.' : 'Proposta recusada.');
      await load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Erro.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-2xl border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-2">
      <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-200">
        <ShieldAlert className="w-4 h-4" /> Aguardando sua aprovação ({items.length})
      </div>
      {items.map((p) => (
        <div key={p.id} className="rounded-xl bg-white dark:bg-black/40 border border-amber-200 dark:border-amber-900 p-3 space-y-2">
          <div className="font-semibold text-slate-900 dark:text-white">{p.summary}</div>
          <div className="text-[11px] text-slate-500">
            {p.agentName} · pedido por {p.requestedBy} · {new Date(p.createdAt).toLocaleString('pt-BR')}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy === p.id} onClick={() => void decide(p.id, 'approve')} className="flex-1 min-h-[38px] rounded-lg bg-emerald-600 text-white font-bold cursor-pointer inline-flex items-center justify-center gap-1">
              <Check className="w-4 h-4" /> Aprovar
            </button>
            <button type="button" disabled={busy === p.id} onClick={() => void decide(p.id, 'reject')} className="px-4 min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer inline-flex items-center gap-1">
              <X className="w-4 h-4" /> Recusar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

interface ModelHealth {
  model: string;
  state: 'ok' | 'instavel' | 'desligado' | 'indisponivel';
  successes: number;
  failures: number;
  lastError?: string;
  avgLatencyMs?: number;
  retryAfter?: string;
}
interface AiHealth {
  configured: boolean;
  keys: number;
  keysCooling: number;
  activeModel: string | null;
  models: ModelHealth[];
}

const STATE_LABEL: Record<ModelHealth['state'], [string, string]> = {
  ok: ['● no ar', 'text-emerald-600'],
  instavel: ['● instável', 'text-amber-500'],
  desligado: ['● em pausa (volta sozinho)', 'text-red-500'],
  indisponivel: ['● não existe nesta chave', 'text-slate-400'],
};

/** Anti-queda da IA: estado dos modelos 3.8 → 3.7 → 3.6 (e reservas) e das chaves, com teste na hora. */
export const AiHealthBox: React.FC<{ onToast: Toast }> = ({ onToast }) => {
  const [h, setH] = useState<AiHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string>('');
  const load = useCallback(() => api<AiHealth>('/api/admin/ai/health').then(setH).catch(() => undefined), []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!h) return null;
  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold text-slate-900 dark:text-white">🛡️ Anti-queda da IA</div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api<{ ok: boolean; model?: string; attempts?: number; ms: number; error?: string; health?: AiHealth }>('/api/admin/ai/ping', { body: {} });
              if (r.health) setH(r.health);
              setLast(r.ok ? `Respondeu: ${r.model} em ${(r.ms / 1000).toFixed(1)} s (${r.attempts} tentativa${r.attempts === 1 ? '' : 's'})` : `Falhou: ${r.error}`);
            } catch (e) {
              onToast(e instanceof Error ? e.message : 'Erro.');
            } finally {
              setBusy(false);
            }
          }}
          className="px-3 min-h-[32px] rounded-lg bg-emerald-600 text-white text-[11px] font-bold cursor-pointer inline-flex items-center gap-1"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Testar IA agora
        </button>
      </div>
      <div className="text-[11px] text-slate-500">
        Ordem: 3.8 → 3.7 → 3.6 → reservas. Falha passageira tenta de novo; modelo com defeito fica em pausa e a IA segue no próximo. Chaves: {h.keys}
        {h.keysCooling ? ` (${h.keysCooling} descansando por cota)` : ''}. {h.activeModel ? `Em uso: ${h.activeModel}.` : ''}
      </div>
      <div className="grid gap-1">
        {h.models.map((m) => (
          <div key={m.model} className="rounded-lg border border-slate-200 dark:border-slate-800 px-2.5 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono-num font-semibold text-slate-800 dark:text-slate-100">{m.model}</span>
              <span className={`text-[11px] font-bold ${STATE_LABEL[m.state][1]}`}>
                {STATE_LABEL[m.state][0]}
                {m.avgLatencyMs ? ` · ${(m.avgLatencyMs / 1000).toFixed(1)} s` : ''}
              </span>
            </div>
            {m.state !== 'ok' && m.lastError && <div className="mt-0.5 text-[10px] text-slate-500 break-words">Último erro: {m.lastError}</div>}
          </div>
        ))}
      </div>
      {last && <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{last}</div>}
      <div className="text-[10px] text-slate-400">Os números valem para o servidor que respondeu agora (a Vercel pode usar mais de um).</div>
    </div>
  );
};

/** Conversa com a Froc central ou com qualquer um dos 19 especialistas. */
export const AiTeamPanel: React.FC<{ onToast: Toast }> = ({ onToast }) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [configured, setConfigured] = useState(true);
  const [agentId, setAgentId] = useState('froc');
  const [conversations, setConversations] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('froc-ai-convs') || '{}');
    } catch {
      return {};
    }
  });
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [reports, setReports] = useState<{ id: string; day: string; text: string }[]>([]);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ configured: boolean; agents: Agent[] }>('/api/admin/ai/agents')
      .then((r) => {
        setAgents(r.agents);
        setConfigured(r.configured);
      })
      .catch((e) => onToast(e.message));
    api<{ id: string; day: string; text: string }[]>('/api/admin/ai/reports')
      .then(setReports)
      .catch(() => undefined);
  }, [onToast]);

  useEffect(() => {
    const conv = conversations[agentId];
    setMessages([]);
    if (conv)
      api<{ messages: ChatMsg[] }>(`/api/admin/ai/conversations/${conv}`)
        .then((r) => setMessages(r.messages || []))
        .catch(() => undefined);
  }, [agentId, conversations]);

  // Bloco com chaves de propósito: no Chrome novo, scrollIntoView() devolve uma Promise, e o
  // React trataria essa Promise como função de limpeza (erro "l is not a function").
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const msg = text.trim();
    if (!msg || busy) return;
    setText('');
    setMessages((m) => [...m, { from: 'admin', text: msg }]);
    setBusy(true);
    try {
      const r = await api<{ conversationId: string; reply: string; actions: ActionLog[] }>('/api/admin/ai/chat', {
        body: { agentId, message: msg, conversationId: conversations[agentId] },
      });
      setMessages((m) => [...m, { from: 'agent', text: r.reply, agent: agentId, actions: r.actions }]);
      if (r.conversationId !== conversations[agentId]) {
        const next = { ...conversations, [agentId]: r.conversationId };
        setConversations(next);
        try {
          localStorage.setItem('froc-ai-convs', JSON.stringify(next));
        } catch {
          /* sem armazenamento */
        }
      }
      if (r.actions.some((a) => a.level === 'confirmar')) setRefreshKey((k) => k + 1);
    } catch (err) {
      setMessages((m) => [...m, { from: 'agent', text: `⚠ ${err instanceof Error ? err.message : 'Erro.'}`, agent: agentId }]);
    } finally {
      setBusy(false);
    }
  };

  const newConversation = () => {
    const next = { ...conversations };
    delete next[agentId];
    setConversations(next);
    try {
      localStorage.setItem('froc-ai-convs', JSON.stringify(next));
    } catch {
      /* sem armazenamento */
    }
  };

  const current = agents.find((a) => a.id === agentId);

  return (
    <div className="space-y-3">
      {!configured && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-amber-900 dark:text-amber-200">
          A IA está desligada. Cadastre <strong>GEMINI_API_KEY</strong> na Vercel (a mesma chave da Froc.IA) e faça Redeploy.
        </div>
      )}
      <ProposalsBox onToast={onToast} refreshKey={refreshKey} />
      <AiHealthBox onToast={onToast} />

      <div className="flex gap-1.5 overflow-x-auto froc-scroll pb-1">
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAgentId(a.id)}
            title={a.mission}
            className={`shrink-0 px-3 min-h-[36px] rounded-full font-semibold whitespace-nowrap cursor-pointer border ${
              agentId === a.id ? 'bg-emerald-600 text-white border-transparent' : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
            }`}
          >
            {a.emoji} {a.name}
          </button>
        ))}
      </div>

      <div className={card}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-bold text-sm text-slate-900 dark:text-white">
              {current?.emoji} {current?.name || 'Froc'} <span className="text-[10px] font-semibold text-amber-600">· {current?.area}</span>
            </div>
            <div className="text-[11px] text-slate-500">{current?.mission}</div>
          </div>
          <button type="button" onClick={newConversation} className="shrink-0 text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold cursor-pointer">
            Nova conversa
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto froc-scroll space-y-2 py-2">
          {!messages.length && (
            <div className="text-slate-500 text-[11px]">
              Exemplos: “Como está o site hoje?”, “Tem saque parado?”, “Analise os cadastros pendentes”, “Escreva o post de hoje sobre fretes em Recife”.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.from === 'admin' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={`max-w-[88%] rounded-2xl px-3 py-2 whitespace-pre-wrap leading-relaxed ${
                  m.from === 'admin' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                }`}
              >
                {m.text}
                {!!m.actions?.length && (
                  <div className="mt-2 pt-2 border-t border-black/10 dark:border-white/10 space-y-0.5 text-[10px] opacity-80">
                    {m.actions.map((a, j) => (
                      <div key={j}>
                        {a.ok ? '✓' : '✗'} {LEVEL_LABEL[a.level] || a.level}: <strong>{a.tool}</strong>
                        {a.level === 'confirmar' && a.result ? ` — ${a.result}` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="inline-flex items-center gap-2 text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" /> {current?.name || 'Froc'} está trabalhando...
            </div>
          )}
          <div ref={end} />
        </div>
        <form onSubmit={send} className="flex gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={`Fale com ${current?.name || 'a Froc'}...`}
            className={`${input} py-2 resize-none`}
          />
          <button type="submit" disabled={busy || !text.trim()} aria-label="Enviar" className="w-12 shrink-0 rounded-xl bg-emerald-600 text-white flex items-center justify-center cursor-pointer disabled:opacity-50">
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between">
          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-amber-500" /> Relatórios diários da Froc
          </div>
          <button
            type="button"
            onClick={() =>
              api('/api/admin/ai/daily', { body: {} })
                .then(() => api<{ id: string; day: string; text: string }[]>('/api/admin/ai/reports').then(setReports))
                .then(() => onToast('Rotina do dia executada.'))
                .catch((e) => onToast(e.message))
            }
            className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Rodar agora
          </button>
        </div>
        {reports.length ? (
          reports.slice(0, 7).map((r) => (
            <details key={r.id} className="rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2">
              <summary className="cursor-pointer font-semibold">{r.day}</summary>
              <div className="pt-2 whitespace-pre-wrap text-slate-700 dark:text-slate-300">{r.text}</div>
            </details>
          ))
        ) : (
          <div className="text-slate-500">O primeiro relatório sai na próxima rotina diária (a partir das 7h).</div>
        )}
      </div>
    </div>
  );
};

interface SupportRow {
  uid: string;
  name: string;
  email: string;
  needsHuman: boolean;
  reason: string;
  lastMessage: string;
  updatedAt: string;
}
interface SupportMsg {
  from: 'user' | 'froc' | 'equipe';
  text: string;
  at: string;
  by?: string;
}

/** Atendimento: conversas das pessoas com a Froc; a equipe assume quando precisa. */
export const SupportAdminPanel: React.FC<{ onToast: Toast }> = ({ onToast }) => {
  const [rows, setRows] = useState<SupportRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<SupportMsg[]>([]);
  const [reply, setReply] = useState('');
  const load = useCallback(() => api<SupportRow[]>('/api/admin/support').then(setRows).catch((e) => onToast(e.message)), [onToast]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);
  const openChat = async (uid: string) => {
    setOpen(uid);
    const c = await api<{ messages: SupportMsg[] }>(`/api/admin/support/${uid}`);
    setMsgs(c.messages || []);
  };
  const send = async () => {
    if (!open || !reply.trim()) return;
    try {
      const c = await api<{ messages: SupportMsg[] }>(`/api/admin/support/${open}/reply`, { body: { text: reply } });
      setMsgs(c.messages || []);
      setReply('');
      void load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Erro.');
    }
  };
  return (
    <div className="space-y-3">
      {!rows.length && <div className={card}>Nenhum atendimento aberto. A Froc responde as pessoas na hora; quando ela pedir ajuda humana, aparece aqui primeiro.</div>}
      {rows.map((r) => (
        <div key={r.uid} className={`${card} ${r.needsHuman ? 'border-red-400 dark:border-red-700' : ''}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-bold text-slate-900 dark:text-white">
                {r.needsHuman && <span className="text-red-600">● precisa de gente · </span>}
                {r.name || r.email}
              </div>
              <div className="text-slate-500">{r.reason || r.lastMessage}</div>
            </div>
            <button type="button" onClick={() => void openChat(r.uid)} className="shrink-0 px-3 min-h-[34px] rounded-lg bg-emerald-600 text-white font-semibold cursor-pointer">
              Abrir
            </button>
          </div>
          {open === r.uid && (
            <div className="space-y-2 pt-2">
              <div className="max-h-72 overflow-y-auto froc-scroll space-y-1.5">
                {msgs.map((m, i) => (
                  <div key={i} className={`rounded-xl px-3 py-2 ${m.from === 'user' ? 'bg-slate-100 dark:bg-slate-800' : m.from === 'equipe' ? 'bg-amber-100 dark:bg-amber-900/40' : 'bg-emerald-50 dark:bg-emerald-950/40'}`}>
                    <div className="text-[10px] font-bold text-slate-500">{m.from === 'user' ? 'Pessoa' : m.from === 'equipe' ? `Equipe (${m.by || ''})` : 'Froc (IA)'}</div>
                    {m.text}
                  </div>
                ))}
              </div>
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="Responder como Equipe Froc..." className={`${input} py-2`} />
              <div className="flex gap-2">
                <button type="button" onClick={() => void send()} className="flex-1 min-h-[38px] rounded-lg bg-emerald-600 text-white font-bold cursor-pointer">
                  Enviar
                </button>
                <button
                  type="button"
                  onClick={() =>
                    api(`/api/admin/support/${r.uid}/close`, { body: {} })
                      .then(() => {
                        setOpen(null);
                        onToast('Atendimento encerrado.');
                        return load();
                      })
                      .catch((e) => onToast(e.message))
                  }
                  className="px-3 min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
                >
                  Encerrar
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

interface PostRow {
  id: string;
  image?: { mimeType: string };
  slug: string;
  title: string;
  description: string;
  published: boolean;
  createdAt: string;
  keyword: string;
}

/** Blog: o post diário sai sozinho; aqui você vê, gera outro na hora, publica ou tira do ar. */
export const BlogAdminPanel: React.FC<{ onToast: Toast }> = ({ onToast }) => {
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<PostRow[]>('/api/admin/blog').then(setPosts).catch((e) => onToast(e.message)), [onToast]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="space-y-3">
      <div className={card}>
        <div className="font-bold text-slate-900 dark:text-white">Post de hoje e posts extras</div>
        <p className="text-slate-500">
          Todo dia, a partir das 7h, a Froc escreve e publica 1 artigo com SEO e avisa o Bing na hora. Ninguém garante o 1º lugar no Google ou no Bing: a posição vem com tempo, conteúdo útil todo dia e links de outros sites.
        </p>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Assunto (opcional): ex. frete barato de Curitiba para São Paulo" className={input} />
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api<{ title: string; published: boolean; problems: string[]; image?: { ok: boolean } | null }>('/api/admin/blog/generate', { body: { topic } });
              onToast(
                r.published
                  ? `Publicado: ${r.title}${r.image?.ok ? ' (com capa)' : ' — a capa chega em alguns minutos'}`
                  : `Salvo como rascunho: ${r.problems.join('; ')}`,
              );
              setTopic('');
              await load();
            } catch (e) {
              onToast(e instanceof Error ? e.message : 'Erro.');
            } finally {
              setBusy(false);
            }
          }}
          className="w-full min-h-[42px] rounded-xl bg-emerald-600 text-white font-bold cursor-pointer inline-flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />} {busy ? 'Escrevendo (até 1 minuto)...' : 'Escrever e publicar agora'}
        </button>
        <div className="flex flex-wrap gap-3 text-[11px]">
          <a href="/blog" target="_blank" rel="noreferrer" className="text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1">
            Ver o blog <ExternalLink className="w-3 h-3" />
          </a>
          <a href="/sitemap.xml" target="_blank" rel="noreferrer" className="text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1">
            sitemap.xml <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
      {posts.map((p) => (
        <div key={p.slug} className={card}>
          <div className="flex items-start justify-between gap-2">
            <img
              src={p.image ? `/blog/img/${p.id}.${p.image.mimeType.includes('jpeg') ? 'jpg' : 'png'}` : `/blog/capa/${p.slug}.svg`}
              alt=""
              className="w-24 h-14 object-cover rounded-lg border border-amber-500/30 shrink-0"
              loading="lazy"
            />
            <div className="flex-1 min-w-0">
              <a href={`/blog/${p.slug}`} target="_blank" rel="noreferrer" className="font-bold text-slate-900 dark:text-white hover:underline">
                {p.title}
              </a>
              <div className="text-slate-500">
                {new Date(p.createdAt).toLocaleDateString('pt-BR')} · {p.keyword} · {p.published ? 'publicado' : 'rascunho'}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                api(`/api/admin/blog/${p.slug}/publish`, { body: { published: !p.published } })
                  .then(() => load())
                  .then(() => onToast(p.published ? 'Post retirado do ar.' : 'Post publicado.'))
                  .catch((e) => onToast(e.message))
              }
              className="shrink-0 px-3 min-h-[34px] rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
            >
              {p.published ? 'Tirar do ar' : 'Publicar'}
            </button>
            <button
              type="button"
              onClick={() => {
                onToast('Gerando a capa com a IA (até 30 s)...');
                api<{ model: string }>(`/api/admin/blog/${p.slug}/image`, { body: {} })
                  .then((r) => load().then(() => onToast(`Capa pronta (${r.model}).`)))
                  .catch((e) => onToast(e.message));
              }}
              className="shrink-0 px-3 min-h-[34px] rounded-lg border border-amber-500/50 text-amber-700 dark:text-amber-300 font-semibold cursor-pointer"
            >
              {p.image ? 'Nova capa' : 'Gerar capa'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

interface AuditRow {
  id: string;
  action: string;
  target: string;
  actor: string;
  actorType: string;
  agent: string;
  createdAt: string;
  details?: Record<string, unknown>;
}

/** Auditoria: tudo o que administradores e agentes fizeram. */
export const AuditPanel: React.FC<{ onToast: Toast }> = ({ onToast }) => {
  const [rows, setRows] = useState<AuditRow[]>([]);
  useEffect(() => {
    api<AuditRow[]>('/api/admin/audit').then(setRows).catch((e) => onToast(e.message));
  }, [onToast]);
  return (
    <div className={card}>
      <div className="font-bold text-slate-900 dark:text-white">Auditoria (últimas ações)</div>
      {!rows.length && <div className="text-slate-500">Nada registrado ainda.</div>}
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((r) => (
          <div key={r.id} className="py-2">
            <div className="font-semibold text-slate-900 dark:text-white">
              {r.actorType === 'ia' ? `🤖 ${r.agent}` : r.actorType === 'admin' ? `👤 ${r.actor}` : '⚙ sistema'} · {r.action.replace(/_/g, ' ')}
            </div>
            <div className="text-slate-500">
              {new Date(r.createdAt).toLocaleString('pt-BR')}
              {r.target ? ` · ${r.target}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
