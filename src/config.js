// Onde fica e como é o config.json de cada pessoa.
const fs = require('fs');
const os = require('os');
const path = require('path');

const PASTA_APP = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'nfse-mei');
const ARQUIVO_CONFIG = process.env.NFSE_MEI_CONFIG || path.join(PASTA_APP, 'config.json');
const PERFIL_CHROME = process.env.NFSE_MEI_PERFIL || path.join(PASTA_APP, 'perfil-chrome');

const AMBIENTES = {
  producao: 'https://www.nfse.gov.br',
  producaorestrita: 'https://www.producaorestrita.nfse.gov.br',
};

function expandirHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function carregarConfig() {
  if (!fs.existsSync(ARQUIVO_CONFIG)) {
    throw new Error(`Config não encontrado em ${ARQUIVO_CONFIG}. Rode: nfse-mei init`);
  }
  const cfg = JSON.parse(fs.readFileSync(ARQUIVO_CONFIG, 'utf8'));
  const faltando = ['servico', 'tomadores'].filter(k => !cfg[k]);
  if (faltando.length) throw new Error(`Config incompleto, faltando: ${faltando.join(', ')}`);
  cfg.pastaNotas = expandirHome(cfg.pastaNotas || '~/Documents/NFSe');
  cfg.ambiente = cfg.ambiente || 'producao';
  if (!AMBIENTES[cfg.ambiente]) throw new Error(`Ambiente inválido: ${cfg.ambiente}`);
  cfg.tributosAproximados = cfg.tributosAproximados ?? 3;
  return cfg;
}

function salvarConfig(cfg) {
  fs.mkdirSync(path.dirname(ARQUIVO_CONFIG), { recursive: true });
  fs.writeFileSync(ARQUIVO_CONFIG, JSON.stringify(cfg, null, 2) + '\n');
}

module.exports = { ARQUIVO_CONFIG, PERFIL_CHROME, AMBIENTES, carregarConfig, salvarConfig, expandirHome };
