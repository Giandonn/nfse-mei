// A rotina que o agendador roda algumas vezes por dia (`nfse-mei rotina`). Ela é idempotente: só age
// no que está pendente e lembra o que já fez em estado.json. Cuida de:
//  - nota do mês dos clientes com "nota mensal" (emite sozinha ou pergunta, conforme o cliente);
//  - lembrete do DAS perto do vencimento;
//  - alerta do limite anual do MEI.
// Tudo que fala com o mundo (notificações, emissão, e-mail, portal) chega por parâmetro, para dar para testar.
const fs = require('fs');
const path = require('path');
const { ultimoDiaUtil, diaDaNota, vencimentoDas, formatarBR, iso } = require('./datas');
const { formatarValor, parseValor, soDigitos } = require('./valores');

const MAX_FALHAS = 3; // depois disso a emissão automática vira pergunta
const HORAS_ENTRE_PERGUNTAS = 4;

// ---- estado.json: o que a rotina já fez/perguntou (por chave "cnpj|AAAA-MM", "das|AAAA-MM" etc.)

function carregarEstado(arquivo) {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return {}; }
}
function salvarEstado(arquivo, estado) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify(estado, null, 2), { mode: 0o600 });
}

// A nota de um cliente num mês: o dia em que a rotina cobra (lembrete) e a competência.
//  - sem dia escolhido: no último dia útil, a nota do próprio mês (competência nesse dia);
//  - dia escolhido: nesse dia, a nota do mês anterior (competência no último dia útil dele).
function notaDoMes(ano, mes /* 1-12 */, dia) {
  const lembrete = diaDaNota(ano, mes, dia);
  const data = dia ? ultimoDiaUtil(mes === 1 ? ano - 1 : ano, mes === 1 ? 12 : mes - 1) : lembrete;
  return { data, mes: iso(data).slice(0, 7), lembrete };
}

// Qual nota de um cliente a rotina deve cobrar hoje: a do mês, a partir do dia dela. Computador desligado
// no dia: recupera a que passou até o dia 10 do mês seguinte. Fora disso, nenhuma.
function competenciaPendente(hoje, dia) {
  const a = hoje.getFullYear(), m = hoje.getMonth() + 1;
  const doMes = notaDoMes(a, m, dia);
  if (hoje >= doMes.lembrete) return doMes;
  const anterior = notaDoMes(m === 1 ? a - 1 : a, m === 1 ? 12 : m - 1, dia);
  if (hoje.getDate() <= 10 && hoje - anterior.lembrete <= 15 * 86400000) return anterior;
  return null;
}

// A próxima nota de um cliente a partir de hoje (hoje incluso).
function proximaNota(hoje, dia) {
  const a = hoje.getFullYear(), m = hoje.getMonth() + 1;
  const doMes = notaDoMes(a, m, dia);
  return hoje <= doMes.lembrete ? doMes : notaDoMes(m === 12 ? a + 1 : a, m === 12 ? 1 : m + 1, dia);
}

const clientesMensais = cfg => Object.entries(cfg.tomadores || {}).filter(([, t]) => t.mensal?.ativo);

