/**
 * SISTEMA FROC — voz oficial da marca (masculina, calorosa, amigável, como um amigo próximo).
 *
 * Falas programadas (sem IA, sem custo): 10 versões por situação, para não repetir sempre a mesma
 * coisa. Cada fala sabe o dia e a hora de Brasília (bom dia / boa tarde / boa noite, bom serviço,
 * bom descanso) e usa o primeiro nome da pessoa.
 *
 * O mesmo arquivo serve ao app (escolhe a versão) e ao servidor (monta o texto com o nome real da
 * pessoa e gera o áudio na voz da Froc). Use em todos os apps da marca Froc.
 */

export type SituacaoFroc =
  // motorista
  | 'motorista_online'
  | 'motorista_offline'
  | 'nova_corrida'
  | 'corrida_aceita'
  | 'chegou_embarque'
  | 'embarque_confirmado'
  | 'corrida_encerrada'
  // passageiro
  | 'motorista_a_caminho'
  | 'motorista_chegou'
  | 'cinto'
  | 'viagem_concluida';

export interface DadosFala {
  nome?: string;
  /** Valor em reais (ex.: 18.5). */
  valor?: number;
  minutos?: number;
  /** Distância em km. */
  km?: number;
  destino?: string;
}

/** Voz neural da Froc (mesma do Froc IA). */
export const VOZ_FROC = {
  voz: 'Charon',
  idioma: 'pt-BR',
  direcao: [
    'Fale em português brasileiro com voz masculina adulta, natural, calorosa e amigável.',
    'Soa como um amigo próximo conversando com tranquilidade: educado, simpático, gentil e sempre disposto a ajudar.',
    'Use ritmo humano, pausas naturais e entonação acolhedora, sem soar como robô ou locutor.',
  ],
} as const;

