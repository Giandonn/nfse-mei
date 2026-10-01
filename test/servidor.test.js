// Painel no navegador: segurança do servidor local e as operações da API (com portal/senha/agenda simulados).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PASTA = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-mei-servidor-'));
process.env.NFSE_MEI_CONFIG = path.join(PASTA, 'config.json');
for (const m of ['config', 'servidor', 'cadastro', 'historico', 'painel', 'credencial', 'agenda']) delete require.cache[require.resolve(`../src/${m}`)];
const { criarServidor } = require('../src/servidor');
test.after(() => fs.rmSync(PASTA, { recursive: true, force: true }));

// Requisição crua, para poder forjar Host e Origin como um atacante faria.
function pedir(porta, { metodo = 'GET', caminho = '/', cabecalhos = {}, corpo } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: { Host: `127.0.0.1:${porta}`, ...cabecalhos } }, res => {
      let dados = '';
      res.on('data', d => { dados += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(dados); } catch { /* html */ } resolve({ status: res.statusCode, headers: res.headers, texto: dados, json }); });
    });
    req.on('error', reject);
    if (corpo) req.write(JSON.stringify(corpo));
    req.end();
  });
}

async function subir(extra = {}) {
  const chamadas = { emitir: [], agenda: [], senhas: [] };
  const senhas = { emissor: false, email: false };
  const srv = criarServidor({
    cred: {
      SUPORTADO: true,
      temCredencial: q => senhas[q],
      salvarCredencial: (usuario, q) => { chamadas.senhas.push([usuario, q]); senhas[q] = true; },
      apagarCredencial: q => { senhas[q] = false; },
    },
    agenda: { situacao: () => ({ ligada: chamadas.agenda.at(-1) === true }), ligar: () => { chamadas.agenda.push(true); return 'ligada'; }, desligar: () => { chamadas.agenda.push(false); return 'desligada'; } },
    emitir: async (dados, { teste }) => { chamadas.emitir.push({ ...dados, teste }); return teste ? { ok: true, teste: true } : { ok: true, chave: '3'.repeat(50) }; },
    sincronizar: async () => ({ notas: [] }),
    ...extra,
  });
  const { porta, url } = await srv.iniciar();
  const api = (metodo, caminho, corpo, cab = {}) => pedir(porta, { metodo, caminho, corpo, cabecalhos: { 'X-Nfse-Token': srv.token, 'Content-Type': 'application/json', ...cab } });
  return { srv, porta, url, api, chamadas };
}

test('segurança: só abre com o código, só responde ao próprio endereço, recusa outros sites', async () => {
  const { srv, porta, url, api } = await subir();
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]{48}$/);
    // Página sem código / com código errado.
    assert.strictEqual((await pedir(porta, { caminho: '/' })).status, 403);
    assert.strictEqual((await pedir(porta, { caminho: '/?t=errado' })).status, 403);
    const pagina = await pedir(porta, { caminho: `/?t=${srv.token}` });
    assert.strictEqual(pagina.status, 200);
    assert.match(pagina.headers['content-security-policy'], /script-src 'self'/);
    assert.match(pagina.headers['content-security-policy'], /frame-ancestors 'none'/);
    // API sem código, com código errado.
    assert.strictEqual((await pedir(porta, { caminho: '/api/estado' })).status, 403);
    assert.strictEqual((await api('GET', '/api/estado', null, { 'X-Nfse-Token': 'x'.repeat(48) })).status, 403);
    // Outro site tentando chamar (Origin diferente), mesmo com o código.
    assert.strictEqual((await api('GET', '/api/estado', null, { Origin: 'https://site-malicioso.com' })).status, 403);
    // DNS rebinding: nome de outro domínio apontando para 127.0.0.1.
    assert.strictEqual((await api('GET', '/api/estado', null, { Host: `malicioso.com:${porta}` })).status, 403);
    // Do jeito certo, funciona.
    assert.strictEqual((await api('GET', '/api/estado')).status, 200);
    assert.strictEqual((await api('GET', '/api/estado', null, { Origin: `http://127.0.0.1:${porta}` })).status, 200);
    // Escuta só no próprio computador.
    assert.strictEqual(srv.servidor.address().address, '127.0.0.1');
  } finally { await srv.parar(); }
});

