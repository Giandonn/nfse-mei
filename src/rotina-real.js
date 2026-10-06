// Monta a rotina com as peças de verdade: portal, emissão (subprocesso `emitir --sim`), e-mail,
// notificações, log em arquivo e uma trava para nunca rodar duas rotinas ao mesmo tempo.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ARQUIVO_CONFIG, AMBIENTES, carregarConfig, salvarConfig } = require('./config');
const { hoje: hojeReal, formatarBR } = require('./datas');

const PASTA = path.dirname(ARQUIVO_CONFIG);
const ARQ_ESTADO = path.join(PASTA, 'estado.json');
const ARQ_LOG = path.join(PASTA, 'rotina.log');
const ARQ_TRAVA = path.join(PASTA, 'rotina.trava');
const SCRIPT = path.resolve(__dirname, '..', 'bin', 'nfse-mei.js');

function criarLog(eco) {
  return msg => {
    const linha = `${new Date().toISOString()}  ${msg}`;
    if (eco) console.log(msg);
    try {
      fs.mkdirSync(PASTA, { recursive: true });
      if (fs.existsSync(ARQ_LOG) && fs.statSync(ARQ_LOG).size > 512 * 1024) fs.renameSync(ARQ_LOG, `${ARQ_LOG}.1`);
      fs.appendFileSync(ARQ_LOG, linha + '\n');
    } catch { /* log nunca derruba a rotina */ }
  };
}

// Trava com validade: se uma rotina morreu no meio, a próxima assume depois de 2 horas.
function pegarTrava() {
  try {
    const fd = fs.openSync(ARQ_TRAVA, 'wx');
    fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}`);
    fs.closeSync(fd);
    return true;
  } catch {
    try {
      if (Date.now() - fs.statSync(ARQ_TRAVA).mtimeMs > 2 * 3600000) { fs.rmSync(ARQ_TRAVA, { force: true }); return pegarTrava(); }
    } catch { /* corrida com outra rotina */ }
    return false;
  }
}

// Roda `nfse-mei emitir ... --sim --sem-baixar` e devolve { ok, chave, teste, motivo }.
function emitirComoSubprocesso({ apelido, valor, competencia }, { teste, log }) {
  const args = [SCRIPT, 'emitir', '--tomador', apelido, '--valor', valor, '--competencia', competencia, '--sim', '--sem-baixar'];
  if (teste) args.push('--teste');
  log(`emitindo: ${apelido} R$ ${valor} competência ${competencia}${teste ? ' (TESTE)' : ''}`);
  return new Promise(resolve => {
    let saida = '';
    const p = spawn(process.execPath, args, { windowsHide: true, env: process.env });
    const relogio = setTimeout(() => p.kill(), 25 * 60000);
    p.stdout.on('data', d => { saida += d; });
    p.stderr.on('data', d => { saida += d; });
    p.on('close', codigo => {
      clearTimeout(relogio);
      for (const l of saida.split(/\r?\n/).filter(Boolean)) log(`  | ${l}`);
      const chave = /Chave:\s*(\d{50})/.exec(saida)?.[1];
      if (teste && /MODO TESTE/.test(saida) && codigo === 0) return resolve({ ok: true, teste: true });
      if (codigo === 0 && chave) return resolve({ ok: true, chave });
      const erro = /Erro:\s*(.+)/.exec(saida)?.[1] || `saiu com código ${codigo}`;
      resolve({ ok: false, chave, motivo: erro.slice(0, 160) });
    });
  });
}

async function sincronizarDoPortal(cfg, de, ate, log) {
  const portal = require('./portal');
  const { lerListaDoPortal, salvarPortal } = require('./historico');
  if (!require('./credencial').temCredencial()) throw new Error('sem senha guardada: a rotina não consegue entrar no portal (nfse-mei senha)');
  const { ctx, page } = await portal.abrirNavegador();
  try {
    await portal.garantirLogin(page, AMBIENTES[cfg.ambiente], log);
    const notas = await lerListaDoPortal(page, AMBIENTES[cfg.ambiente], de, ate, log);
    return salvarPortal(cfg, notas, de, ate);
  } finally {
    await ctx.close().catch(() => {});
  }
}

// Guarda o novo valor mensal de um cliente mexendo só nesse campo do config.json (o cfg em memória
// tem caminhos expandidos e padrões preenchidos, que não devem ir para o arquivo).
function guardarValorMensal(apelido, valor) {
  const cru = JSON.parse(fs.readFileSync(ARQUIVO_CONFIG, 'utf8'));
  if (!cru.tomadores?.[apelido]?.mensal) return;
  cru.tomadores[apelido].mensal.valor = valor;
  salvarConfig(cru);
}

async function executarRotina({ teste = false, eco = false } = {}) {
  const log = criarLog(eco);
  const notificar = require('./notificar');
  if (!pegarTrava()) { log('outra rotina já está rodando; saindo.'); return []; }
  try {
    let cfg;
    try { cfg = carregarConfig(); } catch (e) { log(`sem config: ${e.message}`); return []; }
    const { carregarEstado, salvarEstado, rotina } = require('./rotina');
    const estado = carregarEstado(ARQ_ESTADO);
    const hoje = hojeReal();
    log(`rotina ${formatarBR(hoje)}${teste ? ' (TESTE: nada é emitido)' : ''}`);
    const feito = await rotina({
      cfg, hoje, estado, log, notificar,
      historico: require('./historico'),
      painel: require('./painel'),
      sincronizar: comp => {
        const de = new Date(Number(comp.mes.slice(0, 4)), Number(comp.mes.slice(5)) - 1, 1);
        return sincronizarDoPortal(cfg, de, hoje, log);
      },
      emitir: dados => emitirComoSubprocesso(dados, { teste, log }),
      enviarEmail: async dados => {
        const { lerCredencial } = require('./credencial');
        const { enviarNota } = require('./email');
        const r = await enviarNota(cfg, lerCredencial('email').senha, dados);
        log(`e-mail enviado para ${r.para.join(', ')}: ${r.assunto}`);
      },
      guardarValorMensal,
      abrirUrl: url => require('./portal').abrirNoNavegadorPadrao(url),
    });
    salvarEstado(ARQ_ESTADO, estado);
    log(`fim: ${feito.length ? feito.map(f => f.acao + (f.apelido ? `(${f.apelido})` : '')).join(', ') : 'nada a fazer'}`);
    return feito;
  } catch (e) {
    log(`ERRO: ${e.stack || e.message}`);
    await notificar.avisar('nfse-mei: a rotina deu erro', `${e.message.split('\n')[0]}\nDetalhes em ${ARQ_LOG}`);
    throw e;
  } finally {
    fs.rmSync(ARQ_TRAVA, { force: true });
  }
}

module.exports = { executarRotina, sincronizarDoPortal, emitirComoSubprocesso, ARQ_LOG, ARQ_ESTADO };