export const FALAS: Record<SituacaoFroc, string[]> = {
  motorista_online: [
    '{saudacao}, {nome}! Você está online na Froc. Bom serviço!',
    '{saudacao}, {nome}. Tudo pronto: você já pode receber corridas. Bom trabalho!',
    'Fala, {nome}! {saudacao}. Você está online e a Froc já está procurando passageiros perto de você.',
    '{saudacao}, {nome}! Que bom ter você com a gente nesta {dia}. Bom serviço e dirija com segurança.',
    'Online! {saudacao}, {nome}. Vamos juntos fazer um ótimo dia de trabalho.',
    '{saudacao}, {nome}. Você está conectado. Assim que chegar uma corrida, eu te aviso.',
    '{saudacao}, {nome}! A Froc está com você. Bom serviço e muita tranquilidade no trânsito.',
    'Pronto, {nome}, você está online. {saudacao} e boas corridas!',
    '{saudacao}, {nome}. Respira fundo, ajusta o banco e bora: as corridas já podem chegar.',
    '{saudacao}, {nome}! Online na Froc. Lembre: segurança em primeiro lugar. Bom trabalho!',
  ],
  motorista_offline: [
    'Tudo certo, {nome}. Você está offline. {despedida}!',
    'Até a próxima, {nome}. Obrigado pelo seu trabalho hoje. {despedida}!',
    'Você ficou offline, {nome}. Valeu demais pela parceria. {despedida}!',
    'Offline. Obrigado, {nome}! A Froc fica aqui esperando a sua volta. {despedida}!',
    '{nome}, você está offline agora. Cuide de você. {despedida}!',
    'Encerrado por agora, {nome}. Missão cumprida. {despedida}!',
    'Obrigado por rodar com a Froc, {nome}. Você está offline. {despedida}!',
    'Pronto, {nome}, você saiu do ar. Descanse bem que amanhã tem mais. {despedida}!',
    'Tudo salvo, {nome}. Você está offline. Foi um prazer trabalhar com você. {despedida}!',
    'Offline, {nome}. Seus ganhos estão na carteira Froc. {despedida}!',
  ],
  nova_corrida: [
    'Nova corrida, {nome}! Embarque a {distancia} daqui.',
    '{nome}, chegou corrida! Passageiro a {distancia}.',
    'Atenção, {nome}: nova corrida a {distancia}. Toque para aceitar.',
    'Corrida chegando, {nome}! O passageiro está a {distancia}.',
    'Opa, {nome}, tem corrida pra você a {distancia}.',
    'Nova chamada, {nome}! Embarque a {distancia} de você.',
    '{nome}, corrida nova na tela, a {distancia}.',
    'Chegou corrida, {nome}. Passageiro esperando a {distancia}.',
    'Bora, {nome}! Corrida nova a {distancia}.',
    '{nome}, tem passageiro a {distancia} chamando a Froc.',
  ],
  corrida_aceita: [
    'Corrida aceita, {nome}! Siga até o passageiro com calma.',
    'Boa, {nome}! Corrida confirmada. Vá até o embarque com segurança.',
    'Aceita! {nome}, o passageiro já sabe que você está a caminho.',
    'Combinado, {nome}. O passageiro foi avisado. Bom caminho até o embarque.',
    'Corrida sua, {nome}! Use o botão Navegar para ir até o passageiro.',
    'Perfeito, {nome}. Corrida aceita. Dirija com tranquilidade.',
    'Fechado, {nome}! O passageiro está te esperando.',
    'Corrida confirmada, {nome}. Qualquer coisa, fale com o passageiro pelo chat.',
    'Aceita, {nome}! Siga a rota até o embarque.',
    'Show, {nome}! Corrida aceita. Rumo ao passageiro.',
  ],
  chegou_embarque: [
    'Você chegou ao embarque, {nome}. Peça o PIN de quatro números ao passageiro.',
    'Chegamos, {nome}! O passageiro foi avisado. Confirme o PIN para começar.',
    '{nome}, você está no local de embarque. Aguarde o passageiro e peça o PIN.',
    'Embarque! {nome}, o passageiro já sabe que você chegou.',
    'Pronto, {nome}, você está no ponto. Lembre de conferir o PIN antes de sair.',
    'Chegou, {nome}! Agora é só aguardar o passageiro e digitar o PIN.',
    '{nome}, local de embarque alcançado. O passageiro foi avisado na tela.',
    'Tudo certo, {nome}. Você está no embarque. Peça o código de quatro números.',
    'Você está no ponto de encontro, {nome}. Segurança: só inicie com o PIN certo.',
    'Chegamos ao embarque, {nome}. O primeiro minuto de espera é grátis para o passageiro.',
  ],
  embarque_confirmado: [
    'PIN confirmado! Boa viagem, {nome}.',
    'Passageiro a bordo, {nome}. Lembre o passageiro de colocar o cinto. Boa viagem!',
    'Embarque confirmado. Siga para {destino}. Boa viagem, {nome}!',
    'Tudo certo, {nome}! Viagem iniciada. Dirija com segurança.',
    'Viagem começou, {nome}. Destino: {destino}. Bom caminho!',
    'PIN correto, {nome}. Cinto afivelado e boa viagem!',
    'Partiu, {nome}! A viagem começou. Qualquer imprevisto, o botão SOS está na tela.',
    'Passageiro embarcou, {nome}. Rumo a {destino}. Boa viagem!',
    'Viagem iniciada, {nome}. Tranquilidade no trânsito e boa corrida.',
    'Confirmado, {nome}! Siga a rota até {destino} com segurança.',
  ],
  corrida_encerrada: [
    'Corrida encerrada, {nome}! {valor} já estão na sua carteira Froc.',
    'Parabéns, {nome}! Corrida concluída. {valor} na sua carteira.',
    'Mais uma, {nome}! Você ganhou {valor} nesta corrida.',
    'Corrida finalizada com sucesso, {nome}. {valor} creditados na carteira.',
    'Missão cumprida, {nome}! {valor} já caíram na sua carteira Froc.',
    'Fechou, {nome}! Corrida encerrada e {valor} na carteira.',
    'Valeu, {nome}! Corrida concluída: {valor} para você.',
    'Excelente, {nome}! {valor} na sua carteira Froc.',
    'Corrida terminada, {nome}. Seu ganho de {valor} já está disponível.',
    'Mandou bem, {nome}! {valor} creditados agora mesmo.',
  ],
  motorista_a_caminho: [
    '{saudacao}, {nome}! Seu motorista aceitou e chega em cerca de {minutos} minutos.',
    'Boa notícia, {nome}! Motorista a caminho. Chega em uns {minutos} minutos.',
    '{nome}, seu motorista já está vindo. Previsão de {minutos} minutos.',
    'Corrida confirmada, {nome}! Seu motorista chega em aproximadamente {minutos} minutos.',
    '{saudacao}, {nome}. Seu motorista está a caminho do embarque.',
    'Pronto, {nome}! Já tem motorista vindo te buscar, em cerca de {minutos} minutos.',
    '{nome}, confira a placa e o carro na tela. Seu motorista chega em {minutos} minutos.',
    'Motorista a caminho, {nome}! Fique atento ao local de embarque.',
    '{saudacao}, {nome}! A Froc encontrou seu motorista. Chega em uns {minutos} minutos.',
    'Tudo certo, {nome}. Seu motorista aceitou a corrida e já está vindo.',
  ],
  motorista_chegou: [
    '{nome}, seu motorista chegou! Confira a placa antes de entrar.',
    'Seu motorista está no local, {nome}. Informe o PIN para começar a viagem.',
    'Chegou, {nome}! Seu motorista está te esperando no embarque.',
    '{nome}, o motorista chegou. O primeiro minuto de espera é grátis.',
    'Seu motorista já está no ponto, {nome}. Confira carro e placa na tela.',
    'Atenção, {nome}: seu motorista chegou. Diga o seu PIN ao entrar.',
    '{nome}, seu motorista está aguardando. Segurança: confira a placa.',
    'Motorista no local, {nome}! Leve o PIN de quatro números com você.',
    'Seu motorista chegou, {nome}. Te espero no carro!',
    '{nome}, o carro chegou. Confira a placa e informe o PIN.',
  ],
  cinto: [
    'Viagem iniciada, {nome}. Por favor, coloque o cinto de segurança. Boa viagem!',
    '{nome}, coloque o cinto de segurança. Sua segurança vem em primeiro lugar.',
    'Boa viagem, {nome}! Não esqueça do cinto de segurança.',
    'Tudo pronto, {nome}. Afivele o cinto e aproveite a viagem.',
    '{nome}, a viagem começou. Use o cinto de segurança, inclusive no banco de trás.',
    'Partiu, {nome}! Cinto de segurança afivelado, por favor.',
    '{saudacao}, {nome}. Lembre de colocar o cinto. Você pode compartilhar a viagem pelo app.',
    'Viagem em andamento, {nome}. Cinto colocado e boa viagem!',
    '{nome}, sua segurança importa: coloque o cinto. Qualquer coisa, o botão SOS está na tela.',
    'Bem-vindo a bordo, {nome}! Coloque o cinto de segurança e boa viagem.',
  ],
  viagem_concluida: [
    'Chegamos, {nome}! Obrigado por viajar com a Froc. {despedida}!',
    'Viagem concluída, {nome}. Não esqueça seus pertences. {despedida}!',
    'Você chegou, {nome}! Avalie seu motorista, isso ajuda muito.',
    'Obrigado, {nome}! Foi um prazer levar você. {despedida}!',
    'Destino alcançado, {nome}. Confira se não esqueceu nada no carro.',
    'Chegamos ao destino, {nome}. Volte sempre para a Froc!',
    'Viagem encerrada, {nome}. Que tal avaliar sua experiência?',
    'Pronto, {nome}, você chegou. Cuidado ao abrir a porta. {despedida}!',
    'Obrigado por escolher a Froc, {nome}. Até a próxima viagem!',
    'Fim da viagem, {nome}. Seus pertences estão com você? {despedida}!',
  ],
};

