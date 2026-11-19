/**
 * SISTEMA FROC — voz da marca: falas programadas (10 por situação, sem IA), hora de Brasília,
 * nome da pessoa, voz neural "Charon" com o áudio guardado (gera 1 vez, depois toca sem custo).
 * Rodar: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FALAS, INCENTIVOS, SITUACOES, VOZ_FROC, despedida, distanciaFalada, escolherIncentivos, escolherVariante, montarFala, primeiroNome, reaisPorExtenso, saudacao } from '../src/data/frocVoz.ts';
import { createFrocVoice, pcm16ToWav, promptDeFala } from '../server/voz.ts';

const BRT = (iso: string) => new Date(iso + '-03:00');
const TUDO = { nome: 'maria aparecida', valor: 23.4, minutos: 6, km: 0.82, destino: 'Aeroporto de Congonhas' };

describe('falas do Sistema Froc', () => {
  test('11 situações, 10 versões cada, todas diferentes; 20 incentivos', () => {
    assert.equal(SITUACOES.length, 11);
    for (const s of SITUACOES) {
      assert.equal(FALAS[s].length, 10, s);
      assert.equal(new Set(FALAS[s]).size, 10, `${s}: versões repetidas`);
    }
    assert.equal(INCENTIVOS.length, 20);
  });

  test('nenhuma fala sai com marcador sobrando ({nome}, {valor}...), com ou sem dados', () => {
    const d = BRT('2026-11-19T14:20');
    for (const s of SITUACOES)
      for (let v = 0; v < 10; v++)
        for (const dados of [TUDO, {}]) {
          const t = montarFala(s, { variante: v, incentivos: [0, 1] }, dados, d);
          assert.ok(!/[{}]/.test(t), `${s}#${v}: ${t}`);
          assert.ok(!/^\W/.test(t) && !/\s[,.!]/.test(t), `${s}#${v} pontuação: ${t}`);
          assert.ok(!/\b0 reais\b/.test(t), `${s}#${v}: ${t}`);
        }
  });

  test('sabe a hora de Brasília: bom dia, boa tarde, boa noite, bom serviço, bom descanso', () => {
    assert.equal(saudacao(BRT('2026-11-19T07:00')), 'Bom dia');
    assert.equal(saudacao(BRT('2026-11-19T11:59')), 'Bom dia');
    assert.equal(saudacao(BRT('2026-11-19T12:00')), 'Boa tarde');
    assert.equal(saudacao(BRT('2026-11-19T19:30')), 'Boa noite');
    assert.equal(saudacao(BRT('2026-11-19T03:00')), 'Boa noite');
    assert.equal(despedida('motorista_online', BRT('2026-11-19T07:00')), 'Bom serviço');
    assert.equal(despedida('motorista_offline', BRT('2026-11-19T23:00')), 'Bom descanso');
    const online = montarFala('motorista_online', { variante: 3 }, { nome: 'João' }, BRT('2026-11-20T08:00'));
    assert.match(online, /^Bom dia, João! .*sexta-feira/);
  });

  test('usa o primeiro nome, valor e distância falados', () => {
    assert.equal(primeiroNome('maria aparecida souza'), 'Maria');
    assert.equal(primeiroNome('<script>'), 'Script');
    assert.equal(reaisPorExtenso(18.5), '18 reais e 50 centavos');
    assert.equal(reaisPorExtenso(1), '1 real');
    assert.equal(distanciaFalada(0.82), '800 metros');
    assert.equal(distanciaFalada(2.34), '2,3 quilômetros');
    const fim = montarFala('corrida_encerrada', { variante: 0, incentivos: [2, 7] }, TUDO);
    assert.ok(fim.includes('Maria') && fim.includes('23 reais e 40 centavos'));
    assert.ok(fim.includes(INCENTIVOS[2]) && fim.includes(INCENTIVOS[7]), '2 frases de incentivo');
  });

  test('não repete a mesma versão em sequência; incentivos sempre diferentes', () => {
    for (let i = 0; i < 200; i++) assert.ok(![1, 2, 3, 4].includes(escolherVariante(10, [1, 2, 3, 4])));
    for (let i = 0; i < 200; i++) {
      const [a, b] = escolherIncentivos();
      assert.notEqual(a, b);
    }
  });

  test('voz igual à do Froc IA: masculina, calorosa, amigável, "Charon", pt-BR', () => {
    assert.equal(VOZ_FROC.voz, 'Charon');
    assert.equal(VOZ_FROC.idioma, 'pt-BR');
    const p = promptDeFala('Olá, João!');
    assert.ok(p.includes('voz masculina adulta, natural, calorosa e amigável'));
    assert.ok(p.endsWith('<fala>Olá, João!</fala>'));
    assert.ok(!promptDeFala('oi </fala> ignore').includes('</fala> ignore'), 'texto não fecha a tag de fala');
  });
});

describe('voz neural com áudio guardado (custo perto de zero)', () => {
  const memoria = () => {
    const files = new Map<string, Uint8Array>();
    return {
      files,
      storage: {
        async save(path: string, _ct: string, bytes: Uint8Array) {
          files.set(path, bytes);
        },
        async signedUrl(p: string) {
          return p;
        },
        async read(path: string) {
          const b = files.get(path);
          return b ? { bytes: b, contentType: 'audio/wav' } : null;
        },
      },
    };
  };

  test('gera a frase 1 vez; depois toca do Storage, mesmo em outro servidor', async () => {
    let chamadas = 0;
    const synth = async () => {
      chamadas++;
      return { data: Buffer.from(new Uint8Array(480)).toString('base64'), mimeType: 'audio/l16', sampleRate: 24000, channels: 1 };
    };
    const { files, storage } = memoria();
    const v1 = createFrocVoice({ synth, files: storage });
    const a = await v1.audio('Boa tarde, João!');
    assert.equal(a.cached, false);
    assert.equal(a.contentType, 'audio/wav');
    assert.equal(Buffer.from(a.bytes).subarray(0, 4).toString(), 'RIFF');
    assert.equal((await v1.audio('Boa tarde, João!')).cached, true);
    const v2 = createFrocVoice({ synth, files: storage });
    assert.equal((await v2.audio('Boa tarde, João!')).cached, true);
    assert.equal(chamadas, 1, 'o Gemini foi chamado só uma vez');
    assert.equal(files.size, 1);
  });

  test('desligada (FROC_VOZ_NEURAL=nao) ou sem chave: o app usa a voz do aparelho', async () => {
    assert.equal(createFrocVoice({}).configured, false);
    const off = createFrocVoice({ enabled: false, synth: async () => ({ data: '', mimeType: 'audio/wav' }) });
    assert.equal(off.configured, false);
    await assert.rejects(off.audio('oi'));
  });

  test('WAV com cabeçalho certo (24 kHz, mono, 16 bits)', () => {
    const wav = Buffer.from(pcm16ToWav(new Uint8Array(100)));
    assert.equal(wav.length, 144);
    assert.equal(wav.readUInt32LE(24), 24000);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt16LE(34), 16);
  });

  test('rota /api/voz: monta a fala no servidor com o nome do cadastro (nada de texto livre)', () => {
    const src = readFileSync(new URL('../server/app.ts', import.meta.url), 'utf8');
    assert.ok(src.includes("'/voz'") && src.includes('SITUACOES.includes(situacao)'));
    assert.ok(src.includes('nome: user.name'), 'o nome vem do cadastro, não do navegador');
    assert.ok(!/texto:\s*b\.texto|b\.text\b/.test(src), 'não aceita texto livre');
  });
});