test('cadastro inicial pelo painel, com validação', async () => {
  const { srv, api } = await subir();
  try {
    let r = await api('GET', '/api/estado');
    assert.strictEqual(r.json.cfg, null, 'sem cadastro ainda');
    r = await api('POST', '/api/cadastro-inicial', {
      prestador: { prestadorCnpj: '11222333000182', pastaNotas: PASTA },
      servico: { municipio: '', codigoTributacaoNacional: '1.1.1', nbs: '123', descricao: 'Dev' },
      cliente: { nome: 'ACME', cnpj: '11444777000161', apelido: 'com espaço' },
    });
    assert.strictEqual(r.status, 422);
    assert.deepStrictEqual(Object.keys(r.json.erros).sort(), ['apelido', 'codigoTributacaoNacional', 'municipio', 'nbs', 'prestadorCnpj']);
    r = await api('POST', '/api/cadastro-inicial', {
      prestador: { prestadorCnpj: '11.222.333/0001-81', pastaNotas: PASTA },
      servico: { municipio: 'São Paulo/SP', codigoTributacaoNacional: '01.01.01', nbs: '115022000', descricao: 'Dev' },
      cliente: { nome: 'ACME', cnpj: '11444777000161', apelido: 'acme' },
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const cfg = JSON.parse(fs.readFileSync(process.env.NFSE_MEI_CONFIG, 'utf8'));
    assert.strictEqual(cfg.prestadorCnpj, '11222333000181');
    assert.strictEqual(cfg.tomadorPadrao, 'acme');
    assert.strictEqual((await api('POST', '/api/cadastro-inicial', {})).status, 409, 'não sobrescreve um cadastro existente');
  } finally { await srv.parar(); }
});

test('clientes: ligar nota mensal automática, trocar e-mail, desligar, renomear, remover', async () => {
  const { srv, api } = await subir();
  try {
    let r = await api('POST', '/api/clientes', { apelidoAtual: 'acme', apelido: 'acme', cnpj: '11444777000161', nome: 'ACME', email: 'fin@acme.com', mensal: { ativo: true, valor: '3500', automatico: true } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    let estado = (await api('GET', '/api/estado')).json;
    assert.deepStrictEqual(estado.cfg.tomadores.acme.mensal, { ativo: true, valor: '3.500,00', automatico: true });
    assert.deepStrictEqual(estado.proximas.map(p => [p.apelido, p.automatico, p.email]), [['acme', true, 'fin@acme.com']]);

    // "Não quero mais que saia sozinha" + mudar o e-mail.
    r = await api('POST', '/api/clientes', { apelidoAtual: 'acme', apelido: 'acme', cnpj: '11444777000161', nome: 'ACME', email: 'contas@acme.com', mensal: { ativo: true, valor: '3500', automatico: false } });
    estado = (await api('GET', '/api/estado')).json;
    assert.strictEqual(estado.cfg.tomadores.acme.mensal.automatico, false);
    assert.strictEqual(estado.cfg.tomadores.acme.email, 'contas@acme.com');

    // Automático sem valor fixo não pode; e-mail inválido não pode.
    r = await api('POST', '/api/clientes', { apelidoAtual: 'acme', apelido: 'acme', cnpj: '11444777000161', nome: 'ACME', email: 'nao-e-email', mensal: { ativo: true, valor: '', automatico: true } });
    assert.strictEqual(r.status, 422);
    assert.deepStrictEqual(Object.keys(r.json.erros).sort(), ['email', 'valor']);

    // Segundo cliente, padrão, renomear, remover.
    await api('POST', '/api/clientes', { apelido: 'globex', cnpj: '11222333000181', nome: 'GLOBEX' });
    await api('POST', '/api/clientes/padrao', { apelido: 'globex' });
    await api('POST', '/api/clientes', { apelidoAtual: 'globex', apelido: 'glob', cnpj: '11222333000181', nome: 'GLOBEX' });
    estado = (await api('GET', '/api/estado')).json;
    assert.strictEqual(estado.cfg.tomadorPadrao, 'glob', 'renomear leva o padrão junto');
    await api('POST', '/api/clientes/remover', { apelido: 'glob' });
    estado = (await api('GET', '/api/estado')).json;
    assert.deepStrictEqual(Object.keys(estado.cfg.tomadores), ['acme']);
    assert.strictEqual(estado.cfg.tomadorPadrao, 'acme');
  } finally { await srv.parar(); }
});

test('automação, e-mail e senha: a senha nunca vem nem vai pela API', async () => {
  const { srv, api, chamadas } = await subir();
  try {
    await api('POST', '/api/agenda', { ligar: true });
    assert.strictEqual((await api('GET', '/api/estado')).json.agenda.ligada, true);
    await api('POST', '/api/agenda', { ligar: false });
    assert.deepStrictEqual(chamadas.agenda, [true, false]);

    await api('PUT', '/api/automacao', { das: false });
    assert.strictEqual((await api('GET', '/api/estado')).json.cfg.automacao.das, false);

    assert.strictEqual((await api('PUT', '/api/email', { remetente: 'ruim' })).status, 422);
    await api('PUT', '/api/email', { remetente: 'eu@gmail.com', nome: 'Fulano', copiaParaMim: false });

    let r = await api('POST', '/api/senha', { qual: 'email', senha: 'tentativa-de-mandar-senha' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(chamadas.senhas, [['eu@gmail.com', 'email']], 'a senha é pedida pela janela do sistema, não pelo corpo da requisição');
    const estado = (await api('GET', '/api/estado')).json;
    assert.strictEqual(estado.senhas.email, true);
    assert.ok(!JSON.stringify(estado).includes('tentativa-de-mandar-senha'));
    r = await api('POST', '/api/senha', { qual: 'email', apagar: true });
    assert.strictEqual((await api('GET', '/api/estado')).json.senhas.email, false);
  } finally { await srv.parar(); }
});

test('emitir: testar não emite; emitir de verdade exige digitar EMITIR', async () => {
  const { srv, api, chamadas } = await subir();
  try {
    let r = await api('POST', '/api/emitir', { apelido: 'acme', valor: '3.500,00', competencia: '30/10/2026', teste: true });
    assert.strictEqual(r.json.teste, true);
    assert.strictEqual(chamadas.emitir.at(-1).teste, true);
    r = await api('POST', '/api/emitir', { apelido: 'acme', valor: '3.500,00', competencia: '30/10/2026', teste: false });
    assert.strictEqual(r.status, 422);
    assert.ok(r.json.erros.confirmacao);
    assert.strictEqual(chamadas.emitir.length, 1, 'sem confirmação não chamou a emissão');
    r = await api('POST', '/api/emitir', { apelido: 'acme', valor: '3.500,00', competencia: '30/10/2026', teste: false, confirmacao: 'EMITIR' });
    assert.strictEqual(r.status, 200);
    assert.match(r.json.mensagem, /Nota emitida/);
    assert.deepStrictEqual(chamadas.emitir.at(-1), { apelido: 'acme', valor: '3.500,00', competencia: '30/10/2026', teste: false });
    r = await api('POST', '/api/emitir', { apelido: 'naoexiste', valor: 'abc', competencia: '31/02/2026', teste: true });
    assert.deepStrictEqual(Object.keys(r.json.erros).sort(), ['apelido', 'competencia', 'valor']);
  } finally { await srv.parar(); }
});

test('uma operação longa por vez', async () => {
  let liberar;
  const { srv, api } = await subir({ sincronizar: () => new Promise(res => { liberar = () => res({ notas: [] }); }) });
  try {
    const primeira = api('POST', '/api/sincronizar');
    await new Promise(r => setTimeout(r, 100));
    const segunda = await api('POST', '/api/emitir', { apelido: 'acme', valor: '1', competencia: '30/10/2026', teste: true });
    assert.strictEqual(segunda.status, 409);
    assert.match(segunda.json.erro, /Espere terminar/);
    liberar();
    assert.strictEqual((await primeira).status, 200);
  } finally { await srv.parar(); }
});

test('só pedidos com o código contam como atividade (sondar a porta não mantém o painel aberto)', async () => {
  const { srv, porta, api } = await subir();
  try {
    const antes = srv.ultimaAtividade();
    await new Promise(r => setTimeout(r, 30));
    await pedir(porta, { caminho: '/app.js' });
    await pedir(porta, { caminho: '/api/estado' });
    assert.strictEqual(srv.ultimaAtividade(), antes);
    await api('POST', '/api/ping');
    assert.ok(srv.ultimaAtividade() > antes);
  } finally { await srv.parar(); }
});