/** Frases de incentivo (2 por corrida encerrada, sem repetir na mesma fala). */
export const INCENTIVOS = [
  'Você está fazendo um excelente trabalho.',
  'Cada corrida conta. Continue assim!',
  'Os passageiros adoram motoristas como você.',
  'Seu esforço faz a diferença na vida das pessoas.',
  'Mais uma corrida segura. Parabéns!',
  'Sua nota alta abre portas. Mantenha o capricho.',
  'Hoje é dia de bater meta!',
  'Lembre de se hidratar e fazer pausas.',
  'Dirigir com calma também é dirigir bem.',
  'Você é a cara da Froc.',
  'Simpatia é o seu melhor combustível.',
  'Grandes resultados vêm de pequenas corridas.',
  'Sua dedicação é inspiradora.',
  'O próximo passageiro já está chegando.',
  'Foco, segurança e bom humor: combinação perfeita.',
  'Você está construindo algo grande.',
  'Obrigado por representar a Froc com tanto cuidado.',
  'Que venham muitas outras corridas como essa!',
  'Seu trabalho move a cidade.',
  'Continue firme: o dia está rendendo.',
];

const TZ = 'America/Sao_Paulo';

/** Hora (0–23) e dia da semana em Brasília. */
export function horaBrasilia(date: Date) {
  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23', weekday: 'long' }).formatToParts(date);
  const hora = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const dia = String(parts.find((p) => p.type === 'weekday')?.value ?? '').toLowerCase();
  return { hora, dia };
}

/** Bom dia (5h–11h), boa tarde (12h–17h), boa noite (18h–4h), horário de Brasília. */
export function saudacao(date: Date) {
  const { hora } = horaBrasilia(date);
  return hora >= 5 && hora < 12 ? 'Bom dia' : hora >= 12 && hora < 18 ? 'Boa tarde' : 'Boa noite';
}

/** Despedida conforme a situação e a hora: bom serviço, bom descanso, boa tarde... */
export function despedida(situacao: SituacaoFroc, date: Date) {
  const { hora } = horaBrasilia(date);
  if (situacao === 'motorista_online') return 'Bom serviço';
  if (situacao === 'motorista_offline') return hora >= 18 || hora < 5 ? 'Bom descanso' : 'Bom descanso e até daqui a pouco';
  return hora >= 5 && hora < 12 ? 'Tenha um ótimo dia' : hora >= 12 && hora < 18 ? 'Boa tarde pra você' : hora >= 22 || hora < 5 ? 'Bom descanso' : 'Boa noite';
}

