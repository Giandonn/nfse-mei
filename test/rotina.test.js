// A rotina automática com o mundo simulado: datas, portal, emissão, e-mail e notificações são falsos.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { rotina, competenciaPendente, MAX_FALHAS } = require('../src/rotina');
const historico = require('../src/historico');
const painel = require('../src/painel');
const { formatarBR } = require('../src/datas');

const CHAVE = n => `3550308221122233300018100000000000${String(n).padStart(2, '0')}26106317551029`.slice(0, 50);

function cenario({ tomadores, hoje, respostas = [], emitir, sincronizar, notasPortal = [], emailFalha = false, cfgExtra = {} }) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-mei-rotina-'));
  const cfg = {
    prestadorCnpj: '11222333000181', pastaNotas: pasta,
    servico: { municipio: 'São Paulo/SP', codigoTributacaoNacional: '01.01.01', nbs: '115022000', descricao: 'Desenvolvimento' },
    tomadores, email: { remetente: 'eu@exemplo.com' }, ...cfgExtra,
  };
  const ev = { avisos: [], perguntas: [], emitidas: [], emails: [], terminal: [], urls: [], sincronizou: 0 };
  let numero = 20;
  const dep = {
    cfg, hoje, agora: new Date(hoje.getTime() + 10 * 3600000), estado: {}, log: () => {}, historico, painel,
    notificar: {
      avisar: async (titulo, texto) => { ev.avisos.push({ titulo, texto }); },
      perguntar: async (titulo, texto, botoes) => { ev.perguntas.push({ titulo, texto, botoes }); return respostas.shift() ?? null; },
    },
    sincronizar: sincronizar || (async () => { ev.sincronizou++; if (notasPortal.length) historico.salvarPortal(cfg, notasPortal, hoje, hoje); }),
    emitir: emitir || (async d => {
      const chave = CHAVE(++numero);
      ev.emitidas.push({ ...d, chave });
      const t = cfg.tomadores[d.apelido];
      historico.registrar(cfg, { competencia: d.competencia, apelido: d.apelido, tomador: t, centavos: require('../src/valores').parseValor(d.valor) }, chave);
      return { ok: true, chave };
    }),
    enviarEmail: async d => { if (emailFalha) throw new Error('senha de app recusada'); ev.emails.push(d); },
    abrirTerminal: args => ev.terminal.push(args),
    abrirUrl: url => ev.urls.push(url),
  };
  return { dep, ev, cfg };
}

const ACME = { cnpj: '11444777000161', nome: 'ACME LTDA', email: 'fin@acme.com', mensal: { ativo: true, valor: '3.500,00', automatico: true } };

test('competência pendente: só a partir do último dia útil, e até o dia 10 do mês seguinte', () => {
  assert.strictEqual(competenciaPendente(new Date(2026, 9, 29)), null); // 29/10, antes do último dia útil (30/10)
  assert.strictEqual(competenciaPendente(new Date(2026, 9, 30)).mes, '2026-10');
  assert.strictEqual(formatarBR(competenciaPendente(new Date(2026, 9, 31)).data), '30/10/2026'); // sábado: ainda outubro
  assert.strictEqual(competenciaPendente(new Date(2026, 10, 3)).mes, '2026-10'); // PC desligado: recupera
  assert.strictEqual(competenciaPendente(new Date(2026, 10, 11)), null);
  assert.strictEqual(competenciaPendente(new Date(2027, 0, 5)).mes, '2026-12'); // virada de ano
});

test('automático: no último dia útil emite sozinho, manda e-mail e avisa', async () => {
  const { dep, ev } = cenario({ tomadores: { acme: ACME }, hoje: new Date(2026, 9, 30) });
  const feito = await rotina(dep);
  assert.strictEqual(ev.emitidas.length, 1);
  assert.deepStrictEqual(ev.emitidas[0], { apelido: 'acme', valor: '3.500,00', competencia: '30/10/2026', chave: ev.emitidas[0].chave });
  assert.strictEqual(ev.sincronizou, 1, 'confere o portal antes de emitir');
  assert.strictEqual(ev.perguntas.length, 0, 'automático não pergunta');
  assert.strictEqual(ev.emails.length, 1);
  assert.match(ev.avisos.find(a => a.titulo.includes('emitida')).texto, /Enviei para fin@acme\.com/);
  assert.ok(feito.some(f => f.acao === 'emitiu'));

  // Rodando de novo no mesmo dia (o agendador roda a cada 2h): não emite de novo.
  ev.avisos.length = 0;
  await rotina(dep);
  assert.strictEqual(ev.emitidas.length, 1, 'nunca emite duas vezes');
});

