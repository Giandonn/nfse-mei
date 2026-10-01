// Histórico (CSV + cópia do portal), painel do limite e relatório da declaração anual.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const h = require('../src/historico');
const p = require('../src/painel');
const { formatarBR } = require('../src/datas');

const chave = n => `355030822112223330001810000000000${String(n).padStart(3, '0')}26106317551029`;
function cfgTemp(extra = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-mei-painel-'));
  return { pastaNotas: pasta, tomadores: { acme: { cnpj: '11444777000161', nome: 'ACME' } }, ...extra };
}
const nota = (cfg, comp, centavos, n) => h.registrar(cfg, { competencia: comp, apelido: 'acme', tomador: cfg.tomadores.acme, centavos }, chave(n));

test('número da nota sai da chave de acesso', () => {
  assert.strictEqual(h.numeroDaChave('35503082211222333000181000000000001126096317551029'), '11');
  assert.strictEqual(h.numeroDaChave('123'), '');
});

test('janelas de 30 dias cobrem o ano inteiro sem buracos nem sobreposição', () => {
  const j = h.janelasDe30Dias(new Date(2026, 0, 1), new Date(2026, 11, 31));
  assert.strictEqual(formatarBR(j[0][0]), '01/01/2026');
  assert.strictEqual(formatarBR(j.at(-1)[1]), '31/12/2026');
  for (let i = 1; i < j.length; i++) assert.strictEqual(j[i][0] - j[i - 1][1], 86400000);
  assert.ok(j.every(([a, b]) => (b - a) / 86400000 <= 29));
});

test('linha da tabela do portal vira nota (inclusive cancelada)', () => {
  const linha = {
    situacao: 'P107_NFSE_MEI_GERADA', valor: '1750,00', geracao: ' 30/09/2026 ', cnpj: '11.444.777/0001-61',
    nome: ' - ACME TECNOLOGIA LTDA ', competencia: ' 09/2026 ', situacaoTexto: 'NFS-e emitida',
    link: '/EmissorNacional/Notas/Visualizar/Index/35503082211222333000181000000000001126096317551029',
  };
  const n = h.notaDaLinha(linha);
  assert.deepStrictEqual({ ...n }, {
    chave: '35503082211222333000181000000000001126096317551029', numero: '11', geracao: '30/09/2026', mes: '2026-09',
    cnpj: '11444777000161', nome: 'ACME TECNOLOGIA LTDA', centavos: 175000, situacao: 'P107_NFSE_MEI_GERADA', cancelada: false, origem: 'portal',
  });
  assert.strictEqual(h.notaDaLinha({ ...linha, situacao: 'P107_NFSE_CANCELADA' }).cancelada, true);
  assert.strictEqual(h.notaDaLinha({ ...linha, link: undefined }), null);
});

test('juntar histórico e portal: sem duplicar, portal manda na situação, notas à mão entram', () => {
  const cfg = cfgTemp();
  nota(cfg, '30/09/2026', 350000, 10);
  h.salvarPortal(cfg, [
    { chave: chave(10), numero: '10', mes: '2026-09', cnpj: '11444777000161', nome: 'ACME', centavos: 350000, cancelada: true, origem: 'portal' },
    { chave: chave(9), numero: '9', mes: '2026-08', cnpj: '11444777000161', nome: 'ACME', centavos: 300000, cancelada: false, origem: 'portal' },
  ], new Date(2026, 0, 1), new Date(2026, 9, 1));
  const todas = h.todasAsNotas(cfg);
  assert.deepStrictEqual(todas.map(n => [n.numero, n.cancelada, n.apelido]), [['9', false, 'acme'], ['10', true, 'acme']]);
  assert.strictEqual(h.jaEmitida(cfg, '11.444.777/0001-61', '2026-09'), null, 'a de setembro foi cancelada');
  assert.strictEqual(h.jaEmitida(cfg, '11444777000161', '2026-08').numero, '9');
});

test('painel: total, porcentagem, projeção e mês em que estoura', () => {
  const cfg = cfgTemp();
  for (let m = 1; m <= 6; m++) nota(cfg, `${String(m).padStart(2, '0')}/${String(m).padStart(2, '0')}/2026`.replace(/^(\d\d)\/(\d\d)/, '28/$2'), 900000, m);
  const r = p.resumoDoAno(cfg, 2026, new Date(2026, 6, 10));
  assert.strictEqual(r.total, 5400000);
  assert.strictEqual(Math.round(r.pct), 67);
  assert.strictEqual(r.projecao, 10800000);
  assert.strictEqual(r.mesEstouro, 10, 'R$ 9 mil por mês: passa de R$ 81 mil em outubro');
  const texto = p.textoPainel(cfg, new Date(2026, 6, 10));
  assert.match(texto, /R\$ 54\.000,00 de R\$ 81\.000,00/);
  assert.match(texto, /passa do limite em out\/2026/);
  assert.match(texto, /Próximo DAS: vence 20\/07\/2026 \(em 10 dias\)/);
  assert.match(texto, /nfse-mei sincronizar/, 'sem sincronizar, avisa que só conta as notas do nfse-mei');
});

test('limite configurável (primeiro ano do MEI é proporcional)', () => {
  const cfg = cfgTemp({ limiteAnual: 20250 });
  nota(cfg, '30/10/2026', 1000000, 1);
  assert.strictEqual(Math.round(p.resumoDoAno(cfg, 2026, new Date(2026, 10, 1)).pct), 49);
});

test('relatório da declaração anual', () => {
  const cfg = cfgTemp();
  nota(cfg, '30/01/2025', 350000, 1);
  nota(cfg, '28/02/2025', 350000, 2);
  nota(cfg, '30/01/2026', 999900, 3); // outro ano: não entra
  const texto = p.textoRelatorio(cfg, 2025);
  assert.match(texto, /Receita bruta total com nota:\s+R\$ 7\.000,00\s+\(2 notas\)/);
  assert.match(texto, /jan\/2025\s+R\$ 3\.500,00/);
  assert.match(texto, /acme\s+R\$ 7\.000,00/);
  assert.match(texto, /dasnsimei\.app/);
});

test('próximo DAS: depois do dia 20 já mostra o do mês seguinte', () => {
  assert.strictEqual(formatarBR(p.proximoDas(new Date(2026, 9, 21)).vencimento), '23/11/2026'); // 20/11 é feriado (Consciência Negra)
  assert.strictEqual(formatarBR(p.proximoDas(new Date(2026, 11, 22)).vencimento), '20/01/2027');
  assert.strictEqual(p.proximoDas(new Date(2026, 9, 20)).dias, 0);
});
