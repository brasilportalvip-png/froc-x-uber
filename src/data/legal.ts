/**
 * Regras, leis e exigências do Froc X Uber — FONTE ÚNICA.
 *
 * Este arquivo alimenta: as páginas públicas (/regras-e-requisitos, /como-funciona,
 * /perguntas-frequentes, /desenvolvedores), a ajuda dentro do app e o conhecimento dos
 * agentes de IA. Mudou uma regra? Mude aqui e tudo se atualiza junto.
 *
 * Não é parecer jurídico: leis municipais mudam e cada cidade tem decreto próprio.
 * Em caso de dúvida, a regra da prefeitura prevalece e a Froc consulta advogado.
 */

export const LEGAL_UPDATED = '2026-11-19';

export interface LegalSection {
  id: string;
  title: string;
  summary: string;
  items: string[];
  sources: string[];
}

/** Idade máxima padrão do veículo (anos de fabricação), quando a cidade não tem regra mais rígida. */
export const DEFAULT_MAX_VEHICLE_AGE = 10;

/**
 * Cidades com regra conhecida de idade do veículo para transporte por aplicativo.
 * Só entram aqui regras conferidas em fonte oficial; as demais usam o padrão da Froc
 * (configurável pelo Admin). A regra da cidade vale quando for mais rígida que a da Froc.
 */
export const CITY_VEHICLE_AGE: { city: string; state: string; maxYears: number; note: string }[] = [
  { city: 'São Paulo', state: 'SP', maxYears: 8, note: 'Secretaria Municipal de Mobilidade e Trânsito (SMT): até 8 anos de fabricação.' },
  { city: 'Campinas', state: 'SP', maxYears: 10, note: 'Regra municipal: até 10 anos de fabricação.' },
  { city: 'Fortaleza', state: 'CE', maxYears: 10, note: 'Regra municipal: até 10 anos de fabricação.' },
];

const norm = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/** Idade máxima que vale para o motorista desta cidade (a regra mais rígida entre Froc e prefeitura). */
export function vehicleAgeLimit(city: string, state: string, frocDefault = DEFAULT_MAX_VEHICLE_AGE) {
  const rule = CITY_VEHICLE_AGE.find((c) => norm(c.city) === norm(city) && (!state || norm(c.state) === norm(state)));
  if (rule && rule.maxYears < frocDefault) return { maxYears: rule.maxYears, source: rule.note };
  return { maxYears: frocDefault, source: rule ? rule.note : `Padrão Froc: até ${frocDefault} anos de fabricação.` };
}

/** Ano mínimo de fabricação aceito hoje. */
export function minVehicleYear(maxYears: number, now = new Date()) {
  return now.getFullYear() - maxYears;
}