/** "18 reais e 50 centavos" (a voz lê melhor que "R$ 18,50"). */
export function reaisPorExtenso(valor: number) {
  const cents = Math.round(Math.max(0, valor) * 100);
  const r = Math.floor(cents / 100);
  const c = cents % 100;
  const reais = r === 1 ? '1 real' : `${r} reais`;
  if (!c) return reais;
  return r ? `${reais} e ${c} centavo${c === 1 ? '' : 's'}` : `${c} centavo${c === 1 ? '' : 's'}`;
}

/** "800 metros" / "2,3 quilômetros". */
export function distanciaFalada(km: number) {
  if (!Number.isFinite(km) || km < 0) return 'perto de você';
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} metros`;
  return `${km.toFixed(1).replace('.', ',').replace(/,0$/, '')} quilômetros`;
}

/** Primeiro nome, só letras (o nome vem do cadastro; nada de texto livre na voz). */
export function primeiroNome(nome: unknown) {
  const n = String(nome ?? '').trim().split(/\s+/)[0] || '';
  const limpo = n.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'-]/g, '').slice(0, 30);
  return limpo ? limpo[0].toUpperCase() + limpo.slice(1).toLowerCase() : '';
}

/** Texto de cidade/destino curto e só com letras, números e espaços. */
function destinoSeguro(d: unknown) {
  const t = String(d ?? '').replace(/[^\p{L}\p{N} .,'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
  return t || 'o destino';
}

export interface EscolhaFala {
  variante: number;
  /** Só em corrida_encerrada: 2 frases de incentivo. */
  incentivos?: number[];
}

/** Monta a fala final. Mesma conta no app e no servidor. */
export function montarFala(situacao: SituacaoFroc, escolha: EscolhaFala, dados: DadosFala, date = new Date()): string {
  const lista = FALAS[situacao];
  if (!lista) throw new Error('situacao_invalida');
  const i = Math.abs(Math.trunc(escolha.variante)) % lista.length;
  const nome = primeiroNome(dados.nome);
  // Corrida encerrada sem o valor: frase sem número (nunca "0 reais").
  const modelo = situacao === 'corrida_encerrada' && !(Number(dados.valor) > 0) ? 'Corrida encerrada, {nome}! Seu ganho já está na carteira Froc.' : lista[i];
  let texto = modelo
    .replace(/\{saudacao\}/g, saudacao(date))
    .replace(/\{despedida\}/g, despedida(situacao, date))
    .replace(/\{dia\}/g, horaBrasilia(date).dia)
    .replace(/\{valor\}/g, reaisPorExtenso(Number(dados.valor) || 0))
    .replace(/\{minutos\}/g, String(Math.max(1, Math.min(90, Math.round(Number(dados.minutos) || 5)))))
    .replace(/\{distancia\}/g, distanciaFalada(Number(dados.km)))
    .replace(/\{destino\}/g, destinoSeguro(dados.destino));
  // Sem nome cadastrado: tira o nome sem deixar vírgula sobrando.
  texto = nome ? texto.replace(/\{nome\}/g, nome) : texto.replace(/,?\s*\{nome\}\s*,?/g, ' ').replace(/\s+([!.?,])/g, '$1');
  if (situacao === 'corrida_encerrada') {
    const inc = (escolha.incentivos ?? []).slice(0, 3).map((n) => INCENTIVOS[Math.abs(Math.trunc(n)) % INCENTIVOS.length]);
    texto = [texto, ...new Set(inc)].join(' ');
  }
  return texto.replace(/\s+/g, ' ').replace(/^[\s,]+/, '').trim();
}

/** Escolhe uma versão diferente das últimas usadas (para não repetir a mesma fala). */
export function escolherVariante(total: number, recentes: number[], rng = Math.random): number {
  const livres = Array.from({ length: total }, (_, i) => i).filter((i) => !recentes.includes(i));
  const pool = livres.length ? livres : Array.from({ length: total }, (_, i) => i);
  return pool[Math.floor(rng() * pool.length)];
}

/** Duas frases de incentivo diferentes. */
export function escolherIncentivos(rng = Math.random): number[] {
  const a = Math.floor(rng() * INCENTIVOS.length);
  let b = Math.floor(rng() * INCENTIVOS.length);
  if (b === a) b = (a + 1) % INCENTIVOS.length;
  return [a, b];
}

export const SITUACOES = Object.keys(FALAS) as SituacaoFroc[];
