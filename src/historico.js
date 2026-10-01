// Notas já emitidas: o historico.csv (notas do nfse-mei) + a cópia da lista "Notas emitidas" do
// portal (notas-portal.json, feita pelo `nfse-mei sincronizar`), que inclui as notas feitas à mão
// e diz quais foram canceladas. É a base do painel, do relatório e da rotina (que nunca emite duas vezes).
const fs = require('fs');
const path = require('path');
const { parseValor, soDigitos } = require('./valores');
const { parseBR, formatarBR, iso } = require('./datas');

const arquivoHistorico = cfg => path.join(cfg.pastaNotas, 'historico.csv');
const arquivoPortal = cfg => path.join(cfg.pastaNotas, 'notas-portal.json');
const CABECALHO = 'emitida_em;competencia;tomador;cnpj;valor;chave\n';

// Chave de acesso (50 dígitos): município(7) + ambiente(1) + tipo(1) + CNPJ(14) + número(13) + AAMM(4) + código(10).
function numeroDaChave(chave) {
  const d = soDigitos(chave);
  return d.length === 50 ? String(Number(d.slice(23, 36))) : '';
}

function registrar(cfg, nota, chave, emitidaEm = new Date()) {
  const arq = arquivoHistorico(cfg);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  if (!fs.existsSync(arq)) fs.writeFileSync(arq, CABECALHO);
  const { formatarValor } = require('./valores');
  fs.appendFileSync(arq, `${emitidaEm.toISOString()};${nota.competencia};${nota.apelido};${soDigitos(nota.tomador.cnpj)};${formatarValor(nota.centavos)};${chave}\n`);
}