export const REQUIREMENTS: LegalSection[] = [
  {
    id: 'motorista',
    title: 'Motorista de aplicativo (corridas, viagens agendadas e caronas)',
    summary:
      'A lei federal do transporte remunerado privado individual de passageiros exige CNH com EAR, veículo dentro das regras da cidade, CRLV em dia e certidão negativa de antecedentes criminais.',
    items: [
      'CNH categoria B ou superior com a observação EAR ("exerce atividade remunerada") impressa no documento. Sem EAR, o cadastro é recusado. A EAR é incluída no Detran do seu estado, com exame psicológico.',
      'CNH dentro da validade. Quando a CNH vence, o app deixa você offline até enviar a nova.',
      'Veículo com idade máxima permitida na sua cidade. Regra geral da Froc: até 10 anos de fabricação. Onde a prefeitura é mais rígida, vale a regra dela (ex.: São Paulo, até 8 anos).',
      'CRLV (documento do veículo) emitido e em dia, com licenciamento do ano.',
      'Certidão negativa de antecedentes criminais (emitida grátis pela internet: Polícia Federal e Tribunal de Justiça do seu estado).',
      'Inscrição no INSS como contribuinte individual (ou MEI, quando a atividade permitir). É exigência da lei para quem dirige por aplicativo.',
      'Seguro de Acidentes Pessoais a Passageiros (APP), conforme exigido pela prefeitura.',
      'Cadastro municipal, curso ou vistoria quando a sua cidade exigir (algumas capitais exigem). Confira na prefeitura.',
      'Padrão de qualidade Froc: carro com 4 portas, 5 lugares, ar-condicionado funcionando, sem avarias aparentes e limpo.',
    ],
    sources: [
      'Lei 12.587/2012 (Política Nacional de Mobilidade Urbana), arts. 11-A e 11-B, incluídos pela Lei 13.640/2018',
      'Código de Trânsito Brasileiro (Lei 9.503/1997), art. 147, §5º (observação EAR na CNH)',
      'Decretos e portarias de cada município sobre transporte por aplicativo',
    ],
  },
  {
    id: 'moto',
    title: 'Mototaxista e motoboy (Froc Moto e entregas)',
    summary: 'Transporte de passageiro ou de entrega em moto segue a Lei 12.009/2009 e as normas do CONTRAN, além da autorização da prefeitura.',
    items: [
      'Idade mínima de 21 anos.',
      'Habilitação na categoria A há pelo menos 2 anos, com EAR.',
      'Aprovação no curso especializado de mototaxista/motofretista reconhecido pelo Detran.',
      'Colete de segurança com faixas refletivas e capacete com faixas refletivas (e capacete extra higienizado para o passageiro).',
      'Moto com protetor de motor ("mata-cachorro") e antena corta-pipa, e registro na categoria exigida pela prefeitura (em muitas cidades, placa de aluguel).',
      'Em algumas cidades o mototáxi por aplicativo é proibido ou depende de autorização municipal. A Froc só libera a categoria Froc Moto onde for permitido.',
      'Moto não leva carga acima de 20 kg nem volumes que atrapalhem a pilotagem.',
    ],
    sources: ['Lei 12.009/2009 (mototaxista e motofretista)', 'Resoluções do CONTRAN sobre mototáxi e motofrete', 'Lei e decreto do município'],
  },
  {
    id: 'carga',
    title: 'Transportador de carga (fretes, mudanças e retorno vazio)',
    summary:
      'Transporte remunerado de carga de terceiros exige registro na ANTT (RNTRC), CIOT antes de cada viagem e respeito ao piso mínimo de frete da ANTT.',
    items: [
      'CNH compatível com o veículo (B para utilitário e pick-up; C, D ou E para caminhões, conforme o peso), com EAR.',
      'RNTRC (Registro Nacional de Transportadores Rodoviários de Cargas) ativo na ANTT, obrigatório para frete pago de carga de terceiros. Quem leva a própria carga não precisa.',
      'CRLV em dia. Para frete remunerado o veículo deve estar no nome do transportador (ou com contrato registrado) e na categoria exigida.',
      'CIOT (Código Identificador da Operação de Transporte) gerado antes de cada viagem contratada, quando a lei exigir.',
      'Piso mínimo de frete da ANTT: nenhum frete pode ser contratado abaixo dele. Pela Lei 15.485/2026, plataformas e intermediadores que ofertam frete abaixo do piso também respondem. A Froc mostra o piso e bloqueia lances abaixo do mínimo da plataforma.',
      'Vale-pedágio: em frete rodoviário, o pedágio é pago pelo contratante (embarcador), à parte do frete.',
      'Certidão negativa de antecedentes criminais (padrão de segurança Froc para quem entra na casa do cliente em mudanças).',
      'Proibido transportar produto perigoso sem a licença e o curso específico (MOPP), animais vivos sem documento sanitário e qualquer carga ilegal.',
    ],
    sources: [
      'Lei 11.442/2007 (transporte rodoviário de cargas e RNTRC)',
      'Lei 13.703/2018 (Política Nacional de Pisos Mínimos do Frete)',
      'Lei 15.485/2026 (piso mínimo obrigatório, CIOT e responsabilidade de plataformas)',
      'Lei 10.209/2001 (vale-pedágio obrigatório)',
      'Resoluções da ANTT',
    ],
  },
  {
    id: 'lojista',
    title: 'Lojas, restaurantes e lanchonetes (Froc Entregas)',
    summary: 'Qualquer comércio com CNPJ (inclusive MEI) pode integrar o sistema e chamar entregadores da Froc automaticamente.',
    items: [
      'CNPJ ativo (MEI aceito). A equipe Froc confere antes de liberar.',
      'Endereço de coleta real (onde o entregador retira o pedido).',
      'A loja é responsável pelo conteúdo, embalagem e nota fiscal do pedido.',
      'Proibido enviar armas, munição, drogas, explosivos, inflamáveis, animais e qualquer item ilegal.',
      'Bebida alcoólica e cigarro só podem ser entregues a maiores de 18 anos: o entregador pode pedir documento e devolver o pedido se não houver comprovação.',
      'Até 20 kg por entrega de moto; acima disso, use Cargas.',
      'A entrega é paga pela carteira da loja: o valor fica retido e só vai para o entregador quando o cliente informa o código de entrega.',
    ],
    sources: ['Estatuto da Criança e do Adolescente, art. 243 (venda de bebida a menores)', 'Código de Defesa do Consumidor', 'Termos de uso Froc'],
  },
  {
    id: 'passageiro',
    title: 'Passageiros e clientes',
    summary: 'Conta pessoal, maior de 18 anos, com respeito ao motorista e às regras de trânsito.',
    items: [
      'Ter 18 anos ou mais para criar conta. Menores só viajam acompanhados de um adulto responsável.',
      'Confirmar o CPF no cadastro (nome completo, CPF e data de nascimento), conferido na Receita Federal. Motoristas veem o selo "passageiro verificado".',
      'Uma pessoa, uma conta: o CPF só pode estar em uma conta, mesmo trocando de celular ou de e-mail. Conta bloqueada bloqueia o CPF.',
      'Usar cinto de segurança (obrigatório para todos no veículo).',
      'Informar o PIN de embarque só depois de entrar no carro certo (confira placa, modelo e foto).',
      'Não levar objetos ilegais ou perigosos. Animais de estimação só com combinação prévia com o motorista (cão-guia é sempre aceito, por lei).',
      'Respeito: assédio, discriminação ou violência geram bloqueio imediato e registro na polícia.',
    ],
    sources: ['Código de Trânsito Brasileiro, art. 65 (cinto)', 'Lei 11.126/2005 (cão-guia)', 'Termos de uso Froc'],
  },
];

