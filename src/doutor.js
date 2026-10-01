// `nfse-mei doutor`: confere se está tudo pronto para emitir e diz o que fazer quando não está.
// Cada checagem devolve { ok: true | false | 'aviso', titulo, detalhe, dica }.
const fs = require('fs');
const path = require('path');
const { ARQUIVO_CONFIG, AMBIENTES, carregarConfig } = require('./config');
const { cnpjValido, formatarCnpj } = require('./valores');

const NODE_MINIMO = 20;

function checarNode(versao = process.versions.node) {
  const maior = Number(versao.split('.')[0]);
  return maior >= NODE_MINIMO
    ? { ok: true, titulo: `Node.js ${versao}` }
    : { ok: false, titulo: `Node.js ${versao}`, detalhe: `precisa ser ${NODE_MINIMO} ou mais novo`, dica: 'Instale a versão LTS em https://nodejs.org' };
}

function checarSistema(plataforma = process.platform) {
  const nomes = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  const nome = nomes[plataforma] || plataforma;
  return ['win32', 'darwin'].includes(plataforma)
    ? { ok: true, titulo: `Sistema: ${nome}` }
    : { ok: 'aviso', titulo: `Sistema: ${nome}`, detalhe: 'não dá para guardar a senha; o login fica manual', dica: 'Rode o emitir com --ver e entre na janela do Chrome' };
}

async function checarChrome(abrir) {
  try {
    const versao = await abrir();
    return { ok: true, titulo: `Google Chrome ${versao}` };
  } catch (e) {
    return {
      ok: false, titulo: 'Google Chrome', detalhe: 'não consegui abrir',
      dica: /executable doesn't exist|not found|distribution/i.test(e.message)
        ? 'Instale o Google Chrome: https://www.google.com/chrome/'
        : `Erro do Chrome: ${e.message.split('\n')[0]}`,
    };
  }
}

// Abre o Chrome invisível e fecha na hora, só para saber se ele existe e funciona.
async function abrirChromeDeVerdade() {
  const { chromium } = require('playwright-core');
  const navegador = await chromium.launch({ channel: 'chrome', headless: true });
  try { return navegador.version(); } finally { await navegador.close(); }
}

// Devolve as checagens do cadastro e o config (ou null, se não deu para ler).
function checarCadastro(arquivo = ARQUIVO_CONFIG, ler = carregarConfig) {
  if (!fs.existsSync(arquivo)) {
    return { cfg: null, itens: [{ ok: false, titulo: 'Cadastro', detalhe: 'ainda não feito', dica: 'Rode: nfse-mei init' }] };
  }
  let cfg;
  try { cfg = ler(); } catch (e) {
    return { cfg: null, itens: [{ ok: false, titulo: 'Cadastro', detalhe: e.message, dica: 'Rode: nfse-mei config (ou apague o arquivo e rode nfse-mei init)' }] };
  }
  const itens = [];
  itens.push(cnpjValido(cfg.prestadorCnpj)
    ? { ok: true, titulo: `Seu CNPJ: ${formatarCnpj(cfg.prestadorCnpj)}` }
    : { ok: false, titulo: 'Seu CNPJ', detalhe: `"${cfg.prestadorCnpj || ''}" não é um CNPJ válido`, dica: 'nfse-mei config → 1) Meus dados' });
  const s = cfg.servico || {};
  const faltaServico = ['municipio', 'codigoTributacaoNacional', 'nbs', 'descricao'].filter(k => !s[k]);
  itens.push(faltaServico.length
    ? { ok: false, titulo: 'Serviço', detalhe: `faltando: ${faltaServico.join(', ')}`, dica: 'nfse-mei config → 2) Serviço' }
    : { ok: true, titulo: `Serviço: ${s.codigoTributacaoNacional} / NBS ${s.nbs} / ${s.municipio}` });
  const clientes = Object.entries(cfg.tomadores || {});
  const invalidos = clientes.filter(([, t]) => !cnpjValido(t.cnpj)).map(([a]) => a);
  if (!clientes.length) itens.push({ ok: false, titulo: 'Clientes', detalhe: 'nenhum cadastrado', dica: 'nfse-mei config → 3) Clientes → a) adicionar' });
  else if (invalidos.length) itens.push({ ok: false, titulo: 'Clientes', detalhe: `CNPJ inválido em: ${invalidos.join(', ')}`, dica: 'nfse-mei config → 3) Clientes → e) editar' });
  else itens.push({ ok: true, titulo: `Clientes: ${clientes.length} (padrão: ${cfg.tomadorPadrao || clientes[0][0]})` });
  return { cfg, itens };
}

