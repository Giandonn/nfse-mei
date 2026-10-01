// A rotina que o agendador roda algumas vezes por dia (`nfse-mei rotina`). Ela é idempotente: só age
// no que está pendente e lembra o que já fez em estado.json. Cuida de:
//  - nota do mês dos clientes com "nota mensal" (emite sozinha ou pergunta, conforme o cliente);
//  - lembrete do DAS perto do vencimento;
//  - alerta do limite anual do MEI.
// Tudo que fala com o mundo (notificações, emissão, e-mail, portal) chega por parâmetro, para dar para testar.
const fs = require('fs');
const path = require('path');
const { ultimoDiaUtil, vencimentoDas, formatarBR, iso } = require('./datas');
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

// Qual competência a rotina deve cobrar hoje: a do mês, a partir do último dia útil; ou a do mês
// anterior, até o dia 10 (computador desligado no dia certo). Fora disso, nenhuma.
function competenciaPendente(hoje) {
  const a = hoje.getFullYear(), m = hoje.getMonth() + 1;
  const ud = ultimoDiaUtil(a, m);
  if (hoje >= ud) return { data: ud, mes: iso(ud).slice(0, 7) };
  if (hoje.getDate() <= 10) {
    const anterior = ultimoDiaUtil(m === 1 ? a - 1 : a, m === 1 ? 12 : m - 1);
    return { data: anterior, mes: iso(anterior).slice(0, 7) };
  }
  return null;
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

async function cuidarDasNotas(dep, feito) {
  const { cfg, hoje, agora = new Date(), estado, notificar, log, historico, painel } = dep;
  const comp = competenciaPendente(hoje);
  if (!comp) return;
  const pendentes = clientesMensais(cfg).filter(([apelido, t]) => {
    const k = `${soDigitos(t.cnpj)}|${comp.mes}`;
    if (estado.pulado?.[k]) return false;
    if (estado.adiadoAte?.[k] && new Date(estado.adiadoAte[k]) > agora) return false;
    return !historico.jaEmitida(cfg, t.cnpj, comp.mes);
  });
  if (!pendentes.length) return;

  // Antes de emitir, confere a lista do portal: pega notas feitas à mão (nunca emite duas vezes).
  let sincronizou = false;
  const sincronizarUmaVez = async () => {
    if (sincronizou) return;
    sincronizou = true;
    try { await dep.sincronizar(comp); } catch (e) { log(`não consegui ler a lista do portal: ${e.message}`); throw e; }
  };

  for (const [apelido, t] of pendentes) {
    const k = `${soDigitos(t.cnpj)}|${comp.mes}`;
    const nome = t.nome || apelido;
    const centavos = t.mensal.valor ? parseValor(t.mensal.valor) : null;
    const falhas = estado.falhas?.[k] || 0;
    const resumo = painel.resumoDoAno(cfg, Number(comp.mes.slice(0, 4)), hoje);
    const passaDoLimite = centavos && resumo.total + centavos > resumo.limite;
    const automatico = t.mensal.automatico && centavos && !passaDoLimite && falhas < MAX_FALHAS;

    let decisao = automatico ? 'emitir' : null;
    if (!automatico) {
      // Não pergunta de novo a cada rodada: no máximo a cada algumas horas.
      const ultima = estado.perguntadoEm?.[k];
      if (ultima && agora - new Date(ultima) < HORAS_ENTRE_PERGUNTAS * 3600000) continue;
      (estado.perguntadoEm ??= {})[k] = agora.toISOString();
      let texto = centavos
        ? `R$ ${formatarValor(centavos)} para ${nome}\nCompetência ${formatarBR(comp.data)}`
        : `Nota do mês para ${nome}\nCompetência ${formatarBR(comp.data)}\n\nO valor muda todo mês, então abro o nfse-mei para você digitar.`;
      if (passaDoLimite) texto += `\n\n⚠️ Com esta nota o faturamento do ano passa do limite do MEI (R$ ${formatarValor(resumo.limite)}). Confira antes de emitir.`;
      if (falhas >= MAX_FALHAS) texto += `\n\nA emissão automática falhou ${falhas} vezes (portal instável?). Quer tentar agora?`;
      const botoes = centavos ? ['Emitir agora', 'Lembrar amanhã', 'Pular este mês'] : ['Abrir para emitir', 'Lembrar amanhã', 'Pular este mês'];
      const r = await notificar.perguntar('nfse-mei: dia de nota fiscal', texto, botoes);
      log(`pergunta da nota de ${apelido} (${comp.mes}): ${r || 'sem resposta'}`);
      if (r === 'Lembrar amanhã') {
        const amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1); amanha.setHours(8);
        (estado.adiadoAte ??= {})[k] = amanha.toISOString();
      } else if (r === 'Pular este mês') {
        (estado.pulado ??= {})[k] = true;
      } else if (r === 'Abrir para emitir') {
        dep.abrirTerminal(['emitir', '--tomador', apelido, '--competencia', formatarBR(comp.data)]);
        feito.push({ acao: 'abriu-terminal', apelido });
      } else if (r === 'Emitir agora') {
        decisao = 'emitir';
      }
    }
    if (decisao !== 'emitir') continue;

    try {
      await sincronizarUmaVez();
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

module.exports = { rotina, competenciaPendente, carregarEstado, salvarEstado, clientesMensais, MAX_FALHAS };
