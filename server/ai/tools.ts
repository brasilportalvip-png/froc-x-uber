/**
 * Ferramentas da Equipe IA. Cada ferramenta diz o que faz, que dados recebe e o nível:
 *  - "ler": só consulta (livre para os agentes).
 *  - "agir": muda algo reversível ou de comunicação (o agente faz sozinho, fica na auditoria).
 *  - "confirmar": dinheiro, banimento, aprovação de cadastro e configurações. O agente
 *    PREPARA a ação e ela só acontece quando um administrador toca em "Aprovar".
 */
import type { AuthUser, FrocService } from '../services.ts';
import type { SupportDesk } from '../support.ts';
import type { BlogService } from '../blog.ts';
import type { FunctionDeclaration } from './gemini.ts';
import type { IdentityReviewer } from './identityCheck.ts';

export type ToolLevel = 'ler' | 'agir' | 'confirmar';

export interface ToolContext {
  service: FrocService;
  support: SupportDesk;
  blog: BlogService;
  /** Identidade do agente (o servidor marca auth.agent; serve para auditoria). */
  auth: AuthUser;
  /** E-mail do administrador que está conversando (ou "agendador"). */
  requestedBy: string;
  configStatus?: () => Record<string, unknown>;
  /** Leitura de documentos pela IA (conferência de CPF). */
  identity?: IdentityReviewer;
  /** Grava uma ação para o administrador aprovar. */
  propose: (tool: string, args: Record<string, unknown>, summary: string) => Promise<{ proposalId: string }>;
}

export interface ToolDef {
  name: string;
  level: ToolLevel;
  description: string;
  parameters?: Record<string, unknown>;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;
  /** Para "confirmar": texto curto do que vai acontecer (aparece no botão Aprovar). */
  summarize?: (args: Record<string, unknown>) => string;
  /** Para "confirmar": executa de verdade quando o admin aprova (com a identidade dele). */
  execute?: (service: FrocService, admin: AuthUser, args: Record<string, unknown>) => Promise<unknown>;
}

const S = (description: string) => ({ type: 'STRING', description });
const N = (description: string) => ({ type: 'NUMBER', description });
const B = (description: string) => ({ type: 'BOOLEAN', description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'OBJECT', properties, required });
const str = (v: unknown) => String(v ?? '').trim();