export const RECORDING_RULES = {
  title: 'Gravar a viagem (áudio ou vídeo pelo próprio celular)',
  items: [
    'Passageiro e motorista podem gravar o áudio ou filmar a viagem pelo próprio celular, direto no app, com um toque.',
    'A gravação fica SÓ no seu celular. A Froc não recebe, não guarda e não vê o arquivo.',
    'Quando alguém começa a gravar, a outra pessoa recebe um aviso no app. Transparência evita conflito.',
    'No Brasil, a gravação feita por quem participa da conversa é prova válida (STF, RE 583.937). Use para sua segurança e para se defender.',
    'Não publique a gravação em redes sociais nem exponha a outra pessoa: isso pode violar o direito de imagem e a LGPD. Entregue à polícia ou à Froc (no Atendimento) quando houver ocorrência.',
    'O navegador só grava com o app aberto na tela. Mantenha o celular desbloqueado e com bateria; o app evita que a tela apague durante a gravação.',
  ],
};

export const SHARE_RULES = {
  title: 'Compartilhar a viagem com alguém de confiança',
  items: [
    'Durante a corrida, toque em "Compartilhar viagem" e envie o link pelo WhatsApp ou SMS.',
    'Quem recebe o link acompanha o carro no mapa em tempo real, sem precisar baixar nada nem criar conta.',
    'O link mostra: situação da viagem, partida, destino, primeiro nome do motorista, modelo, cor e placa do carro. Nunca mostra telefones, e-mails ou valores.',
    'O link para de mostrar a localização quando a viagem termina e expira em até 24 horas.',
  ],
};

