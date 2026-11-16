/**
 * Conferência de CPF pela Equipe IA (agente Cadastros), sem precisar do dono.
 *
 * Como funciona:
 *  1. A IA LÊ o documento com foto (CNH do motorista, ou CNH/RG que o passageiro envia):
 *     nome, CPF, data de nascimento e, na CNH, validade e observação EAR.
 *  2. Quem DECIDE é o código, não a IA: CPF idêntico, data de nascimento idêntica e nome
 *     batendo com o cadastro → "verificado" na hora (a IA pode errar ao ler; por isso a
 *     comparação é exata e qualquer dúvida fica para revisão).
 *  3. Não bateu (documento legível de outra pessoa ou com dados diferentes) → o agente
 *     prepara "CPF não confere" para a equipe confirmar com 1 clique (punir alguém por erro
 *     de leitura seria injusto). Foto ruim → pede outra foto.
 *  4. Rotina sozinha: o agendador confere motoristas pendentes a cada rodada.
 */
import type { Doc, Store } from '../store.ts';
import type { FileStorage, FrocService } from '../services.ts';
import type { LlmClient } from './gemini.ts';
import { parseJsonLoose } from './gemini.ts';
import { namesMatch, onlyDigits } from '../identity.ts';

export interface DocExtraction {
  legivel: boolean;
  tipo: string;
  nome: string;
  cpf: string;
  nascimento: string;
  validade: string;
  ear: boolean | null;
  pareceAdulterado: boolean;
  observacoes: string;
}

export interface DocCheckResult {
  ok: boolean;
  status: 'verificado' | 'nao_confere' | 'ilegivel' | 'sem_cpf' | 'ia_indisponivel' | 'sem_documento';
  reasons: string[];
  tipo?: string;
  ear?: boolean | null;
  validade?: string;
  checkedAt: string;
}

const PROMPT = `Você confere documentos brasileiros para cadastro de um app de mobilidade.
Leia SOMENTE o que está escrito na imagem/PDF. Não invente, não complete dados que não aparecem.
Responda apenas com JSON neste formato:
{"legivel":true|false,"tipo":"CNH"|"RG"|"CIN"|"outro","nome":"","cpf":"só números","nascimento":"AAAA-MM-DD","validade":"AAAA-MM-DD ou vazio","ear":true|false|null,"pareceAdulterado":true|false,"observacoes":"curto"}
- "ear": true se a CNH tiver a observação "EAR" (exerce atividade remunerada) no campo de observações; false se for CNH sem EAR; null se não for CNH.
- "pareceAdulterado": true só se houver sinal claro (texto sobreposto, foto colada, montagem, print de tela de outro documento).
- Se não conseguir ler algum campo, deixe vazio e marque "legivel": false quando nome ou CPF não forem lidos.`;

export class IdentityReviewer {
  store: Store;
  service: FrocService;
  llm: LlmClient;
  files?: FileStorage;
  constructor(deps: { store: Store; service: FrocService; llm: LlmClient; files?: FileStorage }) {
    this.store = deps.store;
    this.service = deps.service;
    this.llm = deps.llm;
    this.files = deps.files;
  }

  get available() {
    return Boolean(this.llm.configured && this.files?.read);
  }