function lerHistorico(cfg) {
  const arq = arquivoHistorico(cfg);
  if (!fs.existsSync(arq)) return [];
  return fs.readFileSync(arq, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(l => {
    const [emitidaEm, competencia, apelido, cnpj, valor, chave] = l.split(';');
    return {
      chave, apelido, cnpj, centavos: parseValor(valor), emitidaEm,
      mes: iso(parseBR(competencia)).slice(0, 7), // AAAA-MM da competência
      numero: numeroDaChave(chave), origem: 'nfse-mei', cancelada: false,
    };
  });
}

function lerPortal(cfg) {
  try { return JSON.parse(fs.readFileSync(arquivoPortal(cfg), 'utf8')); } catch { return null; }
}

// Junta as duas fontes por chave. O portal manda na situação (cancelada) e traz as notas feitas à mão.
function todasAsNotas(cfg) {
  const porChave = new Map();
  for (const n of lerHistorico(cfg)) porChave.set(n.chave, n);
  const portal = lerPortal(cfg);
  for (const n of portal?.notas || []) {
    const antes = porChave.get(n.chave);
    porChave.set(n.chave, { ...antes, ...n, apelido: antes?.apelido || apelidoDoCnpj(cfg, n.cnpj) || n.nome });
  }
  return [...porChave.values()].sort((a, b) => a.mes.localeCompare(b.mes) || a.numero - b.numero);
}

const apelidoDoCnpj = (cfg, cnpj) => Object.entries(cfg.tomadores || {}).find(([, t]) => soDigitos(t.cnpj) === soDigitos(cnpj))?.[0];

// Já existe nota válida (não cancelada) para este cliente nesta competência (AAAA-MM)?
function jaEmitida(cfg, cnpj, mes) {
  return todasAsNotas(cfg).find(n => !n.cancelada && soDigitos(n.cnpj) === soDigitos(cnpj) && n.mes === mes) || null;
}

// ---- Leitura da lista "Notas emitidas" do portal (só leitura; o filtro aceita no máximo 30 dias).

function janelasDe30Dias(de, ate) {
  const janelas = [];
  for (let ini = new Date(de); ini <= ate;) {
    const fim = new Date(ini);
    fim.setDate(fim.getDate() + 29);
    janelas.push([new Date(ini), fim > ate ? new Date(ate) : fim]);
    ini = new Date(fim);
    ini.setDate(ini.getDate() + 1);
  }
  return janelas;
}

// Uma linha da tabela (atributos do <tr> + textos das colunas) vira uma nota.
function notaDaLinha(l) {
  const chave = /\/(\d{50})/.exec(l.link || '')?.[1];
  if (!chave) return null;
  const [mm, aaaa] = (l.competencia || '').trim().split('/');
  const situacao = l.situacao || '';
  return {
    chave, numero: numeroDaChave(chave),
    geracao: (l.geracao || '').trim(),
    mes: `${aaaa}-${mm}`,
    cnpj: soDigitos(l.cnpj),
    nome: soDigitos(l.cnpj) ? (l.nome || '').replace(/^\s*-\s*/, '').trim() : 'sem tomador identificado',
    centavos: parseValor(l.valor || '0,01'),
    situacao, cancelada: /CANCEL|SUBSTITU/i.test(`${situacao} ${l.situacaoTexto || ''}`),
    origem: 'portal',
  };
}

async function lerListaDoPortal(page, base, de, ate, log = () => {}) {
  const notas = [];
  for (const [ini, fim] of janelasDe30Dias(de, ate)) {
    const url = `${base}/EmissorNacional/Notas/Emitidas?datainicio=${encodeURIComponent(formatarBR(ini))}&datafim=${encodeURIComponent(formatarBR(fim))}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('text=/Total de \\d+ registro|Nenhum registro/i').first().waitFor({ timeout: 60000 }).catch(() => {});
    const linhas = await page.locator('tr[data-chave]').evaluateAll(trs => trs.map(tr => ({
      situacao: tr.dataset.situacao,
      valor: tr.dataset.valor,
      geracao: tr.querySelector('.td-data')?.innerText,
      cnpj: tr.querySelector('.cnpj')?.innerText,
      nome: tr.querySelector('.td-texto-grande div')?.innerText.replace(tr.querySelector('.cnpj')?.innerText || '', ''),
      competencia: tr.querySelector('.td-competencia')?.innerText,
      situacaoTexto: tr.querySelector('.td-situacao img')?.getAttribute('data-original-title') || tr.querySelector('.td-situacao img')?.alt,
      link: tr.querySelector('a[href*="/Notas/Visualizar/"]')?.getAttribute('href'),
    })));
    const total = Number(/Total de (\d+) registro/i.exec(await page.locator('body').innerText())?.[1] || linhas.length);
    if (total > linhas.length) log(`  ! ${formatarBR(ini)} a ${formatarBR(fim)}: o portal tem ${total} notas mas mostrou ${linhas.length}; algumas podem ter ficado de fora.`);
    for (const l of linhas) { const n = notaDaLinha(l); if (n) notas.push(n); }
    log(`  ${formatarBR(ini)} a ${formatarBR(fim)}: ${linhas.length} nota${linhas.length === 1 ? '' : 's'}`);
  }
  return notas;
}

function salvarPortal(cfg, notas, de, ate) {
  const antes = lerPortal(cfg)?.notas || [];
  const porChave = new Map(antes.map(n => [n.chave, n]));
  for (const n of notas) porChave.set(n.chave, n);
  const dados = { atualizadoEm: new Date().toISOString(), periodo: [iso(de), iso(ate)], notas: [...porChave.values()] };
  fs.mkdirSync(cfg.pastaNotas, { recursive: true });
  fs.writeFileSync(arquivoPortal(cfg), JSON.stringify(dados, null, 2));
  return dados;
}

module.exports = {
  numeroDaChave, registrar, lerHistorico, lerPortal, todasAsNotas, jaEmitida,
  janelasDe30Dias, notaDaLinha, lerListaDoPortal, salvarPortal, arquivoHistorico, arquivoPortal,
};
