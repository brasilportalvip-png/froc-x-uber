/**
 * Atendimento: uma conversa por usuário, entre a pessoa, a Froc (IA) e a equipe.
 * Coleção "support" (com o prefixo: froc_support), documento = uid da pessoa.
 */
import type { Doc, Store } from './store.ts';

export type SupportFrom = 'user' | 'froc' | 'equipe';

export interface SupportMessage {
  from: SupportFrom;
  text: string;
  at: string;
  /** Agente da Equipe IA ou e-mail do administrador que respondeu. */
  by?: string;
}

/** Reclamação registrada de verdade (com protocolo), visível para a equipe no Admin. */
export interface SupportTicket {
  protocolo: string;
  categoria: string;
  resumo: string;
  detalhes: string;
  status: 'aberta' | 'resolvida';
  createdAt: string;
}

export interface SupportChat extends Doc {
  uid: string;
  name: string;
  email: string;
  status: 'open' | 'closed';
  /** A Froc pediu ajuda humana (ou a pessoa pediu para falar com alguém). */
  needsHuman: boolean;
  reason?: string;
  messages: SupportMessage[];
  tickets?: SupportTicket[];
  updatedAt: string;
  createdAt: string;
}

const MAX_MESSAGES = 80;
const now = () => new Date().toISOString();

export class SupportDesk {
  private store: Store;
  constructor(store: Store) {
    this.store = store;
  }

  async get(uid: string): Promise<SupportChat | null> {
    return this.store.get<SupportChat>('support', uid);
  }

  async append(user: { uid: string; name?: string; email?: string }, from: SupportFrom, text: string, by?: string) {
    const clean = String(text || '').trim().slice(0, 2000);
    if (!clean) return this.get(user.uid);
    const current = await this.get(user.uid);
    const message: SupportMessage = { from, text: clean, at: now(), ...(by ? { by } : {}) };
    const chat: SupportChat = current ?? {
      uid: user.uid,
      name: user.name || '',
      email: user.email || '',
      status: 'open',
      needsHuman: false,
      messages: [],
      createdAt: now(),
      updatedAt: now(),
    };
    chat.messages = [...(chat.messages || []), message].slice(-MAX_MESSAGES);
    chat.updatedAt = now();
    if (from === 'user') chat.status = 'open';
    if (from === 'equipe') chat.needsHuman = false;
    await this.store.set('support', user.uid, chat);
    return chat;
  }

  async flagHuman(uid: string, reason: string) {
    const chat = await this.get(uid);
    if (!chat) return null;
    await this.store.update('support', uid, { needsHuman: true, reason: String(reason || '').slice(0, 300), status: 'open', updatedAt: now() });
    return { ok: true };
  }

  /**
   * Registra a reclamação (só depois de gravada a Froc pode dizer "registrei"). Devolve o protocolo.
   * A conversa vai para a equipe ("precisa de gente") com o protocolo no motivo.
   */
  async addTicket(user: { uid: string; name?: string; email?: string }, t: { categoria?: unknown; resumo?: unknown; detalhes?: unknown }) {
    const resumo = String(t.resumo ?? '').trim().slice(0, 300);
    if (!resumo) throw new Error('resumo_vazio');
    const day = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
    const protocolo = `FROC-${day}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const ticket: SupportTicket = {
      protocolo,
      categoria: String(t.categoria ?? 'outro').trim().slice(0, 40) || 'outro',
      resumo,
      detalhes: String(t.detalhes ?? '').trim().slice(0, 1500),
      status: 'aberta',
      createdAt: now(),
    };
    const chat = (await this.get(user.uid)) ?? (await this.append(user, 'froc', 'Atendimento aberto.', 'Froc'))!;
    await this.store.update('support', user.uid, {
      tickets: [...(chat.tickets || []), ticket].slice(-30),
      needsHuman: true,
      status: 'open',
      reason: `[${protocolo}] ${resumo}`.slice(0, 300),
      updatedAt: now(),
    });
    return ticket;
  }

  async close(uid: string) {
    const chat = await this.get(uid);
    if (!chat) return null;
    await this.store.update('support', uid, { status: 'closed', needsHuman: false, updatedAt: now() });
    return { ok: true };
  }

  /** Conversas abertas, as que pedem gente primeiro e depois as mais recentes. */
  async listOpen(limit = 50) {
    const open = await this.store.query<SupportChat>('support', [['status', '==', 'open']], 500);
    return open
      .sort((a, b) => Number(b.needsHuman) - Number(a.needsHuman) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, limit)
      .map((c) => ({
        uid: c.uid,
        name: c.name,
        email: c.email,
        needsHuman: c.needsHuman,
        reason: c.reason || '',
        protocolos: (c.tickets || []).filter((t) => t.status === 'aberta').map((t) => t.protocolo),
        lastMessage: c.messages?.[c.messages.length - 1]?.text?.slice(0, 160) || '',
        updatedAt: c.updatedAt,
      }));
  }
}
