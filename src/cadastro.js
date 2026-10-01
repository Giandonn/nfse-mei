// Regras do cadastro usadas pelo painel: validam e aplicam mudanças no config.
// Cada função devolve { erros } (campo -> mensagem) ou aplica no cfg e devolve { ok: true }.
const { cnpjValido, soDigitos, parseValor, formatarValor } = require('./valores');
const { emailValido, emailsValidos } = require('./email');

const texto = v => String(v ?? '').trim();

function validarPrestador(d) {
  const erros = {};
  if (!cnpjValido(d.prestadorCnpj)) erros.prestadorCnpj = 'CNPJ inválido (confira os 14 números)';
  if (!texto(d.pastaNotas)) erros.pastaNotas = 'informe a pasta';
  return erros;
}

function validarServico(s) {
  const erros = {};
  if (!texto(s.municipio)) erros.municipio = 'obrigatório (como aparece no portal, ex: São Paulo/SP)';
  if (!/^\d{2}\.\d{2}\.\d{2}$/.test(texto(s.codigoTributacaoNacional))) erros.codigoTributacaoNacional = 'use o formato 00.00.00';
  if (soDigitos(s.nbs).length !== 9) erros.nbs = 'a NBS tem 9 números';
  if (!texto(s.descricao)) erros.descricao = 'obrigatório';
  return erros;
}

function validarCliente(cfg, apelidoAtual, c) {
  const erros = {};
  const apelido = texto(c.apelido).toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(apelido)) erros.apelido = 'use só letras, números, - ou _ (sem espaço)';
  else if (apelido !== apelidoAtual && cfg.tomadores?.[apelido]) erros.apelido = `já existe um cliente "${apelido}"`;
  if (!cnpjValido(c.cnpj)) erros.cnpj = 'CNPJ inválido (confira os 14 números)';
  if (texto(c.email) && !emailsValidos(c.email)) erros.email = 'e-mail inválido (vários: separe por vírgula)';
  if (c.mensal?.ativo && texto(c.mensal.valor)) {
    try { if (parseValor(c.mensal.valor) <= 0) throw new Error(); } catch { erros.valor = 'valor inválido (ex: 3500 ou 3.500,00)'; }
  }
  if (c.mensal?.automatico && !texto(c.mensal?.valor)) erros.valor = 'para emitir sozinho, informe o valor fixo';
  return erros;
}

const temErro = e => Object.keys(e).length > 0;

function aplicarPrestador(cfg, d) {
  const erros = validarPrestador(d);
  if (temErro(erros)) return { erros };
  cfg.prestadorCnpj = soDigitos(d.prestadorCnpj);
  cfg.pastaNotas = texto(d.pastaNotas);
  cfg.ambiente = cfg.ambiente || 'producao';
  return { ok: true };
}

function aplicarServico(cfg, s) {
  const erros = validarServico(s);
  if (temErro(erros)) return { erros };
  cfg.servico = {
    municipio: texto(s.municipio), codigoTributacaoNacional: texto(s.codigoTributacaoNacional),
    nbs: soDigitos(s.nbs), descricao: texto(s.descricao),
  };
  cfg.tributosAproximados = cfg.tributosAproximados ?? 3;
  return { ok: true };
}

// Cria (apelidoAtual vazio) ou edita/renomeia um cliente.
function aplicarCliente(cfg, apelidoAtual, c) {
  cfg.tomadores = cfg.tomadores || {};
  if (apelidoAtual && !cfg.tomadores[apelidoAtual]) return { erros: { apelido: 'cliente não encontrado' } };
  const erros = validarCliente(cfg, apelidoAtual, c);
  if (temErro(erros)) return { erros };
  const apelido = texto(c.apelido).toLowerCase();
  const novo = { cnpj: soDigitos(c.cnpj), nome: texto(c.nome) };
  if (texto(c.email)) novo.email = texto(c.email);
  if (c.mensal?.ativo) {
    const valor = texto(c.mensal.valor);
    novo.mensal = { ativo: true, valor: valor ? formatarValor(parseValor(valor)) : '', automatico: Boolean(c.mensal.automatico && valor) };
  }
  if (apelidoAtual && apelidoAtual !== apelido) {
    delete cfg.tomadores[apelidoAtual];
    if (cfg.tomadorPadrao === apelidoAtual) cfg.tomadorPadrao = apelido;
  }
  cfg.tomadores[apelido] = novo;
  cfg.tomadorPadrao = cfg.tomadorPadrao || apelido;
  return { ok: true, apelido };
}

function removerCliente(cfg, apelido) {
  if (!cfg.tomadores?.[apelido]) return { erros: { apelido: 'cliente não encontrado' } };
  delete cfg.tomadores[apelido];
  if (cfg.tomadorPadrao === apelido) cfg.tomadorPadrao = Object.keys(cfg.tomadores)[0];
  return { ok: true };
}

function aplicarEmail(cfg, e) {
  const erros = {};
  if (!emailValido(e.remetente)) erros.remetente = 'e-mail inválido';
  if (temErro(erros)) return { erros };
  cfg.email = { ...cfg.email, remetente: texto(e.remetente), nome: texto(e.nome), copiaParaMim: e.copiaParaMim !== false };
  return { ok: true };
}

// Primeiro cadastro de uma vez: meus dados + serviço + um cliente.
function cadastroInicial(d) {
  const cfg = { tomadores: {} };
  const erros = { ...validarPrestador(d.prestador || {}), ...validarServico(d.servico || {}), ...validarCliente(cfg, '', d.cliente || {}) };
  if (temErro(erros)) return { erros };
  aplicarPrestador(cfg, d.prestador);
  aplicarServico(cfg, d.servico);
  aplicarCliente(cfg, '', d.cliente);
  return { ok: true, cfg };
}

module.exports = { validarPrestador, validarServico, validarCliente, aplicarPrestador, aplicarServico, aplicarCliente, removerCliente, aplicarEmail, cadastroInicial };