async function rotina(dep) {
  const { cfg, hoje, agora = new Date(), estado, notificar, log } = dep;
  const feito = [];
  await cuidarDasNotas(dep, feito);
  if (cfg.automacao?.das !== false) await cuidarDoDas(dep, feito);
  await cuidarDoLimite(dep, feito);
  estado.ultimaRotina = agora.toISOString();
  return feito;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const BOTOES_NOTA = ['Emitir', 'Lembrar amanhã', 'Pular este mês'];
const MAX_JANELAS = 5; // "Voltar" na confirmação reabre a janela da nota, mas não para sempre

async function cuidarDasNotas(dep, feito) {
  const { cfg, hoje, agora = new Date(), estado, notificar, log, historico, painel } = dep;
  const pendentes = clientesMensais(cfg).map(([apelido, t]) => ({ apelido, t, comp: competenciaPendente(hoje, t.mensal.dia) })).filter(({ t, comp }) => {
    if (!comp) return false;
    const k = `${soDigitos(t.cnpj)}|${comp.mes}`;
    if (estado.pulado?.[k]) return false;
    if (estado.adiadoAte?.[k] && new Date(estado.adiadoAte[k]) > agora) return false;
    return !historico.jaEmitida(cfg, t.cnpj, comp.mes);
  });
  if (!pendentes.length) return;

  // Antes de emitir, confere a lista do portal desde o mês da competência: pega notas feitas à mão
  // (nunca emite duas vezes). Se não deu para ler, nenhuma nota desta rodada sai.
  let lidoDesde = null;
  let erroLeitura = null;
  const conferirPortal = async comp => {
    if (erroLeitura) throw erroLeitura;
    if (lidoDesde && lidoDesde <= comp.mes) return;
    try { await dep.sincronizar(comp); lidoDesde = comp.mes; } catch (e) { log(`não consegui ler a lista do portal: ${e.message}`); erroLeitura = e; throw e; }
  };

  for (const { apelido, t, comp } of pendentes) {
    const k = `${soDigitos(t.cnpj)}|${comp.mes}`;
    const nome = t.nome || apelido;
    let centavos = t.mensal.valor ? parseValor(t.mensal.valor) : null;
    const falhas = estado.falhas?.[k] || 0;
    const resumo = painel.resumoDoAno(cfg, Number(comp.mes.slice(0, 4)), hoje);
    const passaDoLimite = c => resumo.total + c > resumo.limite;
    const automatico = t.mensal.automatico && centavos && !passaDoLimite(centavos) && falhas < MAX_FALHAS;

    if (!automatico) {
      // Não pergunta de novo a cada rodada: no máximo a cada algumas horas.
      const ultima = estado.perguntadoEm?.[k];
      if (ultima && agora - new Date(ultima) < HORAS_ENTRE_PERGUNTAS * 3600000) continue;
      (estado.perguntadoEm ??= {})[k] = agora.toISOString();
      const escolha = await perguntarNota(dep, { apelido, t, comp, centavos, falhas, resumo, passaDoLimite });
      if (escolha === 'Lembrar amanhã') {
        const amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1); amanha.setHours(8);
        (estado.adiadoAte ??= {})[k] = amanha.toISOString();
      } else if (escolha === 'Pular este mês') {
        (estado.pulado ??= {})[k] = true;
      }
      if (typeof escolha !== 'number') continue;
      centavos = escolha;
    }

    try {
      await conferirPortal(comp);
    } catch {
      registrarFalha(estado, k);
      await notificar.avisar('nfse-mei: não consegui emitir', `Nota para ${nome}: o portal não respondeu. Nada foi emitido; tento de novo mais tarde.`);
      feito.push({ acao: 'falhou', apelido, motivo: 'portal' });
      continue;
    }
    const jaTem = historico.jaEmitida(cfg, t.cnpj, comp.mes);
    if (jaTem) {
      log(`nota de ${apelido} (${comp.mes}) já existe no portal (nº ${jaTem.numero}); não emito de novo.`);
      feito.push({ acao: 'ja-existia', apelido, numero: jaTem.numero });
      continue;
    }

    const res = await dep.emitir({ apelido, valor: formatarValor(centavos), competencia: formatarBR(comp.data) });
    if (!res.ok) {
      const n = registrarFalha(estado, k);
      // Se a emissão pode ter acontecido (passou do clique), não tenta de novo sozinha: a próxima rodada sincroniza antes.
      await notificar.avisar('nfse-mei: não consegui emitir',
        `Nota de R$ ${formatarValor(centavos)} para ${nome}: ${res.motivo || 'erro no portal'}.\n${n >= MAX_FALHAS ? 'Da próxima vez eu pergunto antes.' : 'Tento de novo mais tarde.'}`);
      feito.push({ acao: 'falhou', apelido, motivo: res.motivo });
      continue;
    }
    if (res.teste) {
      await notificar.avisar('nfse-mei (teste): tudo certo', `Preenchi e conferi a nota de R$ ${formatarValor(centavos)} para ${nome}. Modo teste: nada foi emitido.`);
      feito.push({ acao: 'testou', apelido });
      continue;
    }
    delete estado.falhas?.[k];
    const numero = historico.numeroDaChave(res.chave);
    const total = painel.resumoDoAno(cfg, Number(comp.mes.slice(0, 4)), hoje);
    let texto = `R$ ${formatarValor(centavos)} para ${nome} · competência ${formatarBR(comp.data)}\nNo ano: R$ ${formatarValor(total.total)} de R$ ${formatarValor(total.limite)} (${total.pct.toFixed(0)}%)`;
    if (t.email && cfg.email?.remetente) {
      try {
        await dep.enviarEmail({ apelido, tomador: t, chave: res.chave, numero, centavos, competencia: formatarBR(comp.data) });
        texto += `\nEnviei para ${t.email}`;
      } catch (e) {
        texto += `\nNão consegui mandar o e-mail (${e.message}). Rode: nfse-mei email enviar ${numero}`;
      }
    }
    await notificar.avisar(`✅ Nota nº ${numero} emitida`, texto);
    feito.push({ acao: 'emitiu', apelido, chave: res.chave, numero });
  }
}

