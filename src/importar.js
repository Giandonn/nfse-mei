// Primeiro uso: entra no portal com a senha guardada e descobre o cadastro sozinho (só leitura).
// O serviço vem da última nota emitida (tela "Visualizar") e os clientes vêm da lista "Notas emitidas",
// então quem já emitiu alguma nota no portal só confere e não digita nada.
const { soDigitos, formatarValor } = require('./valores');

const MESES_PARA_TRAS = 6;

// Campos da tela "Visualizar" ({ aba, rotulo, valor }) -> serviço no formato do config.
function servicoDosCampos(campos) {
  const pegar = (aba, rotulo) => campos.find(c => c.aba === aba && rotulo.test(c.rotulo))?.valor?.trim() || '';
  const codigo = soDigitos(pegar('servicos', /^Código de Tributação Nacional/i).split(' - ')[0]);
  const nbs = soDigitos(pegar('servicos', /^Item da NBS/i).split(' - ')[0]);
  const servico = {
    municipio: pegar('servicos', /^Município$/i),
    codigoTributacaoNacional: codigo.length === 6 ? codigo.replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3') : '',
    nbs: nbs.length === 9 ? nbs : '',
    descricao: pegar('servicos', /^Descrição do serviço$/i),
  };
  return Object.values(servico).every(Boolean) ? servico : null;
}

const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const PALAVRAS_VAZIAS = /^(ltda|me|epp|eireli|sa|s\/a|e|de|da|do|das|dos|holding|servicos|comercio|\d+)$/i;

// Apelido curto a partir da razão social ("HYPEX HOLDING LTDA" -> "hypex"), sem repetir os já usados.
function apelidoSugerido(nome, usados = []) {
  const palavras = semAcento(String(nome || '')).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const base = (palavras.find(p => !PALAVRAS_VAZIAS.test(p) && p.length > 1) || palavras[0] || 'cliente').slice(0, 20);
  let apelido = base;
  for (let i = 2; usados.includes(apelido); i++) apelido = `${base}${i}`;
  return apelido;
}

const mesDe = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Notas do portal -> clientes sugeridos, do mais recente para o mais antigo.
// "Todo mês" quando o cliente teve nota em pelo menos 2 dos últimos 3 meses (contando o atual).
function clientesDasNotas(notas, hoje) {
  const recentes = new Set([0, 1, 2].map(n => mesDe(new Date(hoje.getFullYear(), hoje.getMonth() - n, 1))));
  const porCnpj = new Map();
  for (const n of notas) {
    if (n.cancelada || soDigitos(n.cnpj).length !== 14) continue;
    const c = porCnpj.get(n.cnpj) || { cnpj: n.cnpj, nome: n.nome, notas: [] };
    c.notas.push(n);
    porCnpj.set(n.cnpj, c);
  }
  const usados = [];
  return [...porCnpj.values()]
    .map(c => {
      c.notas.sort((a, b) => (a.mes === b.mes ? Number(a.numero) - Number(b.numero) : a.mes.localeCompare(b.mes)));
      const ultima = c.notas.at(-1);
      const meses = new Set(c.notas.map(n => n.mes));
      return { cnpj: c.cnpj, nome: c.nome, ultimoValor: formatarValor(ultima.centavos), ultimoMes: ultima.mes, notas: c.notas.length, mensal: [...recentes].filter(m => meses.has(m)).length >= 2 };
    })
    .sort((a, b) => b.ultimoMes.localeCompare(a.ultimoMes))
    .map(c => {
      const apelido = apelidoSugerido(c.nome, usados);
      usados.push(apelido);
      return { ...c, apelido };
    });
}

// Lê os campos (rótulo + valor) de todas as abas da tela "Visualizar" de uma nota.
async function lerVisualizacao(page, base, chave) {
  const portal = require('./portal');
  await portal.abrirPagina(page, `${base}/EmissorNacional/Notas/Visualizar/Index/${chave}`, () => {});
  return page.evaluate(() => [...document.querySelectorAll('label')].map(l => {
    const grupo = l.closest('.form-group') || l.parentElement;
    return {
      aba: l.closest('.tab-pane')?.id || '',
      rotulo: l.textContent.trim(),
      valor: (grupo.textContent || '').replace(l.textContent, '').replace(/\s+/g, ' ').trim(),
    };
  }));
}

// Entra no portal (senha do cofre), lê os últimos meses e devolve { notas, servico, clientes, de, ate }.
async function importarDoPortal({ base, hoje = new Date(), log = () => {} }) {
  const portal = require('./portal');
  const { lerListaDoPortal } = require('./historico');
  const de = new Date(hoje.getFullYear(), hoje.getMonth() - MESES_PARA_TRAS, 1);
  const { ctx, page } = await portal.abrirNavegador();
  try {
    await portal.garantirLogin(page, base, log);
    const notas = await lerListaDoPortal(page, base, de, hoje, log);
    const ultima = notas.filter(n => !n.cancelada).sort((a, b) => Number(b.numero) - Number(a.numero))[0];
    const campos = ultima ? await lerVisualizacao(page, base, ultima.chave) : [];
    const prestadorCnpj = soDigitos(campos.find(c => c.aba === 'nfse' && c.rotulo === 'CNPJ')?.valor);
    return { notas, servico: servicoDosCampos(campos), prestadorCnpj, clientes: clientesDasNotas(notas, hoje), de, ate: hoje };
  } finally {
    await ctx.close().catch(() => {});
  }
}

module.exports = { servicoDosCampos, apelidoSugerido, clientesDasNotas, importarDoPortal, MESES_PARA_TRAS };