test('antes do último dia útil não faz nada com as notas', async () => {
  const { dep, ev } = cenario({ tomadores: { acme: ACME }, hoje: new Date(2026, 9, 14) });
  await rotina(dep);
  assert.strictEqual(ev.emitidas.length + ev.perguntas.length + ev.sincronizou, 0);
});

test('nota feita à mão no portal: a sincronização acha e não emite de novo', async () => {
  const manual = { chave: CHAVE(19), numero: '19', geracao: '30/10/2026', mes: '2026-10', cnpj: ACME.cnpj, nome: 'ACME LTDA', centavos: 350000, cancelada: false, origem: 'portal' };
  const { dep, ev } = cenario({ tomadores: { acme: ACME }, hoje: new Date(2026, 9, 30), notasPortal: [manual] });
  const feito = await rotina(dep);
  assert.strictEqual(ev.emitidas.length, 0);
  assert.deepStrictEqual(feito.find(f => f.acao === 'ja-existia'), { acao: 'ja-existia', apelido: 'acme', numero: '19' });
});

test('nota cancelada no portal não conta: emite de novo', async () => {
  const cancelada = { chave: CHAVE(19), numero: '19', geracao: '30/10/2026', mes: '2026-10', cnpj: ACME.cnpj, nome: 'ACME', centavos: 350000, cancelada: true, origem: 'portal' };
  const { dep, ev } = cenario({ tomadores: { acme: ACME }, hoje: new Date(2026, 9, 30), notasPortal: [cancelada] });
  await rotina(dep);
  assert.strictEqual(ev.emitidas.length, 1);
});

test('perguntar: os 3 botões fazem o que dizem', async () => {
  const pergunta = { ...ACME, mensal: { ativo: true, valor: '3.500,00', automatico: false } };
  // "Lembrar amanhã": não emite e não pergunta de novo hoje.
  let c = cenario({ tomadores: { acme: pergunta }, hoje: new Date(2026, 9, 30), respostas: ['Lembrar amanhã'] });
  await rotina(c.dep);
  assert.deepStrictEqual(c.ev.perguntas[0].botoes, ['Emitir agora', 'Lembrar amanhã', 'Pular este mês']);
  assert.match(c.ev.perguntas[0].texto, /R\$ 3\.500,00 para ACME LTDA/);
  await rotina(c.dep);
  assert.strictEqual(c.ev.perguntas.length, 1);
  assert.strictEqual(c.ev.emitidas.length, 0);

  // "Pular este mês": não pergunta mais neste mês, nem amanhã.
  c = cenario({ tomadores: { acme: pergunta }, hoje: new Date(2026, 9, 30), respostas: ['Pular este mês'] });
  await rotina(c.dep);
  c.dep.hoje = new Date(2026, 10, 2); c.dep.agora = new Date(2026, 10, 2, 12);
  await rotina(c.dep);
  assert.strictEqual(c.ev.perguntas.filter(p => p.titulo.includes('nota')).length, 1);

  // "Emitir agora": emite.
  c = cenario({ tomadores: { acme: pergunta }, hoje: new Date(2026, 9, 30), respostas: ['Emitir agora'] });
  await rotina(c.dep);
  assert.strictEqual(c.ev.emitidas.length, 1);

  // Sem resposta (janela fechou sozinha): pergunta de novo só algumas horas depois.
  c = cenario({ tomadores: { acme: pergunta }, hoje: new Date(2026, 9, 30) });
  await rotina(c.dep);
  await rotina(c.dep);
  assert.strictEqual(c.ev.perguntas.length, 1);
  c.dep.agora = new Date(c.dep.agora.getTime() + 5 * 3600000);
  await rotina(c.dep);
  assert.strictEqual(c.ev.perguntas.length, 2);
});

test('sem valor fixo: o botão abre o terminal para digitar o valor', async () => {
  const semValor = { ...ACME, mensal: { ativo: true, valor: '', automatico: false } };
  const { dep, ev } = cenario({ tomadores: { acme: semValor }, hoje: new Date(2026, 9, 30), respostas: ['Abrir para emitir'] });
  await rotina(dep);
  assert.deepStrictEqual(ev.perguntas[0].botoes[0], 'Abrir para emitir');
  assert.deepStrictEqual(ev.terminal[0], ['emitir', '--tomador', 'acme', '--competencia', '30/10/2026']);
  assert.strictEqual(ev.emitidas.length, 0);
});