function checarPastaNotas(pasta) {
  // Sobe até a primeira pasta que existe e vê se dá para escrever nela.
  let p = path.resolve(pasta);
  while (!fs.existsSync(p) && path.dirname(p) !== p) p = path.dirname(p);
  try {
    fs.accessSync(p, fs.constants.W_OK);
    return { ok: true, titulo: `Pasta das notas: ${pasta}` };
  } catch {
    return { ok: false, titulo: `Pasta das notas: ${pasta}`, detalhe: 'sem permissão de escrita', dica: 'nfse-mei config → 1) Meus dados, e escolha outra pasta' };
  }
}

function checarSenha(cred) {
  if (!cred.SUPORTADO) return null;
  return cred.temCredencial()
    ? { ok: true, titulo: 'Senha do emissor: guardada (login automático)' }
    : { ok: 'aviso', titulo: 'Senha do emissor', detalhe: 'não guardada, o login fica manual', dica: 'Rode: nfse-mei senha' };
}

async function checarPortal(base, buscar = fetch) {
  const url = `${base}/EmissorNacional/Login`;
  try {
    const r = await buscar(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
    if (r.ok) return { ok: true, titulo: `Portal no ar (${new URL(base).host})` };
    return { ok: 'aviso', titulo: 'Portal', detalhe: `respondeu HTTP ${r.status}`, dica: 'Instabilidade do governo (comum no fim do mês). Tente mais tarde' };
  } catch (e) {
    return { ok: 'aviso', titulo: 'Portal', detalhe: `sem resposta (${e.cause?.code || e.name})`, dica: 'Confira sua internet; se estiver ok, o portal está fora do ar' };
  }
}

const SIMBOLO = { true: '✓', false: '✗', aviso: '!' };

function formatar(item) {
  let linha = `  ${SIMBOLO[item.ok]} ${item.titulo}`;
  if (item.detalhe) linha += `: ${item.detalhe}`;
  if (item.dica && item.ok !== true) linha += `\n      → ${item.dica}`;
  return linha;
}

// Roda tudo e imprime conforme vai checando. Devolve true se não houve nenhum ✗.
async function doutor({ log = console.log, abrirChrome = abrirChromeDeVerdade, buscar = fetch, cred = require('./credencial') } = {}) {
  log('nfse-mei doutor: conferindo se está tudo pronto para emitir\n');
  const itens = [];
  const mostrar = item => { if (item) { itens.push(item); log(formatar(item)); } };
  mostrar(checarNode());
  mostrar(checarSistema());
  mostrar(await checarChrome(abrirChrome));
  const { cfg, itens: cadastro } = checarCadastro();
  cadastro.forEach(mostrar);
  if (cfg) mostrar(checarPastaNotas(cfg.pastaNotas));
  mostrar(checarSenha(cred));
  mostrar(await checarPortal(AMBIENTES[cfg?.ambiente || 'producao'], buscar));
  const erros = itens.filter(i => i.ok === false).length;
  const avisos = itens.filter(i => i.ok === 'aviso').length;
  log(erros
    ? `\n${erros} problema${erros > 1 ? 's' : ''} para resolver antes de emitir (veja as setas →).`
    : `\nTudo pronto${avisos ? ` (${avisos} aviso${avisos > 1 ? 's' : ''})` : ''}. Próximo passo: nfse-mei emitir --teste`);
  return erros === 0;
}

module.exports = { doutor, checarNode, checarSistema, checarChrome, checarCadastro, checarPastaNotas, checarSenha, checarPortal, formatar };