export const QUALITY_CONTROL = [
  'Todos são verificados: passageiros confirmam o CPF (conferido na Receita) e motoristas têm documentos conferidos. Uma pessoa, uma conta.',
  'Todo motorista, motoboy e transportador passa por análise manual de documentos antes de ser liberado (CNH com EAR, CRLV, antecedentes e, em cargas, RNTRC).',
  'Ano do veículo conferido no cadastro conforme a regra da cidade.',
  'CNH com validade: vencida, o motorista fica offline até atualizar.',
  'Regras de respeito com cobrança automática: cancelamento tardio paga o motorista e espera no embarque tem acréscimo (+10%, +30%, +50%).',
  'Avaliação dos dois lados em toda viagem. Motorista com média abaixo de 4,5 depois de 20 avaliações entra em revisão pela equipe.',
  'PIN de embarque: a viagem só começa com o código que o passageiro informa no carro certo.',
  'Botão SOS com localização para a central, ligação para o 190 e compartilhamento da viagem.',
  'Gravação de áudio e vídeo pelo próprio celular, com aviso à outra parte.',
  'Todo pagamento passa pela carteira Froc (sem dinheiro na mão): o valor fica retido até o serviço terminar e cancelamento devolve.',
  'Só ganhos podem ser transferidos por Pix: recarga feita com cartão não vira saque (bloqueia golpe com cartão roubado).',
  'Registro de auditoria de toda ação da equipe e dos agentes de IA.',
];

export const HOW_IT_WORKS: { title: string; steps: string[] }[] = [
  {
    title: 'Corridas',
    steps: [
      'Abra o app: a partida já vem com o seu endereço atual.',
      'Digite o destino, escolha a categoria e veja o preço antes de pedir.',
      'Pague com o saldo da carteira Froc (recarga por Pix ou cartão). Não existe dinheiro na mão.',
      'Acompanhe o carro chegando no mapa, confira placa e modelo e informe o PIN ao motorista.',
      'Durante a viagem: chat, SOS, gravação e link para a família acompanhar.',
      'No fim, avalie o motorista. O valor só é liberado para ele quando a corrida termina.',
    ],
  },
  {
    title: 'Viagens agendadas',
    steps: [
      'Diga de onde sai, para onde vai, o dia e a hora (ex.: aeroporto de Campinas às 12h15 para o Rio de Janeiro), quantas pessoas e quanto quer pagar.',
      'Escolha: VIP (o carro só para você, mais conforto e privacidade) ou Compartilhada (divide o carro com outras pessoas e paga menos).',
      'Motoristas de todo o Brasil que vão passar pela sua cidade mandam propostas; você escolhe a melhor e a viagem fica agendada.',
      'Valem as mesmas regras das caronas: valor retido na carteira, caução do motorista, PIN de embarque e cancelamento justo para os dois lados.',
    ],
  },
  {
    title: 'Caronas',
    steps: [
      'Motoristas aprovados publicam viagens entre cidades com data, horário, vagas e preço por vaga.',
      'Você reserva pagando pela carteira; o valor fica retido. O motorista deixa uma caução de 20% de cada reserva.',
      'No embarque você mostra o PIN de 4 números; com ele o motorista recebe quando a viagem acontece.',
      'Cancelou com mais de 24h: 100% de volta. Entre 24h e 2h: 50%. Depois disso, sem reembolso. Se o motorista cancelar em cima da hora, você recebe 100% + compensação da caução dele.',
    ],
  },
  {
    title: 'Cargas (fretes, mudanças e retorno vazio)',
    steps: [
      'Descreva a carga (a calculadora de cubagem sugere o veículo) e o orçamento.',
      'Transportadores com RNTRC dão lances; você escolhe.',
      'Ou reserve um caminhão que volta vazio na sua rota, mais barato.',
      'O pagamento fica retido até a entrega confirmada.',
    ],
  },
  {
    title: 'Froc Entregas para lojas',
    steps: [
      'A loja cria a conta, envia o CNPJ e o endereço de coleta.',
      'Liberada, chama entregas pelo painel ou integra o sistema dela pela API (com aviso automático de status por webhook).',
      'O cliente recebe um link para acompanhar o entregador e um código de entrega.',
      'O entregador só conclui com o código; o valor sai da carteira da loja e vai para ele.',
    ],
  },
];