  /** A IA lê o documento. */
  async extract(bytes: Uint8Array, mimeType: string): Promise<DocExtraction> {
    const out = await this.llm.generate({
      system: PROMPT,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: Buffer.from(bytes).toString('base64') } }, { text: 'Leia este documento.' }] }],
      json: true,
      temperature: 0,
      maxOutputTokens: 600,
      deadlineMs: 40_000,
    });
    const j = parseJsonLoose<Partial<DocExtraction>>(out.text);
    return {
      legivel: j.legivel === true,
      tipo: String(j.tipo || ''),
      nome: String(j.nome || ''),
      cpf: onlyDigits(j.cpf),
      nascimento: String(j.nascimento || ''),
      validade: String(j.validade || ''),
      ear: typeof j.ear === 'boolean' ? j.ear : null,
      pareceAdulterado: j.pareceAdulterado === true,
      observacoes: String(j.observacoes || '').slice(0, 200),
    };
  }

  /** Compara o que a IA leu com o cadastro do CPF. A decisão é do código (comparação exata). */
  static compare(x: DocExtraction, identity: Doc): Omit<DocCheckResult, 'checkedAt'> {
    const base = { tipo: x.tipo, ear: x.ear, validade: x.validade };
    if (!x.legivel || !x.cpf || !x.nome) return { ok: false, status: 'ilegivel', reasons: ['Não deu para ler o documento. Envie uma foto nítida, sem reflexo, com o documento inteiro.'], ...base };
    const reasons: string[] = [];
    if (x.cpf !== onlyDigits(identity.cpf)) reasons.push('O CPF do documento é diferente do CPF cadastrado.');
    if (x.nascimento && x.nascimento !== identity.birthDate) reasons.push('A data de nascimento do documento é diferente da cadastrada.');
    const nameOk = namesMatch(String(identity.legalName || identity.declaredName || ''), x.nome) || namesMatch(String(identity.declaredName || ''), x.nome);
    if (!nameOk) reasons.push('O nome do documento não bate com o nome cadastrado.');
    if (x.pareceAdulterado) reasons.push('O documento parece ter sido alterado.');
    if (!x.nascimento) reasons.push('Não deu para ler a data de nascimento.');
    return reasons.length ? { ok: false, status: 'nao_confere', reasons, ...base } : { ok: true, status: 'verificado', reasons: [], ...base };
  }

  /** Confere um documento guardado no Storage contra o CPF da pessoa e aplica o resultado. */
  async review(uid: string, path: string, source: 'cnh' | 'documento'): Promise<DocCheckResult> {
    const checkedAt = new Date().toISOString();
    const identity = await this.store.get<Doc>('identities', uid);
    if (!identity) return { ok: false, status: 'sem_cpf', reasons: ['A pessoa ainda não cadastrou o CPF.'], checkedAt };
    if (!this.available) return { ok: false, status: 'ia_indisponivel', reasons: ['IA ou armazenamento indisponível agora.'], checkedAt };
    const file = await this.files!.read!(path);
    if (!file) return { ok: false, status: 'sem_documento', reasons: ['Documento não encontrado.'], checkedAt };
    let x: DocExtraction;
    try {
      x = await this.extract(file.bytes, file.contentType);
    } catch (e) {
      return { ok: false, status: 'ia_indisponivel', reasons: [`A IA não conseguiu ler agora (${String((e as Error)?.message || e).slice(0, 120)}). Tenta de novo na próxima rodada.`], checkedAt };
    }
    const result: DocCheckResult = { ...IdentityReviewer.compare(x, identity), checkedAt };
    await this.service.recordDocumentCheck(uid, result, source);
    if (result.status === 'nao_confere') {
      // Não pune sozinho (a leitura pode errar): prepara para o dono confirmar com 1 clique.
      const id = `cpf-${uid}-${checkedAt.slice(0, 10)}`;
      await this.store.set('ai_proposals', id, {
        id,
        tool: 'marcar_cpf',
        args: { uid, decisao: 'rejected', motivo: result.reasons.join(' ') },
        summary: `CPF não confere (${uid}) — ${result.reasons.join(' ')}`,
        agentId: 'cadastros',
        agentName: 'Analista de Cadastros',
        requestedBy: 'agendador',
        status: 'pending',
        createdAt: checkedAt,
      });
    }
    return result;
  }

  /** Rotina do agendador: confere a CNH de motoristas/transportadores pendentes que a IA ainda não leu. */
  async reviewPending(limit = 3) {
    if (!this.available) return { conferidos: 0, motivo: 'IA ou armazenamento indisponível' };
    const [drivers, truckers] = await Promise.all([
      this.store.query<Doc>('users', [['driverStatus', '==', 'pending']], 100),
      this.store.query<Doc>('users', [['truckerStatus', '==', 'pending']], 100),
    ]);
    const todo = [...drivers, ...truckers].filter((u) => !(u.aiDocCheck as Doc | undefined)?.checkedAt && u.cpfKey).slice(0, limit);
    const out: { uid: string; status: string }[] = [];
    for (const u of todo) {
      const docs = ((u.driverStatus === 'pending' ? u.driverDocs : u.truckerDocs) || {}) as Record<string, string>;
      if (!docs.cnh) continue;
      const r = await this.review(String(u.uid), docs.cnh, 'cnh').catch((e) => ({ status: `erro: ${String(e?.message || e).slice(0, 80)}` }));
      out.push({ uid: String(u.uid), status: r.status });
    }
    return { conferidos: out.length, resultados: out };
  }
}
