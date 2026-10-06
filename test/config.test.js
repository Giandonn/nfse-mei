// Cadastro pelo terminal (init e menu `config`), com respostas prontas num config temporário.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { cnpjValido } = require('../src/valores');

const CLI = path.join(__dirname, '..', 'bin', 'nfse-mei.js');

function rodar(pasta, args, respostas) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    input: respostas.join('\n') + '\n',
    encoding: 'utf8',
    // Plataforma sem cofre de senha simulada: o teste nunca mexe na senha de verdade.
    env: { ...process.env, NFSE_MEI_CONFIG: path.join(pasta, 'config.json'), NFSE_MEI_SEM_COFRE: '1' },
  });
  return { ...r, cfg: () => JSON.parse(fs.readFileSync(path.join(pasta, 'config.json'), 'utf8')) };
}

test('cnpjValido', () => {
  assert.strictEqual(cnpjValido('11.222.333/0001-81'), true);
  assert.strictEqual(cnpjValido('11222333000182'), false);
  assert.strictEqual(cnpjValido('11111111111111'), false);
  assert.strictEqual(cnpjValido('123'), false);
});

test('init de primeira vez e menu de clientes', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-mei-cfg-'));
  const init = rodar(pasta, ['init'], [
    '11222333000182', '11222333000181', '', // CNPJ errado, depois certo; pasta padrão
    'São Paulo/SP', '1.1.1', '01.01.01', '115022000', 'Análise e desenvolvimento de sistemas',
    'acme', '11222333000181', 'ACME TECNOLOGIA LTDA', 'nao-e-email', 'financeiro@acme.com.br', // e-mail inválido, depois válido
    's', '3.500,00', '32', '5', 's', // nota todo mês, R$ 3.500, dia 32 (inválido) e depois 5, automática
    'n',
  ]);
  assert.strictEqual(init.status, 0, init.stderr);
  assert.match(init.stdout, /CNPJ inválido/);
  assert.match(init.stdout, /formato 00\.00\.00/);
  let cfg = init.cfg();
  assert.strictEqual(cfg.prestadorCnpj, '11222333000181');
  assert.strictEqual(cfg.servico.codigoTributacaoNacional, '01.01.01');
  assert.deepStrictEqual(Object.keys(cfg.tomadores), ['acme']);
  assert.strictEqual(cfg.tomadorPadrao, 'acme');
  assert.match(init.stdout, /e-mail inválido/);
  assert.strictEqual(cfg.tomadores.acme.email, 'financeiro@acme.com.br');
  assert.match(init.stdout, /escolha um dia de 1 a 31/);
  assert.deepStrictEqual(cfg.tomadores.acme.mensal, { ativo: true, valor: '3.500,00', automatico: true, dia: 5 });

  // Menu: adiciona globex (sem e-mail, sem nota mensal), vira padrão, renomeia acme -> acme2
  // desligando a nota mensal, remove acme2.
  const menu = rodar(pasta, ['config'], [
    '3',
    'a', 'acme', 'globex', '11444777000161', 'GLOBEX LTDA', '', 'n', // "acme" já existe: pede de novo
    'p', 'globex',
    'e', '1', 'acme2', '', '', '', 'n',
    'r', 'acme2', 's',
    '0', '0',
  ]);
  assert.strictEqual(menu.status, 0, menu.stderr);
  assert.match(menu.stdout, /já existe um cliente "acme"/);
  cfg = menu.cfg();
  assert.deepStrictEqual(Object.keys(cfg.tomadores), ['globex']);
  assert.strictEqual(cfg.tomadorPadrao, 'globex');
  assert.strictEqual(cfg.servico.nbs, '115022000', 'o resto do config não muda');

  // init com config existente abre o menu em vez de apagar tudo.
  const deNovo = rodar(pasta, ['init'], ['0']);
  assert.match(deNovo.stdout, /configuração/);
  assert.deepStrictEqual(deNovo.cfg(), cfg);
});
