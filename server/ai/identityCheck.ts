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
import { agentAuth } from '../services.ts';
import { minVehicleYear, vehicleAgeLimit } from '../../src/data/legal.ts';
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

const CRLV_PROMPT = `Você confere o CRLV (documento do veículo) brasileiro. Leia SOMENTE o que está escrito; não invente.
Responda só com JSON: {"legivel":true|false,"placa":"","anoFabricacao":0,"anoModelo":0,"exercicio":0,"proprietario":"","marcaModelo":""}
- "exercicio" é o ano do licenciamento impresso no documento. Use 0 quando não conseguir ler um número.`;

const ANTECEDENTES_PROMPT = `Você confere uma certidão de antecedentes criminais brasileira (Polícia Federal, Polícia Civil ou Tribunal de Justiça).
Leia SOMENTE o que está escrito; não invente. Responda só com JSON:
{"legivel":true|false,"nome":"","cpf":"só números","nadaConsta":true|false|null,"emissao":"AAAA-MM-DD","orgao":""}
- "nadaConsta": true se a certidão diz que NÃO constam registros/antecedentes (negativa); false se aparecem registros (positiva); null se não der para saber.`;

export interface ProviderCheck {
  ok: boolean;
  /** "aprovar", "recusar" (motivo claro para a pessoa corrigir) ou "aguardar" (IA fora do ar). */
  decision: 'aprovar' | 'recusar' | 'aguardar';
  reasons: string[];
  cnh?: { status: string; ear: boolean | null; validade: string };
  crlv?: { placa: string; anoFabricacao: number; exercicio: number };
  antecedentes?: { nadaConsta: boolean | null; emissao: string };
  checkedAt: string;
}

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
    const otherPersonCpf = result.status === 'nao_confere' && result.reasons.some((m) => m.startsWith('O CPF do documento'));
    if (otherPersonCpf && (await this.service.settings()).agentAutonomy) {
      // Documento de OUTRA pessoa (CPF diferente, lido de forma legível): a IA recusa sozinha e libera o CPF.
      await this.service.adminSetCpfStatus(agentAuth('cadastros', 'Analista de Cadastros'), uid, 'rejected', result.reasons.join(' ')).catch(() => undefined);
    } else if (result.status === 'nao_confere') {
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

  private async readJson<T>(path: string, prompt: string): Promise<T | null> {
    const file = await this.files!.read!(path);
    if (!file) return null;
    const out = await this.llm.generate({
      system: prompt,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: file.contentType, data: Buffer.from(file.bytes).toString('base64') } }, { text: 'Leia este documento.' }] }],
      json: true,
      temperature: 0,
      maxOutputTokens: 500,
      deadlineMs: 40_000,
    });
    return parseJsonLoose<T>(out.text);
  }

  /**
   * Cadastro completo de motorista/transportador: a IA lê CNH, CRLV e certidão de antecedentes;
   * as regras abaixo (código, não IA) decidem aprovar ou recusar com o motivo. Com a autonomia
   * ligada, o Analista de Cadastros aprova ou recusa sozinho; senão deixa preparado para o dono.
   */
  async reviewProvider(uid: string, kind: 'driver' | 'trucker'): Promise<ProviderCheck> {
    const checkedAt = new Date().toISOString();
    const wait = (why: string): ProviderCheck => ({ ok: false, decision: 'aguardar', reasons: [why], checkedAt });
    if (!this.available) return wait('IA ou armazenamento indisponível.');
    const user = await this.store.get<Doc>('users', uid);
    if (!user) return wait('Usuário não encontrado.');
    const docs = ((kind === 'driver' ? user.driverDocs : user.truckerDocs) || {}) as Record<string, string>;
    const reasons: string[] = [];
    const result: ProviderCheck = { ok: false, decision: 'recusar', reasons, checkedAt };
    const today = checkedAt.slice(0, 10);
    try {
      // 1) CNH: CPF, nome e nascimento iguais ao cadastro, EAR e validade.
      if (!docs.cnh) reasons.push('Falta a foto da CNH.');
      else {
        const c = await this.review(uid, docs.cnh, 'cnh');
        if (c.status === 'ia_indisponivel') return wait(c.reasons[0]);
        result.cnh = { status: c.status, ear: c.ear ?? null, validade: c.validade || '' };
        if (c.status === 'sem_cpf') reasons.push('Cadastre o CPF antes.');
        else if (!c.ok) reasons.push(...c.reasons.map((r) => `CNH: ${r}`));
        if (c.ok && c.ear === false) reasons.push('Sua CNH não tem a observação EAR (exerce atividade remunerada), obrigatória por lei. Inclua no Detran e envie de novo.');
        if (c.ok && c.ear === null) reasons.push('Não deu para ver a observação EAR na CNH. Envie uma foto mais nítida do campo de observações.');
        if (c.validade && c.validade < today) reasons.push('Sua CNH está vencida. Renove e envie a nova.');
      }
      // 2) CRLV: placa e ano iguais ao cadastro, licenciamento em dia, idade do veículo.
      if (!docs.crlv) reasons.push('Falta o CRLV.');
      else {
        const v = await this.readJson<{ legivel?: boolean; placa?: string; anoFabricacao?: number; exercicio?: number }>(docs.crlv, CRLV_PROMPT);
        const placa = String(v?.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const declared = String((kind === 'driver' ? user.driverPlate : user.truckPlate) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        result.crlv = { placa, anoFabricacao: Number(v?.anoFabricacao) || 0, exercicio: Number(v?.exercicio) || 0 };
        if (!v || v.legivel === false || !placa) reasons.push('Não deu para ler o CRLV. Envie uma foto nítida do documento inteiro.');
        else {
          if (placa !== declared) reasons.push(`A placa do CRLV (${placa}) é diferente da cadastrada (${declared}).`);
          const year = Number(v.anoFabricacao) || 0;
          if (year && user.driverVehicleYear && year !== Number(user.driverVehicleYear)) reasons.push(`O ano de fabricação no CRLV (${year}) é diferente do informado (${user.driverVehicleYear}).`);
          if (kind === 'driver' && year) {
            const cfg = await this.service.settings();
            const rule = vehicleAgeLimit(String(user.driverCity || ''), String(user.driverState || ''), cfg.maxVehicleAgeYears);
            if (year < minVehicleYear(rule.maxYears)) reasons.push(`Veículo de ${year} é mais antigo que o permitido (${rule.source})`);
          }
          const ex = Number(v.exercicio) || 0;
          if (ex && ex < new Date().getUTCFullYear() - 1) reasons.push(`O licenciamento do veículo está atrasado (último: ${ex}).`);
        }
      }
      // 3) Antecedentes: negativa, da própria pessoa, emitida há no máximo 90 dias.
      if (!docs.antecedentes) reasons.push('Falta a certidão de antecedentes criminais.');
      else {
        const a = await this.readJson<{ legivel?: boolean; nome?: string; cpf?: string; nadaConsta?: boolean | null; emissao?: string }>(docs.antecedentes, ANTECEDENTES_PROMPT);
        const identity = await this.store.get<Doc>('identities', uid);
        result.antecedentes = { nadaConsta: typeof a?.nadaConsta === 'boolean' ? a.nadaConsta : null, emissao: String(a?.emissao || '') };
        if (!a || a.legivel === false) reasons.push('Não deu para ler a certidão de antecedentes. Envie o PDF original ou uma foto nítida.');
        else {
          if (a.nadaConsta === false) reasons.push('A certidão de antecedentes não é negativa. Pela regra da plataforma, não é possível liberar o cadastro.');
          if (a.nadaConsta == null) reasons.push('Não deu para confirmar se a certidão é negativa ("nada consta"). Envie o PDF original.');
          const cpfOk = !a.cpf || !identity || onlyDigits(a.cpf) === onlyDigits(identity.cpf);
          const nameOk = !identity || namesMatch(String(identity.legalName || identity.declaredName || ''), String(a.nome || '')) || namesMatch(String(identity.declaredName || ''), String(a.nome || ''));
          if (!cpfOk || !nameOk) reasons.push('A certidão de antecedentes é de outra pessoa.');
          const em = String(a.emissao || '');
          if (/^\d{4}-\d{2}-\d{2}$/.test(em) && Date.parse(today) - Date.parse(em) > 90 * 864e5) reasons.push('A certidão de antecedentes tem mais de 90 dias. Emita uma nova (é grátis pela internet).');
        }
      }
    } catch (e) {
      return wait(`A IA não conseguiu ler agora (${String((e as Error)?.message || e).slice(0, 120)}).`);
    }
    // Reconhecimento facial × foto da CNH: rosto de outra pessoa nunca é aprovado sozinho;
    // dúvida ou IA fora do ar na hora da selfie → a equipe confere as fotos.
    if (kind === 'driver' && user.faceRefPath) {
      if (user.faceCnhMatch === 'nao_confere') reasons.push('O rosto do reconhecimento facial não confere com a foto da CNH. Refaça o reconhecimento facial você mesmo, de frente e num lugar iluminado.');
      else if (user.faceCnhMatch !== 'confere' && reasons.length === 0) return wait('Rosto × CNH em dúvida: a equipe confere as fotos antes de aprovar.');
    }
    result.ok = reasons.length === 0;
    result.decision = result.ok ? 'aprovar' : 'recusar';
    await this.store.update('users', uid, { aiProviderCheck: JSON.parse(JSON.stringify(result)) });
    await this.apply(uid, kind, result);
    return result;
  }

  /** Aplica a decisão: sozinho (autonomia ligada) ou preparada para o dono aprovar. */
  private async apply(uid: string, kind: 'driver' | 'trucker', r: ProviderCheck) {
    const cfg = await this.service.settings();
    const motivo = r.reasons.join(' ');
    if (cfg.agentAutonomy) {
      await this.service.reviewApplication(agentAuth('cadastros', 'Analista de Cadastros'), uid, kind, r.ok ? 'approved' : 'rejected', motivo).catch((e) => console.warn('Decisão automática falhou:', e));
      return;
    }
    const id = `cadastro-${uid}-${kind}-${r.checkedAt.slice(0, 10)}`;
    await this.store.set('ai_proposals', id, {
      id,
      tool: 'aprovar_ou_recusar_cadastro',
      args: { uid, tipo: kind, decisao: r.ok ? 'approved' : 'rejected', motivo },
      summary: `${r.ok ? 'Aprovar' : 'Recusar'} cadastro (${uid})${motivo ? ` — ${motivo}` : ' — CNH, CRLV e antecedentes conferidos pela IA'}`,
      agentId: 'cadastros',
      agentName: 'Analista de Cadastros',
      requestedBy: 'agendador',
      status: 'pending',
      createdAt: r.checkedAt,
    });
  }

  /** Rotina do agendador: confere os cadastros pendentes que a IA ainda não leu. */
  async reviewPending(limit = 2) {
    if (!this.available) return { conferidos: 0, motivo: 'IA ou armazenamento indisponível' };
    const [drivers, truckers] = await Promise.all([
      this.store.query<Doc>('users', [['driverStatus', '==', 'pending']], 100),
      this.store.query<Doc>('users', [['truckerStatus', '==', 'pending']], 100),
    ]);
    const done = (u: Doc) => {
      const c = u.aiProviderCheck as Doc | undefined;
      const sent = String((u.driverStatus === 'pending' ? u.driverSubmittedAt : u.truckerSubmittedAt) || '');
      return c?.checkedAt && String(c.checkedAt) > sent && c.decision !== 'aguardar';
    };
    const todo = [...drivers.map((u) => ({ u, kind: 'driver' as const })), ...truckers.map((u) => ({ u, kind: 'trucker' as const }))].filter(({ u }) => !done(u)).slice(0, limit);
    const out: { uid: string; decisao: string }[] = [];
    for (const { u, kind } of todo) {
      const r = await this.reviewProvider(String(u.uid), kind).catch((e) => ({ decision: `erro: ${String(e?.message || e).slice(0, 80)}` }));
      out.push({ uid: String(u.uid), decisao: r.decision });
    }
    return { conferidos: out.length, resultados: out };
  }
}
