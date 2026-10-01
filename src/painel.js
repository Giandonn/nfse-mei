// Painel do MEI: faturamento do ano x limite, projeção, próximo DAS e o relatório da declaração anual.
const { todasAsNotas, lerPortal } = require('./historico');
const { formatarValor } = require('./valores');
const { vencimentoDas, formatarBR, hoje: hojeReal } = require('./datas');

const LIMITE_MEI = 8100000; // R$ 81.000,00 por ano (no 1º ano é proporcional: R$ 6.750 por mês de atividade)
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function limiteDe(cfg) {
  return cfg.limiteAnual ? Math.round(Number(cfg.limiteAnual) * 100) : LIMITE_MEI;
}

function resumoDoAno(cfg, ano, hoje = hojeReal()) {
  const notas = todasAsNotas(cfg).filter(n => !n.cancelada && n.mes.startsWith(`${ano}-`));
  const porMes = Array(12).fill(0);
  const porCliente = {};
  for (const n of notas) {
    porMes[Number(n.mes.slice(5)) - 1] += n.centavos;
    const quem = n.apelido || n.nome || n.cnpj;
    porCliente[quem] = (porCliente[quem] || 0) + n.centavos;
  }
  const total = porMes.reduce((a, b) => a + b, 0);
  const limite = limiteDe(cfg);
  // Projeção pela média dos meses já faturados (até o último mês com nota).
  const ultimoMes = porMes.reduce((u, v, i) => (v ? i + 1 : u), 0);
  const anoAtual = ano === hoje.getFullYear();
  const media = ultimoMes ? total / ultimoMes : 0;
  const projecao = anoAtual ? Math.round(media * 12) : total;
  let mesEstouro = null;
  if (anoAtual && media && projecao > limite) {
    for (let m = ultimoMes, acum = total; m < 12; m++) {
      acum += media;
      if (acum > limite) { mesEstouro = m + 1; break; }
    }
  }
  return {
    ano, notas, porMes, porCliente, total, limite, restante: limite - total,
    pct: limite ? (total / limite) * 100 : 0, projecao, mesEstouro,
    sincronizadoEm: lerPortal(cfg)?.atualizadoEm || null,
  };
}

function proximoDas(hoje = hojeReal()) {
  let ano = hoje.getFullYear(), mes = hoje.getMonth() + 1;
  let venc = vencimentoDas(ano, mes);
  if (venc < hoje) {
    mes = mes === 12 ? 1 : mes + 1;
    if (mes === 1) ano++;
    venc = vencimentoDas(ano, mes);
  }
  const dias = Math.round((venc - hoje) / 86400000);
  return { vencimento: venc, dias };
}

const R$ = c => `R$ ${formatarValor(Math.round(c))}`;

function barra(pct, largura = 30) {
  const cheio = Math.min(largura, Math.round((pct / 100) * largura));
  return `[${'█'.repeat(cheio)}${'░'.repeat(largura - cheio)}]`;
}

function textoPainel(cfg, hoje = hojeReal()) {
  const r = resumoDoAno(cfg, hoje.getFullYear(), hoje);
  const das = proximoDas(hoje);
  const linhas = [];
  linhas.push(`Seu MEI em ${r.ano}`);
  linhas.push('');
  linhas.push(`  Faturado:   ${R$(r.total)} de ${R$(r.limite)}  ${barra(r.pct)} ${r.pct.toFixed(0)}%`);
  linhas.push(`  Ainda cabe: ${R$(Math.max(0, r.restante))}`);
  if (r.total) {
    linhas.push(`  Projeção:   ${R$(r.projecao)} no ano, no ritmo atual`);
    if (r.restante < 0) linhas.push(`  ⛔ Passou do limite do MEI. Fale com um contador sobre o desenquadramento.`);
    else if (r.mesEstouro) linhas.push(`  ⚠️  Nesse ritmo você passa do limite em ${MESES[r.mesEstouro - 1]}/${r.ano}. Vale conversar com um contador.`);
    else if (r.pct >= 80) linhas.push('  ⚠️  Já passou de 80% do limite.');
  }
  linhas.push('');
  linhas.push(`  Próximo DAS: vence ${formatarBR(das.vencimento)} (${das.dias === 0 ? 'hoje' : das.dias === 1 ? 'amanhã' : `em ${das.dias} dias`})`);
  linhas.push('');
  if (r.total) {
    linhas.push('  Por mês:');
    r.porMes.forEach((v, i) => { if (v) linhas.push(`    ${MESES[i]}  ${R$(v).padStart(14)}`); });
    linhas.push('');
  }
  linhas.push(r.sincronizadoEm
    ? `  Inclui as notas do portal (sincronizado em ${formatarBR(new Date(r.sincronizadoEm))}).`
    : '  Só conta as notas emitidas pelo nfse-mei. Para incluir as que você fez no portal: nfse-mei sincronizar');
  return linhas.join('\n');
}

// Relatório para a DASN-SIMEI (declaração anual, entregue até 31/05 do ano seguinte).
function textoRelatorio(cfg, ano) {
  const r = resumoDoAno(cfg, ano, new Date(ano, 11, 31));
  const linhas = [];
  linhas.push(`Relatório ${ano} para a declaração anual do MEI (DASN-SIMEI)`);
  linhas.push('');
  linhas.push(`  Receita bruta total com nota:  ${R$(r.total)}   (${r.notas.length} nota${r.notas.length === 1 ? '' : 's'})`);
  linhas.push('');
  linhas.push('  Na declaração:');
  linhas.push(`    • "Receita bruta total": ${R$(r.total)}, somando qualquer valor que você recebeu SEM nota.`);
  linhas.push('    • Na parte de comércio/indústria: R$ 0,00 se você só presta serviço.');
  linhas.push('    • Declare em https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/dasnsimei.app/Identificacao');
  linhas.push('');
  if (r.total) {
    linhas.push('  Por mês (competência):');
    r.porMes.forEach((v, i) => { if (v) linhas.push(`    ${MESES[i]}/${ano}  ${R$(v).padStart(14)}`); });
    linhas.push('');
    linhas.push('  Por cliente:');
    for (const [quem, v] of Object.entries(r.porCliente).sort((a, b) => b[1] - a[1])) linhas.push(`    ${quem.padEnd(24)} ${R$(v).padStart(14)}`);
    linhas.push('');
  }
  if (r.restante < 0) linhas.push(`  ⛔ O total passou do limite de ${R$(r.limite)}. Procure um contador antes de declarar.`);
  linhas.push(r.sincronizadoEm
    ? '  Inclui as notas feitas no portal (notas canceladas não entram).'
    : '  ⚠️  Só conta as notas do nfse-mei. Rode `nfse-mei sincronizar` para incluir as feitas no portal.');
  linhas.push('  Na dúvida, confira com seu contador.');
  return linhas.join('\n');
}

module.exports = { LIMITE_MEI, limiteDe, resumoDoAno, proximoDas, textoPainel, textoRelatorio, barra };