export const TOOLS: ToolDef[] = [
  // ------------------------------------------------------------------ ler
  {
    name: 'painel_geral',
    level: 'ler',
    description: 'Visão geral agora: total de usuários, cadastros pendentes, saques pendentes, SOS abertos e configurações atuais.',
    run: async (c) => {
      const o = await c.service.adminOverview(c.auth);
      return { totais: o.totals, configuracoes: o.settings };
    },
  },
  {
    name: 'relatorio_financeiro',
    level: 'ler',
    description: 'Relatório de serviços concluídos, volume em reais e receita da plataforma nos últimos N dias, por tipo de serviço.',
    parameters: obj({ dias: N('Período em dias (1 a 365). Padrão 30.') }),
    run: (c, a) => c.service.adminReports(c.auth, a.dias ?? 30),
  },
  {
    name: 'cadastros_pendentes',
    level: 'ler',
    description: 'Lista motoristas e transportadores aguardando aprovação, com veículo, placa, RNTRC e documentos enviados.',
    run: async (c) => (await c.service.adminOverview(c.auth)).applications.map((x) => ({ ...x, documents: x.documents.map((d) => d.type) })),
  },
  {
    name: 'saques_pendentes',
    level: 'ler',
    description: 'Lista os pedidos de saque aguardando pagamento (valor, chave Pix, quem pediu).',
    run: async (c) => (await c.service.adminOverview(c.auth)).withdrawals,
  },
  {
    name: 'sos_abertos',
    level: 'ler',
    description: 'Lista os alertas SOS ainda não resolvidos, com quem acionou, onde e quando.',
    run: async (c) => (await c.service.adminOverview(c.auth)).sos,
  },
  {
    name: 'buscar_usuarios',
    level: 'ler',
    description: 'Procura usuários por e-mail exato, nome ou telefone. Sem termo, lista os mais recentes.',
    parameters: obj({ termo: S('E-mail, parte do nome ou telefone.') }),
    run: (c, a) => c.service.adminUsers(c.auth, a.termo ?? ''),
  },
  {
    name: 'ficha_do_usuario',
    level: 'ler',
    description: 'Ficha completa de um usuário: dados, status, carteira, últimas corridas, SOS e saques.',
    parameters: obj({ uid: S('Identificador do usuário (uid).') }, ['uid']),
    run: (c, a) => c.service.adminUserDetail(c.auth, a.uid),
  },
  {
    name: 'movimento_recente',
    level: 'ler',
    description: 'Últimos pedidos de cada serviço: corridas, negociações, caronas, veículos vazios e fretes, com status.',
    run: (c) => c.service.adminRecentActivity(c.auth, 15),
  },
  {
    name: 'saude_do_site',
    level: 'ler',
    description: 'Diagnóstico técnico: o que está configurado (Firebase, Mercado Pago, Maps, cron, IA), sem mostrar segredos.',
    run: async (c) => c.configStatus?.() ?? {},
  },
  {
    name: 'erros_do_site',
    level: 'ler',
    description: 'Últimos erros que aconteceram no navegador das pessoas (mensagem, arquivo/linha, tela e aparelho), para diagnosticar falhas do site.',
    parameters: obj({ quantidade: N('Quantos (até 100). Padrão 30.') }),
    run: async (c, a) => {
      const store = (c.support as unknown as { store: import('../store.ts').Store }).store;
      const list = await store.query<{ createdAt: string }>('client_errors', [], 500);
      return list.sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt))).slice(0, Math.min(100, Number(a.quantidade) || 30));
    },
  },
  {
    name: 'atendimentos_abertos',
    level: 'ler',
    description: 'Conversas de atendimento abertas; as que pediram ajuda humana aparecem primeiro.',
    run: (c) => c.support.listOpen(50),
  },
  {
    name: 'ver_atendimento',
    level: 'ler',
    description: 'Lê a conversa de atendimento de um usuário (mensagens da pessoa, da Froc e da equipe).',
    parameters: obj({ uid: S('uid do usuário.') }, ['uid']),
    run: async (c, a) => (await c.support.get(str(a.uid))) ?? { vazio: true },
  },
  {
    name: 'posts_do_blog',
    level: 'ler',
    description: 'Lista os posts do blog (publicados e rascunhos) com título, endereço e data.',
    run: async (c) =>
      (await c.blog.list({ includeDrafts: true, limit: 60 })).map((p) => ({ slug: p.slug, title: p.title, published: p.published, createdAt: p.createdAt, keyword: p.keyword })),
  },
  {
    name: 'auditoria_recente',
    level: 'ler',
    description: 'Últimas ações registradas (de administradores e de agentes): aprovações, saques, bloqueios, configurações.',
    parameters: obj({ quantidade: N('Quantas (até 200). Padrão 40.') }),
    run: (c, a) => c.service.auditLog(c.auth, Number(a.quantidade) || 40),
  },

  // ------------------------------------------------------------------ agir
  {
    name: 'responder_usuario',
    level: 'agir',
    description: 'Envia uma mensagem da Equipe Froc para o atendimento de um usuário (aparece para ele no app).',
    parameters: obj({ uid: S('uid do usuário.'), mensagem: S('Texto a enviar, na voz da Froc.') }, ['uid', 'mensagem']),
    run: async (c, a) => {
      const chat = await c.support.get(str(a.uid));
      const who = chat
        ? { name: chat.name, email: chat.email }
        : await c.service.adminUserDetail(c.auth, a.uid).then((d) => ({ name: String(d.user.name), email: String(d.user.email) }));
      await c.support.append({ uid: str(a.uid), name: who.name, email: who.email }, 'equipe', str(a.mensagem), c.auth.agent);
      await c.service.audit(c.auth, 'mensagem_enviada', str(a.uid), { mensagem: str(a.mensagem).slice(0, 300) });
      return { enviado: true };
    },
  },
  {
    name: 'encerrar_atendimento',
    level: 'agir',
    description: 'Marca o atendimento de um usuário como resolvido.',
    parameters: obj({ uid: S('uid do usuário.') }, ['uid']),
    run: async (c, a) => {
      await c.support.close(str(a.uid));
      await c.service.audit(c.auth, 'atendimento_encerrado', str(a.uid));
      return { encerrado: true };
    },
  },
  {
    name: 'resolver_sos',
    level: 'agir',
    description: 'Marca um alerta SOS como resolvido, com uma nota do que foi feito. Use só depois de confirmar que a pessoa está bem.',
    parameters: obj({ id: S('id do alerta SOS.'), nota: S('O que foi verificado/feito.') }, ['id', 'nota']),
    run: (c, a) => c.service.resolveSos(c.auth, a.id, a.nota),
  },
  {
    name: 'escrever_post_blog',
    level: 'agir',
    description: 'Escreve um post de blog com SEO (Google e Bing), confere o padrão e publica. Pode receber um assunto; sem assunto usa a pauta do dia.',
    parameters: obj({ assunto: S('Assunto do post (opcional).') }),
    run: async (c, a) => {
      const { post, problems } = await c.blog.generate({ topic: str(a.assunto) || undefined, author: `Froc IA · ${c.auth.agent || 'Marketing'}` });
      await c.service.audit(c.auth, 'post_criado', post.slug, { publicado: post.published, problemas: problems });
      return { slug: post.slug, titulo: post.title, publicado: post.published, endereco: `/blog/${post.slug}`, problemas: problems };
    },
  },
  {
    name: 'publicar_ou_retirar_post',
    level: 'agir',
    description: 'Publica um rascunho ou tira um post do ar.',
    parameters: obj({ slug: S('Endereço do post.'), publicar: B('true publica, false tira do ar.') }, ['slug', 'publicar']),
    run: async (c, a) => {
      const r = await c.blog.setPublished(str(a.slug), a.publicar === true);
      await c.service.audit(c.auth, a.publicar === true ? 'post_publicado' : 'post_retirado', str(a.slug));
      return r ?? { erro: 'Post não encontrado.' };
    },
  },
  {
    name: 'anotar_para_equipe',
    level: 'agir',
    description: 'Registra uma nota interna para a equipe (achado, pendência, sugestão). Fica na auditoria.',
    parameters: obj({ assunto: S('Assunto curto.'), texto: S('Detalhes.') }, ['assunto', 'texto']),
    run: async (c, a) => {
      await c.service.audit(c.auth, 'nota_da_equipe', str(a.assunto).slice(0, 80), { texto: str(a.texto).slice(0, 2000) });
      return { anotado: true };
    },
  },

  // ------------------------------------------------------------- confirmar
  {
    name: 'cpfs_para_conferir',
    level: 'ler',
    description: 'Lista contas com CPF só "cadastrado" (falta conferir) e contas com alerta de possível multiconta.',
    run: async (ctx) => {
      const store = ctx.service.store;
      const [basic, all] = await Promise.all([store.query<Record<string, unknown>>('users', [['cpfStatus', '==', 'basic']], 100), store.query<Record<string, unknown>>('users', [], 500)]);
      const view = (u: Record<string, unknown>) => ({
        uid: u.uid,
        nome: u.name,
        cpf: u.cpfMasked,
        motorista: u.driverStatus,
        transportador: u.truckerStatus,
        temDocumentoEnviado: Boolean(u.identityDocPath || (u.driverDocs as Record<string, string> | undefined)?.cnh || (u.truckerDocs as Record<string, string> | undefined)?.cnh),
        ultimaConferenciaIA: u.aiDocCheck || null,
      });
      return { cpfParaConferir: basic.map(view), possivelMulticonta: all.filter((u) => u.multiAccountFlag).map((u) => ({ uid: u.uid, nome: u.name, alerta: u.multiAccountFlag, cpf: u.cpfMasked })) };
    },
  },
  {
    name: 'conferir_cpf_por_documento',
    level: 'agir',
    description: 'A IA lê a CNH (motorista) ou o documento com foto enviado pelo passageiro e compara CPF, nome e nascimento com o cadastro. Bateu: CPF verificado na hora. Não bateu: prepara "CPF não confere" para o dono.',
    parameters: obj({ uid: S('uid da pessoa.') }, ['uid']),
    run: async (ctx, a) => {
      if (!ctx.identity) return { erro: 'Leitura de documentos indisponível agora.' };
      const u = await ctx.service.store.get<Record<string, unknown>>('users', String(a.uid));
      if (!u) return { erro: 'Usuário não encontrado.' };
      const docs = { ...((u.truckerDocs as Record<string, string>) || {}), ...((u.driverDocs as Record<string, string>) || {}) };
      const path = docs.cnh || String(u.identityDocPath || '');
      if (!path) return { erro: 'Esta pessoa ainda não enviou documento com foto. Peça pelo atendimento: Conta > "Ganhe o selo de verificado".' };
      return ctx.identity.review(String(a.uid), path, docs.cnh ? 'cnh' : 'documento');
    },
  },
  {
    name: 'marcar_cpf',
    level: 'confirmar',
    description: 'Marca o CPF como conferido ou como "não confere" (CPF de outra pessoa ou dados falsos: libera o CPF e pede novo cadastro). Só acontece quando o administrador aprovar.',
    parameters: obj({ uid: S('uid da pessoa.'), decisao: S('"verified" (conferido) ou "rejected" (não confere).'), motivo: S('Obrigatório quando "rejected".') }, ['uid', 'decisao']),
    summarize: (a) => `${a.decisao === 'verified' ? 'Marcar CPF como conferido' : 'CPF não confere'} (${a.uid})${a.motivo ? ` — ${a.motivo}` : ''}`,
    execute: (s, admin, a) => s.adminSetCpfStatus(admin, a.uid, a.decisao, a.motivo ?? ''),
    run: async () => ({}),
  },
  {
    name: 'aprovar_ou_recusar_cadastro',
    level: 'confirmar',
    description: 'Prepara a aprovação ou recusa de um cadastro de motorista/transportador. Só acontece quando o administrador aprovar.',
    parameters: obj(
      {
        uid: S('uid do usuário.'),
        tipo: S('"driver" (motorista), "trucker" (transportador) ou "merchant" (loja do Froc Entregas).'),
        decisao: S('"approved" ou "rejected".'),
        motivo: S('Obrigatório na recusa: o que está errado.'),
      },
      ['uid', 'tipo', 'decisao'],
    ),
    summarize: (a) => `${a.decisao === 'approved' ? 'Aprovar' : 'Recusar'} cadastro de ${a.tipo === 'trucker' ? 'transportador' : a.tipo === 'merchant' ? 'loja' : 'motorista'} (${a.uid})${a.motivo ? ` — ${a.motivo}` : ''}`,
    execute: (s, admin, a) => s.reviewApplication(admin, a.uid, a.tipo, a.decisao, a.motivo ?? ''),
    run: async () => ({}),
  },
  {
    name: 'pagar_ou_recusar_saque',
    level: 'confirmar',
    description: 'Prepara o pagamento (já feito por Pix) ou a recusa de um saque. Só acontece quando o administrador aprovar.',
    parameters: obj({ id: S('id do saque.'), decisao: S('"paid" (pago) ou "rejected" (recusado, devolve o valor).'), observacao: S('Contexto para o administrador.') }, [
      'id',
      'decisao',
    ]),
    summarize: (a) => `${a.decisao === 'paid' ? 'Marcar como PAGO' : 'Recusar e devolver'} o saque ${a.id}${a.observacao ? ` — ${a.observacao}` : ''}`,
    execute: (s, admin, a) => s.resolveWithdrawal(admin, a.id, a.decisao),
    run: async () => ({}),
  },
  {
    name: 'bloquear_ou_desbloquear_usuario',
    level: 'confirmar',
    description: 'Prepara o bloqueio (banimento) ou desbloqueio de uma conta. Só acontece quando o administrador aprovar.',
    parameters: obj({ uid: S('uid do usuário.'), bloquear: B('true bloqueia, false desbloqueia.'), motivo: S('Motivo (obrigatório para bloquear).') }, ['uid', 'bloquear']),
    summarize: (a) => `${a.bloquear === true ? 'BLOQUEAR' : 'Desbloquear'} a conta ${a.uid}${a.motivo ? ` — ${a.motivo}` : ''}`,
    execute: (s, admin, a) => s.setBlocked(admin, a.uid, a.bloquear === true, a.motivo ?? ''),
    run: async () => ({}),
  },
  {
    name: 'alterar_configuracoes',
    level: 'confirmar',
    description:
      'Prepara mudança nas configurações: commissionPercent (0–40), surgeEnabled, maxSurge (1–3), rideSearchTimeoutMin (3–60), indriveOpenTimeoutMin (5–240), pointsPerReal (0–10), pointsPerRedeem (20–10000). Só acontece quando o administrador aprovar.',
    parameters: obj({
      commissionPercent: N('Comissão %'),
      surgeEnabled: B('Tarifa dinâmica ligada'),
      maxSurge: N('Multiplicador máximo'),
      rideSearchTimeoutMin: N('Minutos procurando motorista'),
      indriveOpenTimeoutMin: N('Minutos de pedido de negociação aberto'),
      pointsPerReal: N('Pontos por R$ 1'),
      pointsPerRedeem: N('Pontos para R$ 5'),
      justificativa: S('Por que mudar.'),
    }),
    summarize: (a) => {
      const { justificativa, ...rest } = a;
      return `Alterar configurações: ${Object.entries(rest)
        .map(([k, v]) => `${k} = ${v}`)
        .join(', ')}${justificativa ? ` — ${justificativa}` : ''}`;
    },
    execute: (s, admin, a) => {
      const { justificativa: _j, ...rest } = a;
      return s.updateSettings(admin, rest);
    },
    run: async () => ({}),
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function declarationsFor(names: string[]): FunctionDeclaration[] {
  return names
    .map((n) => TOOL_BY_NAME.get(n))
    .filter((t): t is ToolDef => Boolean(t))
    .map((t) => ({
      name: t.name,
      description: `${t.description}${t.level === 'confirmar' ? ' (PREPARA para o administrador aprovar; não executa sozinho.)' : ''}`,
      ...(t.parameters ? { parameters: t.parameters } : {}),
    }));
}