export const FAQ: [string, string][] = [
  ['Preciso ter EAR na CNH para dirigir na Froc?', 'Sim. A lei exige a observação EAR (exerce atividade remunerada) na CNH de quem transporta passageiros ou carga por dinheiro. Sem EAR o cadastro é recusado. Você inclui a EAR no Detran do seu estado.'],
  ['Qual o ano mínimo do carro?', `A regra geral da Froc é até ${DEFAULT_MAX_VEHICLE_AGE} anos de fabricação. Se a sua cidade for mais rígida, vale a regra dela: em São Paulo, por exemplo, até 8 anos. O app confere no cadastro.`],
  ['Que documentos o motorista envia?', 'CNH com EAR (foto ou PDF), CRLV do veículo e certidão negativa de antecedentes criminais, além de modelo, cor, ano e placa. Também declara a inscrição no INSS e o seguro APP exigidos por lei.'],
  ['Moto pode rodar na Froc?', 'Sim, como Froc Moto (passageiro) ou entregas, seguindo a Lei 12.009/2009: 21 anos ou mais, 2 anos de habilitação na categoria A, curso de mototaxista/motofretista e equipamentos obrigatórios. Onde a prefeitura proíbe mototáxi, só entregas.'],
  ['Transportador de carga precisa de quê?', 'CNH compatível com EAR, CRLV, RNTRC ativo na ANTT, CIOT antes de cada viagem e respeitar o piso mínimo de frete da ANTT.'],
  ['Posso gravar a viagem?', 'Pode. Passageiro e motorista gravam áudio ou vídeo pelo próprio celular, direto no app. O arquivo fica só no seu aparelho e a outra parte recebe um aviso. Não publique em redes sociais.'],
  ['Como minha família acompanha a viagem?', 'Toque em "Compartilhar viagem" durante a corrida e mande o link. A pessoa vê o carro no mapa em tempo real, sem baixar nada. O link expira quando a viagem acaba.'],
  ['O mapa mostra os carros andando?', 'Sim. Antes de pedir, você vê os motoristas online perto de você (posição aproximada, por privacidade). Depois do aceite, vê o carro do seu motorista se movendo até você e durante a viagem.'],
  ['Minha loja pode usar a entrega da Froc?', 'Pode. Crie a conta, envie o CNPJ na aba Conta > Froc para lojas e, depois de aprovado, chame entregas pelo painel ou integre seu sistema pela API (veja /desenvolvedores).'],
  ['Quanto o motorista recebe?', 'O motorista vê quanto vai receber antes de aceitar cada corrida, e o valor cai na carteira dele assim que a corrida termina. O passageiro vê o preço final antes de pedir.'],
  ['Por que o preço muda conforme o horário?', 'O preço funciona como um leilão automático: o valor do km sobe na madrugada (+35%), no pico da manhã (+25%), no almoço (+15%), no pico da noite (+30%), à noite (+15%), na sexta e no sábado à noite (+40%), no fim de semana (+10%), nos feriados (+25%), com chuva (+10% a +35%) e com muita procura na região. O app mostra o motivo antes de você pedir. Em áreas de risco há um acréscimo que vai inteiro para o motorista.'],
  ['Como funciona o pagamento?', 'Tudo pela carteira Froc. Você recarrega por Pix ou cartão (Mercado Pago). Ao pedir, o valor sai do seu saldo (tinha R$ 100, corrida de R$ 20, fica com R$ 80) e a Froc guarda. Quando a corrida termina, vai sozinho para a conta do motorista. Cancelou antes? Volta para você.'],
  ['Posso pagar em dinheiro ou fazer Pix direto para o motorista?', 'Não. Para acabar com golpes de troco, cobrança por fora e corrida fantasma, todo pagamento passa pela carteira Froc. Se alguém pedir pagamento por fora, não pague e avise o Atendimento.'],
  ['Como o motorista recebe e tira o dinheiro?', 'O ganho cai no saldo dele assim que finaliza a viagem. Ele pode usar o saldo no próprio app ou transferir por Pix para qualquer conta (dele ou de outra pessoa), a partir de R$ 20. Só os ganhos podem ir para Pix; saldo de recarga é para usar no app.'],
  ['E se o motorista não aparecer?', 'Se ninguém aceitar no tempo limite, o pedido é cancelado sozinho e o valor volta para a carteira. Se o motorista desistir, a corrida volta para a fila.'],
  ['Por que preciso informar meu CPF?', 'Para segurança de todos: o motorista sabe que o passageiro é uma pessoa real e verificada, e você sabe quem é o motorista. O CPF é conferido na Receita Federal junto com o nome e a data de nascimento. Os outros usuários veem só o selo de verificado, nunca o seu CPF. Para ganhar o selo verde, envie uma foto da CNH, RG ou CIN em Conta: a IA da Froc confere na hora.'],
  ['Posso ter mais de uma conta?', 'Não. Cada pessoa pode ter uma única conta, ligada ao CPF. Trocar de celular ou de e-mail não muda isso: entre na sua conta de sempre. Se perdeu o acesso, fale com o Atendimento.'],
  ['Posso cancelar a corrida?', 'Pode. Antes de algum motorista aceitar, e até 1 minuto depois do aceite, é grátis. Entre 1 e 2 minutos, 50% do valor vai para o motorista. Depois de 2 minutos, ou com o motorista já no embarque, ele recebe 100%. Se o motorista atrasar mais de 10 minutos além do previsto, ou desistir, você não paga nada.'],
  ['O motorista chegou e eu demorei. Pago a mais?', 'Quando o motorista chega, aparece um aviso na sua tela com um contador. O primeiro minuto é grátis. Depois: +10% com 1 minuto, +30% com 2 minutos e +50% a partir de 3 minutos. Com 5 minutos, o motorista pode encerrar como "passageiro não apareceu" e recebe 100%.'],
  ['Como funciona o controle de qualidade?', 'Documentos conferidos por pessoas, CNH e veículo dentro da validade e da idade permitida, avaliação dos dois lados e revisão de quem fica com nota baixa.'],
  ['Em emergência, o que faço?', 'Ligue 190 (Polícia) ou 192 (SAMU). No app, toque em SOS: a central Froc recebe sua localização e os dados da viagem.'],
];