// Janela da nota com o valor editável. Devolve os centavos a emitir, o botão de adiar/pular ou null.
// Valor muito diferente do de costume, ou que passa do limite do MEI, pede confirmação; "Voltar" reabre a janela.
async function perguntarNota(dep, { apelido, t, comp, centavos, falhas, resumo, passaDoLimite }) {
  const { notificar, log } = dep;
  const nome = t.nome || apelido;
  const R = c => `R$ ${formatarValor(c)}`;
  const alertas = [];
  if (centavos && passaDoLimite(centavos)) alertas.push(`⚠️ Com esta nota o faturamento do ano passa do limite do MEI (${R(resumo.limite)}). Confira antes de emitir.`);
  if (falhas >= MAX_FALHAS) alertas.push(`A emissão automática falhou ${falhas} vezes (portal instável?). Quer tentar agora?`);
  let valor = centavos ? formatarValor(centavos) : '';
  for (let i = 0; i < MAX_JANELAS; i++) {
    const r = await notificar.pedirNota({
      titulo: `nfse-mei: nota de ${MESES[Number(comp.mes.slice(5)) - 1]}`, cliente: nome, competencia: formatarBR(comp.data), valor,
      resumo: `No ano: ${R(resumo.total)} de ${R(resumo.limite)} (${resumo.pct.toFixed(0)}%)`, alerta: alertas.join('\n'), botoes: BOTOES_NOTA,
    });
    log(`janela da nota de ${apelido} (${comp.mes}): ${!r ? 'sem resposta' : r.botao === 'Emitir' ? `Emitir R$ ${r.valor}${r.guardar ? ' (guardar o valor)' : ''}` : r.botao}`);
    if (r?.botao !== 'Emitir') return r?.botao || null;
    let novo;
    try { novo = parseValor(r.valor); } catch { valor = r.valor; continue; }
    valor = formatarValor(novo);
    const motivos = [];
    if (centavos && (novo > centavos * 1.5 || novo * 1.5 < centavos)) motivos.push(`É bem diferente do valor de costume (${R(centavos)}).`);
    if (passaDoLimite(novo) && novo !== centavos) motivos.push(`Com ela o faturamento do ano passa do limite do MEI (${R(resumo.limite)}).`);
    if (motivos.length) {
      const sim = `Emitir ${R(novo)}`;
      const ok = await notificar.perguntar('nfse-mei: confira o valor', `Nota de ${R(novo)} para ${nome}?\n\n${motivos.join('\n')}`, [sim, 'Voltar']);
      if (ok !== sim) continue;
    }
    if (r.guardar && novo !== centavos) {
      t.mensal.valor = formatarValor(novo);
      dep.guardarValorMensal(apelido, t.mensal.valor);
      log(`valor mensal de ${apelido} passa a ser R$ ${t.mensal.valor}`);
    }
    return novo;
  }
  return null;
}

function registrarFalha(estado, k) {
  (estado.falhas ??= {})[k] = (estado.falhas[k] || 0) + 1;
  return estado.falhas[k];
}

async function cuidarDoDas(dep, feito) {
  const { hoje, estado, notificar, log } = dep;
  const venc = vencimentoDas(hoje.getFullYear(), hoje.getMonth() + 1);
  const dias = Math.round((venc - hoje) / 86400000);
  if (dias < 0 || dias > 5) return;
  const k = iso(venc).slice(0, 7);
  if (estado.das?.[k] === 'pago') return;
  if (estado.dasPerguntadoEm?.[k] === iso(hoje)) return;
  (estado.dasPerguntadoEm ??= {})[k] = iso(hoje);
  const quando = dias === 0 ? 'HOJE' : dias === 1 ? 'amanhã' : `em ${dias} dias`;
  const r = await notificar.perguntar('nfse-mei: DAS do MEI',
    `O DAS vence ${quando} (${formatarBR(venc)}).\n\nNo PGMEI você gera a guia e paga pelo app do banco (código de barras ou PIX).`,
    ['Abrir o PGMEI', 'Já paguei', 'Lembrar amanhã']);
  log(`lembrete do DAS ${k}: ${r || 'sem resposta'}`);
  if (r === 'Já paguei') (estado.das ??= {})[k] = 'pago';
  if (r === 'Abrir o PGMEI') dep.abrirUrl('https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Identificacao');
  feito.push({ acao: 'lembrou-das', resposta: r });
}

async function cuidarDoLimite(dep, feito) {
  const { cfg, hoje, estado, notificar, painel } = dep;
  const r = painel.resumoDoAno(cfg, hoje.getFullYear(), hoje);
  const nivel = r.pct >= 100 ? 100 : r.pct >= 80 ? 80 : r.mesEstouro ? 'projecao' : null;
  if (!nivel) return;
  const k = String(r.ano);
  const jaAvisado = estado.avisoLimite?.[k];
  const ordem = { projecao: 1, 80: 2, 100: 3 };
  if (jaAvisado && ordem[jaAvisado] >= ordem[nivel]) return;
  (estado.avisoLimite ??= {})[k] = nivel;
  const R = c => `R$ ${formatarValor(c)}`;
  const texto = nivel === 100
    ? `Seu faturamento em ${r.ano} (${R(r.total)}) passou do limite do MEI (${R(r.limite)}). Procure um contador.`
    : nivel === 80
      ? `Você já faturou ${R(r.total)} em ${r.ano}: ${r.pct.toFixed(0)}% do limite do MEI. Ainda cabem ${R(r.restante)}.`
      : `No ritmo atual você passa do limite do MEI (${R(r.limite)}) por volta de ${String(r.mesEstouro).padStart(2, '0')}/${r.ano}. Vale conversar com um contador.`;
  await notificar.avisar('nfse-mei: limite do MEI', texto);
  feito.push({ acao: 'avisou-limite', nivel });
}

module.exports = { rotina, competenciaPendente, proximaNota, carregarEstado, salvarEstado, clientesMensais, MAX_FALHAS };
