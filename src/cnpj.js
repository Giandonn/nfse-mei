// Razão social de um CNPJ por APIs públicas (dados abertos da Receita), para não precisar digitar.
// Só o CNPJ sai do computador; se as consultas falharem, a pessoa digita o nome.
const { soDigitos, cnpjValido } = require('./valores');

// Sem User-Agent próprio, a BrasilAPI responde 403 para o fetch do Node.
const CABECALHOS = { 'User-Agent': 'nfse-mei (+https://github.com/Giandonn/nfse-mei)', Accept: 'application/json' };

const FONTES = [
  { url: d => `https://brasilapi.com.br/api/cnpj/v1/${d}`, ler: j => ({ nome: j.razao_social, municipio: j.municipio, uf: j.uf, email: j.email }) },
  {
    url: d => `https://publica.cnpj.ws/cnpj/${d}`,
    ler: j => ({ nome: j.razao_social, municipio: j.estabelecimento?.cidade?.nome, uf: j.estabelecimento?.estado?.sigla, email: j.estabelecimento?.email }),
  },
];

async function consultarCnpj(cnpj, buscar = fetch) {
  const d = soDigitos(cnpj);
  if (!cnpjValido(d)) throw Object.assign(new Error('CNPJ inválido'), { status: 400 });
  let ultimoErro;
  for (const fonte of FONTES) {
    try {
      const r = await buscar(fonte.url(d), { headers: CABECALHOS, signal: AbortSignal.timeout(10000) });
      if (r.status === 404) throw Object.assign(new Error('CNPJ não encontrado na Receita'), { status: 404 });
      if (!r.ok) throw new Error(`consulta de CNPJ indisponível (HTTP ${r.status})`);
      const x = fonte.ler(await r.json());
      return { cnpj: d, nome: String(x.nome || '').trim(), municipio: x.municipio && x.uf ? `${x.municipio}/${x.uf}` : '', email: String(x.email || '').toLowerCase() };
    } catch (e) {
      if (e.status === 404) throw e;
      ultimoErro = e;
    }
  }
  throw ultimoErro;
}

module.exports = { consultarCnpj };