/** Resumo para os agentes de IA (entra no conhecimento oficial de todos eles). */
export function legalKnowledgeText(maxVehicleAgeYears = DEFAULT_MAX_VEHICLE_AGE): string {
  const req = REQUIREMENTS.map((s) => `- ${s.title}: ${s.summary}\n${s.items.map((i) => `  • ${i}`).join('\n')}\n  Base legal: ${s.sources.join('; ')}.`).join('\n');
  const cities = CITY_VEHICLE_AGE.map((c) => `${c.city}/${c.state}: até ${c.maxYears} anos`).join('; ');
  return `
[REGRAS, LEIS E EXIGÊNCIAS — atualizado em ${LEGAL_UPDATED}; páginas públicas: /regras-e-requisitos, /como-funciona, /perguntas-frequentes, /desenvolvedores]
${req}
- Idade do veículo: padrão Froc atual até ${maxVehicleAgeYears} anos de fabricação; vale a regra da cidade quando mais rígida (${cities}). Para cidades não listadas, oriente conferir na prefeitura; não invente a regra de uma cidade.
- DPVAT/SPVAT: não existe mais cobrança (o seguro obrigatório foi extinto em 2024). Não peça DPVAT.
- ${RECORDING_RULES.title}: ${RECORDING_RULES.items.join(' ')}
- ${SHARE_RULES.title}: ${SHARE_RULES.items.join(' ')}
- Controle de qualidade: ${QUALITY_CONTROL.join(' ')}
- Mapa: antes de pedir, mostra motoristas online próximos com posição aproximada (privacidade); após o aceite, o carro do motorista se move ao vivo (posição enviada pelo celular dele a cada poucos segundos).
- Froc Entregas: lojas com CNPJ aprovado chamam entregas pelo painel (Conta > Froc para lojas) ou por API REST (/api/v1, chave "froc_live_...", webhooks assinados com HMAC). Documentação em /desenvolvedores.
- Você NÃO é advogado: em dúvida jurídica específica, explique a regra geral, cite a lei e recomende confirmar com a prefeitura, o Detran, a ANTT ou um advogado.
`;
}