test('limite do MEI: nota que passaria do limite não sai sozinha, vira pergunta com aviso', async () => {
  const { dep, ev } = cenario({ tomadores: { acme: { ...ACME, mensal: { ativo: true, valor: '9.000,00', automatico: true } } }, hoje: new Date(2026, 9, 30), cfgExtra: { limiteAnual: 5000 } });
  await rotina(dep);
  assert.strictEqual(ev.emitidas.length, 0);
  assert.match(ev.perguntas[0].texto, /passa do limite do MEI/);
});

test('falha no portal: avisa, tenta de novo nas próximas rodadas e depois de 3 falhas passa a perguntar', async () => {
  let tentativas = 0;
  const { dep, ev } = cenario({
    tomadores: { acme: ACME }, hoje: new Date(2026, 9, 30),
    emitir: async () => { tentativas++; return { ok: false, motivo: 'portal fora do ar (HTTP 503)' }; },
  });
  for (let i = 0; i < MAX_FALHAS; i++) await rotina(dep);
  assert.strictEqual(tentativas, MAX_FALHAS);
  assert.ok(ev.avisos.every(a => a.titulo.includes('não consegui emitir') || a.titulo.includes('limite')));
  assert.match(ev.avisos.at(-1).texto, /Da próxima vez eu pergunto antes/);
  await rotina(dep);
  assert.strictEqual(tentativas, MAX_FALHAS, 'parou de tentar sozinho');
  assert.match(ev.perguntas[0].texto, /falhou 3 vezes/);
});

test('portal não responde na sincronização: não emite às cegas', async () => {
  const { dep, ev } = cenario({ tomadores: { acme: ACME }, hoje: new Date(2026, 9, 30), sincronizar: async () => { throw new Error('timeout'); } });
  await rotina(dep);
  assert.strictEqual(ev.emitidas.length, 0);
  assert.match(ev.avisos[0].texto, /Nada foi emitido/);
});

test('e-mail falhou: a nota continua emitida e o aviso explica como reenviar', async () => {
  const { dep, ev } = cenario({ tomadores: { acme: ACME }, hoje: new Date(2026, 9, 30), emailFalha: true });
  await rotina(dep);
  assert.strictEqual(ev.emitidas.length, 1);
  assert.match(ev.avisos.find(a => a.titulo.includes('emitida')).texto, /Não consegui mandar o e-mail \(senha de app recusada\).*nfse-mei email enviar/s);
});

test('DAS: lembra nos 5 dias antes do vencimento, uma vez por dia, até "Já paguei"', async () => {
  const { dep, ev } = cenario({ tomadores: {}, hoje: new Date(2026, 9, 14), respostas: ['Lembrar amanhã', 'Abrir o PGMEI', 'Já paguei'] });
  await rotina(dep); // 14/10: faltam 6 dias, ainda não
  assert.strictEqual(ev.perguntas.length, 0);
  for (const [dia, esperado] of [[15, 1], [15, 1], [16, 2], [19, 3], [20, 3]]) {
    dep.hoje = new Date(2026, 9, dia);
    await rotina(dep);
    assert.strictEqual(ev.perguntas.length, esperado, `dia ${dia}`);
  }
  assert.match(ev.perguntas[0].texto, /vence em 5 dias \(20\/10\/2026\)/);
  assert.deepStrictEqual(ev.urls, ['https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Identificacao']);
});

test('DAS: vencimento que cai no fim de semana passa para o próximo dia útil', async () => {
  const { dep, ev } = cenario({ tomadores: {}, hoje: new Date(2026, 8, 21) }); // 20/09/2026 é domingo
  await rotina(dep);
  assert.match(ev.perguntas[0].texto, /vence HOJE \(21\/09\/2026\)/);
});

test('DAS desligado no config: não lembra', async () => {
  const { dep, ev } = cenario({ tomadores: {}, hoje: new Date(2026, 9, 20), cfgExtra: { automacao: { das: false } } });
  await rotina(dep);
  assert.strictEqual(ev.perguntas.length, 0);
});

test('limite: avisa em 80% uma vez só, e de novo ao passar de 100%', async () => {
  const { dep, ev, cfg } = cenario({ tomadores: { acme: { ...ACME, mensal: undefined } }, hoje: new Date(2026, 5, 10), cfgExtra: { limiteAnual: 10000, automacao: { das: false } } });
  const nota = c => historico.registrar(cfg, { competencia: '05/06/2026', apelido: 'acme', tomador: ACME, centavos: c }, CHAVE(Math.floor(Math.random() * 90) + 10));
  nota(850000);
  await rotina(dep);
  await rotina(dep);
  assert.strictEqual(ev.avisos.filter(a => a.titulo.includes('limite')).length, 1);
  assert.match(ev.avisos[0].texto, /85% do limite/);
  nota(200000);
  await rotina(dep);
  assert.match(ev.avisos.at(-1).texto, /passou do limite/);
});
