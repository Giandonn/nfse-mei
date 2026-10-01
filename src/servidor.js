// Painel no navegador (`nfse-mei abrir`): um servidor que só existe enquanto a aba está aberta.
// Segurança (ele mexe com emissão de nota fiscal):
//  - escuta só em 127.0.0.1, porta aleatória; nada de fora do computador alcança;
//  - código aleatório por abertura: a página só abre com ele, e toda chamada da API manda ele num cabeçalho;
//  - confere Host (contra DNS rebinding) e Origin (outro site não consegue chamar a API);
//  - CSP sem nada externo; senhas nunca passam pelo navegador (só "guardada: sim/não").
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ARQUIVO_CONFIG, salvarConfig } = require('./config');
const { formatarValor, parseValor } = require('./valores');
const { hoje: hojeReal, formatarBR, ultimoDiaUtil, parseBR } = require('./datas');
const cadastro = require('./cadastro');

const PASTA_WEB = path.join(__dirname, 'web');
const ARQUIVOS = { '/app.js': 'text/javascript', '/estilo.css': 'text/css' };
const CABECALHOS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
};

function carregarCfg() {
  try { return require('./config').carregarConfig(); } catch { return null; }
}

// Tudo que a página precisa para desenhar as telas (sem senhas).
function montarEstado(dep) {
  const cfg = carregarCfg();
  const cred = dep.cred;
  const base = {
    versao: require('../package.json').version,
    plataforma: process.platform,
    arquivoConfig: ARQUIVO_CONFIG,
    cofre: cred.SUPORTADO,
    senhas: { emissor: cred.SUPORTADO && cred.temCredencial('emissor'), email: cred.SUPORTADO && cred.temCredencial('email') },
    agenda: dep.agenda.situacao(),
  };
  if (!cfg) return { ...base, cfg: null };
  const hoje = hojeReal();
  const painel = require('./painel');
  const historico = require('./historico');
  const resumo = painel.resumoDoAno(cfg, hoje.getFullYear(), hoje);
  const das = painel.proximoDas(hoje);
  const proximaData = ultimoDiaUtil(hoje.getFullYear(), hoje.getMonth() + 1);
  const mesAlvo = require('./datas').iso(proximaData).slice(0, 7);
  const proximas = Object.entries(cfg.tomadores).filter(([, t]) => t.mensal?.ativo).map(([apelido, t]) => {
    const feita = historico.jaEmitida(cfg, t.cnpj, mesAlvo);
    return {
      apelido, nome: t.nome || apelido, valor: t.mensal.valor, automatico: Boolean(t.mensal.automatico && t.mensal.valor),
      data: formatarBR(proximaData), email: t.email || '', feita: feita ? feita.numero : null,
    };
  });
  const notas = historico.todasAsNotas(cfg).slice(-24).reverse().map(n => ({
    numero: n.numero, mes: n.mes, cliente: cfg.tomadores[n.apelido]?.nome || n.nome || n.apelido || n.cnpj,
    valor: formatarValor(n.centavos), cancelada: n.cancelada, chave: n.chave,
  }));
  let log = [];
  try { log = fs.readFileSync(path.join(path.dirname(ARQUIVO_CONFIG), 'rotina.log'), 'utf8').trim().split('\n').slice(-30); } catch { /* sem log */ }
  return {
    ...base, cfg,
    resumo: { total: formatarValor(resumo.total), limite: formatarValor(resumo.limite), pct: resumo.pct, restante: formatarValor(Math.max(0, resumo.restante)),
      projecao: formatarValor(resumo.projecao), mesEstouro: resumo.mesEstouro, porMes: resumo.porMes.map(c => c / 100), ano: resumo.ano, sincronizadoEm: resumo.sincronizadoEm },
    das: { vencimento: formatarBR(das.vencimento), dias: das.dias },
    proximas, notas, log,
  };
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let corpo = '';
    req.on('data', d => { corpo += d; if (corpo.length > 64 * 1024) { reject(new Error('corpo grande demais')); req.destroy(); } });
    req.on('end', () => { try { resolve(corpo ? JSON.parse(corpo) : {}); } catch { reject(new Error('JSON inválido')); } });
    req.on('error', reject);
  });
}

