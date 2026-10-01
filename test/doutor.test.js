// `nfse-mei doutor`: cada checagem e o resultado final, sem depender da máquina (Chrome, portal e senha simulados).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const d = require('../src/doutor');

const CLI = path.join(__dirname, '..', 'bin', 'nfse-mei.js');
const CFG_OK = {
  prestadorCnpj: '11222333000181',
  pastaNotas: os.tmpdir(),
  servico: { municipio: 'São Paulo/SP', codigoTributacaoNacional: '01.01.01', nbs: '115022000', descricao: 'Desenvolvimento' },
  tomadorPadrao: 'acme',
  tomadores: { acme: { cnpj: '11444777000161', nome: 'ACME' } },
};

test('Node: 20+ passa, 18 não', () => {
  assert.strictEqual(d.checarNode('20.11.0').ok, true);
  assert.strictEqual(d.checarNode('22.1.0').ok, true);
  const velho = d.checarNode('18.19.0');
  assert.strictEqual(velho.ok, false);
  assert.match(velho.dica, /nodejs\.org/);
});

test('Sistema: Windows e macOS guardam senha; Linux é aviso', () => {
  assert.strictEqual(d.checarSistema('win32').ok, true);
  assert.strictEqual(d.checarSistema('darwin').ok, true);
  assert.strictEqual(d.checarSistema('linux').ok, 'aviso');
});

test('Chrome: ausente vira dica de instalar', async () => {
  assert.strictEqual((await d.checarChrome(async () => '154.0')).ok, true);
  const sem = await d.checarChrome(async () => { throw new Error("Chromium distribution 'chrome' is not found at /x"); });
  assert.strictEqual(sem.ok, false);
  assert.match(sem.dica, /google\.com\/chrome/);
});

test('Cadastro: inexistente, quebrado, CNPJ inválido, sem clientes e ok', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-mei-doutor-'));
  const arq = path.join(pasta, 'config.json');
  const ler = () => JSON.parse(fs.readFileSync(arq, 'utf8'));

  let r = d.checarCadastro(arq, ler);
  assert.strictEqual(r.cfg, null);
  assert.match(r.itens[0].dica, /nfse-mei init/);

  fs.writeFileSync(arq, '{ quebrado');
  r = d.checarCadastro(arq, ler);
  assert.strictEqual(r.itens[0].ok, false);

  fs.writeFileSync(arq, JSON.stringify({ ...CFG_OK, prestadorCnpj: '11222333000182', tomadores: {} }));
  r = d.checarCadastro(arq, ler);
  assert.deepStrictEqual(r.itens.map(i => i.ok), [false, true, false]);
  assert.match(r.itens[2].detalhe, /nenhum/);

  fs.writeFileSync(arq, JSON.stringify({ ...CFG_OK, tomadores: { ruim: { cnpj: '123' } } }));
  assert.match(d.checarCadastro(arq, ler).itens[2].detalhe, /ruim/);

  fs.writeFileSync(arq, JSON.stringify(CFG_OK));
  r = d.checarCadastro(arq, ler);
  assert.deepStrictEqual(r.itens.map(i => i.ok), [true, true, true]);
});

test('Pasta das notas: pasta que ainda não existe, mas dá para criar, passa', () => {
  assert.strictEqual(d.checarPastaNotas(path.join(os.tmpdir(), 'nao-existe-ainda', 'NFSe')).ok, true);
});

test('Senha: guardada, não guardada e sistema sem cofre', () => {
  assert.strictEqual(d.checarSenha({ SUPORTADO: true, temCredencial: () => true }).ok, true);
  assert.strictEqual(d.checarSenha({ SUPORTADO: true, temCredencial: () => false }).ok, 'aviso');
  assert.strictEqual(d.checarSenha({ SUPORTADO: false }), null);
});

test('Portal: no ar, 503 e sem internet', async () => {
  const base = 'https://www.nfse.gov.br';
  assert.strictEqual((await d.checarPortal(base, async () => ({ ok: true, status: 200 }))).ok, true);
  const fora = await d.checarPortal(base, async () => ({ ok: false, status: 503 }));
  assert.strictEqual(fora.ok, 'aviso');
  assert.match(fora.detalhe, /503/);
  const semNet = await d.checarPortal(base, async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); });
  assert.match(semNet.detalhe, /ENOTFOUND/);
});

test('formatar: dica só aparece quando não está ok', () => {
  assert.strictEqual(d.formatar({ ok: true, titulo: 'X', dica: 'não mostra' }), '  ✓ X');
  assert.strictEqual(d.formatar({ ok: false, titulo: 'X', detalhe: 'y', dica: 'z' }), '  ✗ X: y\n      → z');
});

test('doutor completo: resultado e mensagem final', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-mei-doutor-'));
  const antes = process.env.NFSE_MEI_CONFIG;
  process.env.NFSE_MEI_CONFIG = path.join(pasta, 'config.json');
  // config.js lê a variável ao carregar: recarrega os módulos com o config temporário.
  for (const m of ['config', 'doutor']) delete require.cache[require.resolve(`../src/${m}`)];
  const doutor = require('../src/doutor').doutor;
  const saida = [];
  const opcoes = {
    log: l => saida.push(l),
    abrirChrome: async () => '154.0',
    buscar: async () => ({ ok: true, status: 200 }),
    cred: { SUPORTADO: true, temCredencial: () => false },
  };
  try {
    assert.strictEqual(await doutor(opcoes), false, 'sem cadastro não está pronto');
    assert.match(saida.join('\n'), /1 problema para resolver/);

    fs.writeFileSync(process.env.NFSE_MEI_CONFIG, JSON.stringify(CFG_OK));
    saida.length = 0;
    assert.strictEqual(await doutor(opcoes), true);
    assert.match(saida.join('\n'), /Tudo pronto \(\d avisos?\)/, 'senha não guardada é só aviso (no Linux o sistema também é aviso)');
    assert.match(saida.join('\n'), /! Senha do emissor: não guardada/);
  } finally {
    if (antes === undefined) delete process.env.NFSE_MEI_CONFIG; else process.env.NFSE_MEI_CONFIG = antes;
    for (const m of ['config', 'doutor']) delete require.cache[require.resolve(`../src/${m}`)];
  }
});

test('CLI: `nfse-mei doutor` sem cadastro sai com código 1', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-mei-doutor-'));
  const r = spawnSync(process.execPath, [CLI, 'doutor'], {
    encoding: 'utf8',
    env: { ...process.env, NFSE_MEI_CONFIG: path.join(pasta, 'config.json'), NFSE_MEI_SEM_COFRE: '1' },
    timeout: 60000,
  });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /Cadastro: ainda não feito/);
  assert.match(r.stdout, /nfse-mei init/);
});
