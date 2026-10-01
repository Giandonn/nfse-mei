// Datas: último dia útil do mês (fim de semana + feriados nacionais).

function pascoa(ano) {
  // Algoritmo de Meeus/Jones/Butcher
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

function feriadosNacionais(ano) {
  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
  const sextaSanta = pascoa(ano);
  sextaSanta.setDate(sextaSanta.getDate() - 2);
  return new Set([...fixos.map(md => `${ano}-${md}`), iso(sextaSanta)]);
}

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ehDiaUtil(d) {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6 && !feriadosNacionais(d.getFullYear()).has(iso(d));
}

function ultimoDiaUtil(ano, mes /* 1-12 */) {
  const d = new Date(ano, mes, 0); // último dia do mês
  while (!ehDiaUtil(d)) d.setDate(d.getDate() - 1);
  return d;
}

function proximoDiaUtil(d) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  while (!ehDiaUtil(r)) r.setDate(r.getDate() + 1);
  return r;
}

// DAS do MEI: vence dia 20; se não for dia útil, passa para o próximo dia útil.
function vencimentoDas(ano, mes /* 1-12 */) {
  return proximoDiaUtil(new Date(ano, mes - 1, 20));
}

// "Hoje" sem hora. NFSE_MEI_HOJE=AAAA-MM-DD simula outra data (testes e conferência da rotina).
function hoje() {
  const simulado = /^(\d{4})-(\d{2})-(\d{2})$/.exec(process.env.NFSE_MEI_HOJE || '');
  if (simulado) return new Date(+simulado[1], +simulado[2] - 1, +simulado[3]);
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const mesmoDia = (a, b) => iso(a) === iso(b);

function formatarBR(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function parseBR(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || '');
  if (!m) throw new Error(`Data inválida: "${s}" (use DD/MM/AAAA)`);
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  if (d.getDate() !== +m[1] || d.getMonth() !== +m[2] - 1) throw new Error(`Data inválida: "${s}"`);
  return d;
}

module.exports = { pascoa, ehDiaUtil, ultimoDiaUtil, proximoDiaUtil, vencimentoDas, hoje, mesmoDia, formatarBR, parseBR, iso };