function criarServidor(dep = {}) {
  dep = {
    cred: require('./credencial'),
    agenda: require('./agenda'),
    log: () => {},
    ...dep,
  };
  const token = dep.token || crypto.randomBytes(24).toString('hex');
  let porta;
  let ultimaAtividade = Date.now();
  let ocupado = null; // operação longa em andamento (só uma por vez)

  const responder = (res, status, dados) => {
    res.writeHead(status, { ...CABECALHOS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(dados));
  };
  const tokenOk = valor => {
    const a = Buffer.from(String(valor || ''));
    const b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const salvar = cfg => salvarConfig(cfg);
  const exigirCfg = () => {
    const cfg = carregarCfg();
    if (!cfg) throw Object.assign(new Error('Cadastro ainda não feito.'), { status: 409 });
    return cfg;
  };
  // Operações longas (portal, e-mail): uma de cada vez.
  const longa = async (nome, fn) => {
    if (ocupado) throw Object.assign(new Error(`Espere terminar: ${ocupado}`), { status: 409 });
    ocupado = nome;
    try { return await fn(); } finally { ocupado = null; ultimaAtividade = Date.now(); }
  };

  const rotas = {
    'GET /api/estado': () => montarEstado(dep),
    'POST /api/ping': () => ({ ok: true, ocupado }),

    'POST /api/cadastro-inicial': async body => {
      if (carregarCfg()) throw Object.assign(new Error('Já existe um cadastro.'), { status: 409 });
      const r = cadastro.cadastroInicial(body);
      if (r.erros) return r;
      salvar(r.cfg);
      return { ok: true };
    },
    'PUT /api/meus-dados': async body => { const cfg = exigirCfg(); const r = cadastro.aplicarPrestador(cfg, body); if (r.ok) salvar(cfg); return r; },
    'PUT /api/servico': async body => { const cfg = exigirCfg(); const r = cadastro.aplicarServico(cfg, body); if (r.ok) salvar(cfg); return r; },
    'POST /api/clientes': async body => {
      const cfg = exigirCfg();
      const r = cadastro.aplicarCliente(cfg, body.apelidoAtual || '', body);
      if (r.ok) salvar(cfg);
      return r;
    },
    'POST /api/clientes/remover': async body => { const cfg = exigirCfg(); const r = cadastro.removerCliente(cfg, body.apelido); if (r.ok) salvar(cfg); return r; },
    'POST /api/clientes/padrao': async body => {
      const cfg = exigirCfg();
      if (!cfg.tomadores[body.apelido]) return { erros: { apelido: 'cliente não encontrado' } };
      cfg.tomadorPadrao = body.apelido; salvar(cfg); return { ok: true };
    },
    'PUT /api/automacao': async body => { const cfg = exigirCfg(); cfg.automacao = { ...cfg.automacao, das: body.das !== false }; salvar(cfg); return { ok: true }; },
    'POST /api/agenda': async body => {
      exigirCfg();
      const msg = body.ligar ? dep.agenda.ligar() : dep.agenda.desligar();
      return { ok: true, mensagem: msg };
    },
    'PUT /api/email': async body => { const cfg = exigirCfg(); const r = cadastro.aplicarEmail(cfg, body); if (r.ok) salvar(cfg); return r; },

    // A senha é digitada numa janela do sistema (Windows) ou no terminal (macOS), nunca na página.
    'POST /api/senha': async body => {
      const cfg = exigirCfg();
      const qual = body.qual === 'email' ? 'email' : 'emissor';
      if (!dep.cred.SUPORTADO) throw Object.assign(new Error('Guardar senha não é suportado neste sistema.'), { status: 400 });
      const usuario = qual === 'email' ? cfg.email?.remetente : cfg.prestadorCnpj;
      if (!usuario) throw Object.assign(new Error('Configure o e-mail remetente antes.'), { status: 400 });
      if (body.apagar) { dep.cred.apagarCredencial(qual); return { ok: true }; }
      return longa('guardando a senha', async () => {
        try { dep.cred.salvarCredencial(usuario, qual); } catch { return { erros: { senha: 'A janela foi fechada sem guardar.' } }; }
        if (qual === 'email' && dep.testarEmail) {
          try { await dep.testarEmail(cfg); } catch (e) { return { ok: true, aviso: `Senha guardada, mas o login no e-mail falhou: ${e.message.split('\n')[0]}` }; }
        }
        return { ok: true };
      });
    },
    'POST /api/email/teste': async () => longa('mandando o e-mail de teste', async () => {
      const cfg = exigirCfg();
      if (!cfg.email?.remetente) throw Object.assign(new Error('Configure o e-mail antes.'), { status: 400 });
      const para = await dep.emailTeste(cfg);
      return { ok: true, mensagem: `Exemplo enviado para ${para}.` };
    }),
    'POST /api/sincronizar': async () => longa('lendo as notas do portal', async () => {
      const cfg = exigirCfg();
      const hoje = hojeReal();
      const dados = await dep.sincronizar(cfg, new Date(hoje.getFullYear(), 0, 1), hoje);
      return { ok: true, mensagem: `${dados.notas.filter(n => n.mes.startsWith(String(hoje.getFullYear()))).length} notas de ${hoje.getFullYear()} lidas do portal.` };
    }),
    // Testar = preencher e conferir tudo no portal, sem emitir. Emitir = de verdade (exige confirmação escrita).
    'POST /api/emitir': async body => {
      const cfg = exigirCfg();
      const t = cfg.tomadores[body.apelido];
      const erros = {};
      if (!t) erros.apelido = 'escolha o cliente';
      let centavos;
      try { centavos = parseValor(body.valor); } catch { erros.valor = 'valor inválido'; }
      try { parseBR(body.competencia); } catch { erros.competencia = 'data inválida (DD/MM/AAAA)'; }
      if (Object.keys(erros).length) return { erros };
      const teste = body.teste !== false;
      if (!teste && body.confirmacao !== 'EMITIR') return { erros: { confirmacao: 'digite EMITIR para confirmar' } };
      return longa(teste ? 'testando a emissão' : 'emitindo a nota', async () => {
        const r = await dep.emitir({ apelido: body.apelido, valor: formatarValor(centavos), competencia: body.competencia }, { teste });
        if (!r.ok) return { ok: false, mensagem: r.motivo };
        if (teste) return { ok: true, teste: true, mensagem: 'Tudo preenchido e conferido no portal. Nada foi emitido.' };
        let mensagem = `Nota emitida! Chave ${r.chave}.`;
        if (body.enviarEmail && t.email && cfg.email?.remetente) {
          try { await dep.enviarNota(cfg, body.apelido, r.chave, centavos, body.competencia); mensagem += ` Enviada para ${t.email}.`; } catch (e) { mensagem += ` O e-mail falhou: ${e.message}`; }
        }
        return { ok: true, chave: r.chave, mensagem };
      });
    },
  };

  const servidor = http.createServer(async (req, res) => {
    const host = req.headers.host || '';
    if (host !== `127.0.0.1:${porta}` && host !== `localhost:${porta}`) return responder(res, 403, { erro: 'host não permitido' });
    const origem = req.headers.origin;
    if (origem && origem !== `http://${host}`) return responder(res, 403, { erro: 'origem não permitida' });
    const url = new URL(req.url, `http://${host}`);

    if (req.method === 'GET' && ARQUIVOS[url.pathname]) {
      res.writeHead(200, { ...CABECALHOS, 'Content-Type': `${ARQUIVOS[url.pathname]}; charset=utf-8` });
      return res.end(fs.readFileSync(path.join(PASTA_WEB, url.pathname.slice(1))));
    }
    if (req.method === 'GET' && url.pathname === '/') {
      if (!tokenOk(url.searchParams.get('t'))) return responder(res, 403, { erro: 'abra pelo comando nfse-mei abrir' });
      ultimaAtividade = Date.now();
      res.writeHead(200, { ...CABECALHOS, 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(PASTA_WEB, 'index.html')));
    }
    const rota = rotas[`${req.method} ${url.pathname}`];
    if (!rota) return responder(res, 404, { erro: 'não encontrado' });
    if (!tokenOk(req.headers['x-nfse-token'])) return responder(res, 403, { erro: 'código inválido' });
    // Só quem tem o código mantém o painel vivo (sondar a porta não segura ele aberto).
    ultimaAtividade = Date.now();
    try {
      const body = req.method === 'GET' ? {} : await lerCorpo(req);
      const r = await rota(body);
      responder(res, r?.erros ? 422 : 200, r);
    } catch (e) {
      dep.log(`painel: ${req.method} ${url.pathname}: ${e.message}`);
      responder(res, e.status || 500, { erro: e.message.split('\n')[0] });
    } finally {
      ultimaAtividade = Date.now();
    }
  });

  return {
    token,
    servidor,
    ultimaAtividade: () => ultimaAtividade,
    iniciar: () => new Promise((resolve, reject) => {
      servidor.once('error', reject);
      servidor.listen(dep.porta || 0, '127.0.0.1', () => {
        porta = servidor.address().port;
        resolve({ porta, url: `http://127.0.0.1:${porta}/?t=${token}` });
      });
    }),
    parar: () => new Promise(resolve => servidor.close(() => resolve())),
  };
}

module.exports = { criarServidor, montarEstado };
