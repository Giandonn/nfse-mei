#!/usr/bin/env node
// nfse-mei: emite a NFS-e do MEI no Emissor Nacional pedindo só o que muda a cada nota.
const { parseArgs } = require('util');
const readline = require('readline');
const { ARQUIVO_CONFIG, AMBIENTES, carregarConfig, salvarConfig, expandirHome } = require('../src/config');
const { ultimoDiaUtil, formatarBR, parseBR, iso } = require('../src/datas');
const { parseValor, formatarValor, soDigitos, formatarCnpj } = require('../src/valores');

const AJUDA = `
nfse-mei - emite a NFS-e do MEI no Emissor Nacional (nfse.gov.br)

Uso:
  nfse-mei init                     cria/edita o config (seus dados, serviço e clientes)
  nfse-mei senha [CNPJ]             guarda a senha do emissor (login automático)
  nfse-mei senha apagar             apaga a senha guardada
  nfse-mei emitir [opções]          pergunta cliente/valor/competência, preenche e emite
  nfse-mei baixar [chave]           ajuda a baixar o PDF/XML (padrão: a última nota) e guarda na pasta do mês
  nfse-mei ultimo-dia-util [MM/AAAA]

Opções do emitir:
  --tomador <apelido>     cliente do config (sem a opção: pergunta se houver mais de um)
  --valor <1000,00>       valor do serviço (sem a opção: pergunta)
  --competencia <DD/MM/AAAA>  sem a opção: pergunta, sugerindo o último dia útil do mês
  --teste                 preenche tudo e PARA na revisão, sem emitir
  --sim                   não pergunta nada: confirma e emite (exige --valor)
  --homologacao           usa a Produção Restrita (notas sem valor fiscal)
  --ver                   mostra o Chrome na tela (por padrão roda invisível)

Config: ${ARQUIVO_CONFIG}
`;

const log = msg => console.log(msg);

// Um leitor só para o processo todo, com fila de linhas: assim nenhuma resposta se perde
// (inclusive quando a entrada vem de um pipe/script).
let leitor;
const linhas = [];
const esperando = [];
function proximaLinha() {
  if (!leitor) {
    leitor = readline.createInterface({ input: process.stdin, terminal: false });
    leitor.on('line', l => (esperando.length ? esperando.shift()(l) : linhas.push(l)));
    leitor.on('close', () => { while (esperando.length) esperando.shift()(''); });
  }
  if (linhas.length) return Promise.resolve(linhas.shift());
  if (leitor.closed) return Promise.resolve('');
  return new Promise(res => esperando.push(res));
}

async function perguntar(pergunta, padrao) {
  process.stdout.write(padrao !== undefined && padrao !== '' ? `${pergunta} [${padrao}]: ` : `${pergunta}: `);
  const r = (await proximaLinha()).trim();
  return r || (padrao ?? '');
}

async function init() {
  let cfg = {};
  try { cfg = carregarConfig(); } catch { /* config novo */ }
  const s = cfg.servico || {};
  const obrigatorio = async (pergunta, atual) => {
    const r = await perguntar(pergunta, atual);
    if (!r) throw new Error(`"${pergunta}" é obrigatório`);
    return r;
  };
  log('Vamos configurar os dados que se repetem todo mês (Enter mantém o valor entre colchetes).\n');

  log('1) VOCÊ (prestador): o CNPJ do seu MEI, o mesmo que você usa para entrar no Emissor Nacional.');
  cfg.prestadorCnpj = soDigitos(await obrigatorio('Seu CNPJ', cfg.prestadorCnpj));
  if (cfg.prestadorCnpj.length !== 14) throw new Error('CNPJ precisa ter 14 dígitos');
  cfg.ambiente = cfg.ambiente || 'producao';
  cfg.pastaNotas = await perguntar('Pasta onde registrar as notas', cfg.pastaNotas || '~/Documents/NFSe');

  log('\n2) O SERVIÇO: copie da sua última nota emitida no portal.');
  cfg.servico = {
    municipio: await obrigatorio('Município onde o serviço é prestado, como aparece no portal (ex: São Paulo/SP)', s.municipio),
    codigoTributacaoNacional: await obrigatorio('Código de Tributação Nacional (ex: 01.01.01)', s.codigoTributacaoNacional),
    nbs: soDigitos(await obrigatorio('Item da NBS, 9 dígitos (ex: 115022000)', s.nbs)),
    descricao: await obrigatorio('Descrição do serviço', s.descricao),
  };
  cfg.tributosAproximados = cfg.tributosAproximados ?? 3;

  log('\n3) SEUS CLIENTES (tomadores): para quem você emite nota. Dá pra ter vários.');
  cfg.tomadores = cfg.tomadores || {};
  do {
    const apelido = (await obrigatorio('Apelido do cliente, curto e sem espaço (ex: acme)', cfg.tomadorPadrao)).toLowerCase();
    const t = cfg.tomadores[apelido] || {};
    const cnpj = soDigitos(await obrigatorio('  CNPJ do cliente', t.cnpj));
    if (cnpj.length !== 14) throw new Error('CNPJ precisa ter 14 dígitos');
    cfg.tomadores[apelido] = {
      cnpj,
      nome: await perguntar('  Razão social do cliente (o script confere com o portal)', t.nome),
    };
    cfg.tomadorPadrao = cfg.tomadorPadrao || apelido;
  } while ((await perguntar('Adicionar outro cliente? (s/N)', 'n')).toLowerCase() === 's');
  salvarConfig(cfg);
  log(`\nConfig salvo em ${ARQUIVO_CONFIG}`);

  const cred = require('../src/credencial');
  if (cred.SUPORTADO && (await perguntar('\n4) Guardar agora a senha do Emissor Nacional? (S/n)', 's')).toLowerCase() !== 'n') {
    cred.salvarCredencial(cfg.prestadorCnpj);
    log(`Senha guardada ${cred.ONDE}.`);
  }
  log('\nPróximo passo: nfse-mei emitir --teste');
}

// Cliente, valor e competência são escolhidos a cada nota: pelas opções ou perguntando no terminal.
async function montarNota(cfg, op) {
  const apelidos = Object.keys(cfg.tomadores);
  if (!apelidos.length) throw new Error('Nenhum cliente no config. Rode: nfse-mei init');
  let apelido = op.tomador?.toLowerCase();
  if (!apelido) {
    if (apelidos.length === 1 || op.sim) {
      apelido = cfg.tomadorPadrao || apelidos[0];
    } else {
      log('Clientes:');
      apelidos.forEach((a, i) => log(`  ${i + 1}) ${a}: ${cfg.tomadores[a].nome || ''} (${formatarCnpj(cfg.tomadores[a].cnpj)})`));
      const r = await perguntar('Para qual cliente? (número ou apelido)', cfg.tomadorPadrao || apelidos[0]);
      apelido = /^\d+$/.test(r) ? apelidos[Number(r) - 1] : r.toLowerCase();
    }
  }
  const tomador = cfg.tomadores[apelido];
  if (!tomador) throw new Error(`Cliente "${apelido}" não está no config. Tem: ${apelidos.join(', ')}`);

  let bruto = op.valor;
  if (bruto === undefined) {
    if (op.sim) throw new Error('Com --sim, informe o valor em --valor');
    bruto = await perguntar(`Valor da nota para ${tomador.nome || apelido} (R$)`);
  }
  const centavos = parseValor(bruto);

  const hoje = new Date();
  let comp = op.competencia;
  if (!comp) {
    const sugestao = formatarBR(ultimoDiaUtil(hoje.getFullYear(), hoje.getMonth() + 1));
    comp = op.sim ? sugestao : await perguntar('Data de competência (DD/MM/AAAA)', sugestao);
  }
  const dataComp = parseBR(comp);
  return {
    apelido, tomador, prestadorCnpj: cfg.prestadorCnpj, centavos,
    competencia: formatarBR(dataComp),
    competenciaISO: iso(dataComp),
  };
}

async function emitir(op) {
  const cfg = carregarConfig();
  if (op.homologacao) cfg.ambiente = 'producaorestrita';
  const nota = await montarNota(cfg, op);
  const base = AMBIENTES[cfg.ambiente];

  log('');
  log(`  Ambiente:    ${cfg.ambiente === 'producao' ? 'PRODUÇÃO (nota com valor fiscal)' : 'Produção Restrita (teste, sem valor fiscal)'}`);
  log(`  Tomador:     ${tomador(nota)}`);
  log(`  Serviço:     ${cfg.servico.codigoTributacaoNacional} / NBS ${cfg.servico.nbs} / "${cfg.servico.descricao}"`);
  log(`  Valor:       R$ ${formatarValor(nota.centavos)}`);
  log(`  Competência: ${nota.competencia}`);
  log(`  Modo:        ${op.teste ? 'TESTE (para na revisão, não emite)' : op.sim ? 'automático (emite sem perguntar)' : 'pergunta antes de emitir'}`);
  log('');
  if (!op.sim && !op.teste && (await perguntar('Está certo? Posso abrir o portal e preencher? (S/n)', 's')).toLowerCase() === 'n') return;

  const portal = require('../src/portal');
  let ctx, page, revisao;
  // Com o portal sobrecarregado a aba morre, a página vem pela metade ou uma busca falha.
  // Antes do Emitir nada foi enviado, então é seguro fechar tudo e recomeçar do login.
  for (let tentativa = 1; ; tentativa++) {
    ({ ctx, page } = await portal.abrirNavegador({ visivel: op.ver }));
    try {
      await portal.garantirLogin(page, base, log);
      await portal.preencherPessoas(page, base, nota, log);
      await portal.preencherServico(page, cfg.servico, log);
      await portal.preencherValores(page, nota, cfg, log);
      revisao = await portal.conferirRevisao(page, nota);
      break;
    } catch (e) {
      // Erros de dado (tomador errado, valor não bate) não melhoram tentando de novo.
      const erroDeDado = /config diz|esperava|não bate|recusou/i.test(e.message);
      if (erroDeDado || tentativa >= 3) {
        revisao = { erro: e };
        break;
      }
      log(`  ${e.message.split('\n')[0]}`);
      log(`  portal instável, recomeçando do login (${tentativa}/3)...`);
      await ctx.close().catch(() => {});
    }
  }
  try {
    if (revisao.erro) throw revisao.erro;
    const { resumo, problemas } = revisao;
    log(`\nRevisão no portal: competência ${resumo.competencia} | NBS ${resumo.nbs} | líquido ${resumo.valorLiquido}`);
    if (problemas.length) throw new Error(`A revisão não bate com o esperado: ${problemas.join('; ')}. Nada foi emitido.`);

    if (op.teste) {
      log('\nMODO TESTE: tudo preenchido e conferido, parei na revisão. NADA foi emitido.');
      if (op.ver) await perguntar('Enter para fechar o navegador (o rascunho fica salvo no portal)');
      return;
    }

    if (!op.sim) {
      if (op.ver) log('\nPode emitir clicando em "Emitir NFS-e" no Chrome, ou confirmar aqui.');
      const clicouNoChrome = page.waitForURL(u => /\/DPS\/NFSe$/i.test(u.pathname), { timeout: 0 }).then(() => 'chrome', () => 'erro');
      const resposta = perguntar('\x07\nEmitir agora? (s/N)').then(r => r.toLowerCase());
      const r = await Promise.race([clicouNoChrome, resposta]);
      if (r !== 'chrome' && r !== 's') {
        log('Cancelado. Nada foi emitido (o rascunho fica no portal).');
        return;
      }
      nota.clicarEmitir = r === 's';
    } else {
      nota.clicarEmitir = true;
    }

    const { chave, arquivos, pendentes } = await portal.emitirEBaixar(page, base, cfg, nota, log);
    log(`\n\x07✅ NFS-e EMITIDA: R$ ${formatarValor(nota.centavos)} para ${tomador(nota)}`);
    log(`   Chave: ${chave}`);
    log('   NÃO rode de novo para esta nota.');
    if (arquivos.pdf) log(`   PDF: ${arquivos.pdf}`);
    if (arquivos.xml) log(`   XML: ${arquivos.xml}`);
    if (pendentes.length) {
      await ctx.close().catch(() => {}); // o navegador invisível não serve para o captcha
      await baixarComCaptcha(base, cfg, {
        chave, competenciaISO: nota.competenciaISO, apelido: nota.apelido,
        descricao: `de R$ ${formatarValor(nota.centavos)} para ${nota.tomador.nome || nota.apelido}`,
        tipos: pendentes.map(p => p.ext),
      });
    }
  } catch (e) {
    const print = require('path').join(require('path').dirname(ARQUIVO_CONFIG), 'ultimo-erro.png');
    await page.screenshot({ path: print, fullPage: true }).catch(() => {});
    console.error(`\nErro: ${e.message.split('\n')[0]}`);
    console.error(`Página: ${page.url()}`);
    console.error(`Print da tela: ${print}`);
    if (op.ver) await perguntar('\nO Chrome ficou aberto onde parou. Enter para fechar');
    else console.error('Para ver o navegador na tela, rode de novo com --ver');
    process.exitCode = 1;
  } finally {
    await ctx.close().catch(() => {});
  }
}

function tomador(nota) {
  return `${nota.tomador.nome || nota.apelido} (${formatarCnpj(nota.tomador.cnpj)})`;
}

// O download exige captcha, então quem baixa é a pessoa, no navegador dela. O script abre a
// lista de notas, explica os cliques e fica vigiando a pasta Downloads para guardar os arquivos.
async function baixarComCaptcha(base, cfg, { chave, competenciaISO, apelido, descricao, tipos }) {
  const path = require('path');
  const portal = require('../src/portal');
  const { vigiarDownloads, pastaDownloadsPadrao, destinoDaNota } = require('../src/downloads');
  const url = portal.linkNotasEmitidas(base);
  const pastaDl = cfg.pastaDownloads ? expandirHome(cfg.pastaDownloads) : pastaDownloadsPadrao();
  const destino = ext => destinoDaNota(cfg.pastaNotas, competenciaISO, apelido, chave, ext);

  log('\n⬇️  FALTA SÓ BAIXAR. O portal exige captcha, então essa parte é sua:');
  log(`   1. Abra a lista de notas (já abri no seu navegador; faça login se pedir):`);
  log(`      ${url}`);
  log(`   2. Na nota ${descricao}: menu ⋮ → Download DANFS-e`);
  log('   3. Marque "Sou humano" → Confirmar. Se quiser o XML, repita com Download XML.');
  log(`\n   Estou vigiando ${pastaDl}: quando o arquivo chegar, guardo em ${path.dirname(destino('pdf'))}`);
  log('   (Enter para parar de esperar)');
  portal.abrirNoNavegadorPadrao(url);

  const vigia = vigiarDownloads({ pastaDownloads: pastaDl, chave, tipos, destino, log });
  let relogio;
  const limite = new Promise(res => { relogio = setTimeout(res, 20 * 60 * 1000); });
  await Promise.race([vigia.promessa, proximaLinha(), limite]);
  clearTimeout(relogio);
  vigia.cancelar();
  const faltou = tipos.filter(t => !vigia.salvos[t]);
  if (faltou.length) {
    log(`\n   Ainda falta: ${faltou.map(t => t.toUpperCase()).join(' e ')}. Quando quiser, rode: nfse-mei baixar`);
  } else {
    log('\n   Tudo guardado. 👍');
  }
}

// Lê o historico.csv e devolve a nota pedida (pela chave) ou a última emitida.
function notaDoHistorico(cfg, chave) {
  const fs = require('fs');
  const arq = require('path').join(cfg.pastaNotas, 'historico.csv');
  if (!fs.existsSync(arq)) throw new Error(`Nenhuma nota registrada ainda (${arq} não existe).`);
  const linhas = fs.readFileSync(arq, 'utf8').trim().split(/\r?\n/).slice(1).map(l => l.split(';'));
  const linha = chave ? linhas.find(l => l[5] === chave) : linhas[linhas.length - 1];
  if (!linha) throw new Error(`Chave ${chave} não está no ${arq}.`);
  const [, competencia, apelido, , valor, ch] = linha;
  return { chave: ch, apelido, valor, competenciaISO: iso(parseBR(competencia)) };
}

async function main() {
  const { values: op, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      tomador: { type: 'string' }, valor: { type: 'string' }, competencia: { type: 'string' },
      teste: { type: 'boolean' }, sim: { type: 'boolean' }, homologacao: { type: 'boolean' }, ver: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const cmd = positionals[0];
  if (op.help || !cmd) return log(AJUDA);
  if (cmd === 'init') return init();
  if (cmd === 'emitir') return emitir(op);
  if (cmd === 'baixar') {
    const cfg = carregarConfig();
    const base = AMBIENTES[op.homologacao ? 'producaorestrita' : cfg.ambiente];
    const n = notaDoHistorico(cfg, positionals[1] && soDigitos(positionals[1]));
    const { destinoDaNota } = require('../src/downloads');
    const tipos = ['pdf', 'xml'].filter(ext => !require('fs').existsSync(destinoDaNota(cfg.pastaNotas, n.competenciaISO, n.apelido, n.chave, ext)));
    if (!tipos.length) return log(`A nota ${n.chave} já tem PDF e XML guardados.`);
    const nome = cfg.tomadores[n.apelido]?.nome || n.apelido;
    return baixarComCaptcha(base, cfg, { ...n, descricao: `de R$ ${n.valor} para ${nome}`, tipos });
  }
  if (cmd === 'senha') {
    const cred = require('../src/credencial');
    if (positionals[1] === 'apagar') {
      cred.apagarCredencial();
      return log('Senha apagada.');
    }
    let padrao = '';
    try { padrao = carregarConfig().prestadorCnpj || ''; } catch { /* sem config ainda */ }
    const cnpj = soDigitos(positionals[1] || (await perguntar('CNPJ do seu MEI (só números)', padrao)));
    if (cnpj.length !== 14) throw new Error('CNPJ precisa ter 14 dígitos');
    log(process.platform === 'darwin'
      ? 'Digite a senha do Emissor Nacional (não aparece na tela) e repita para confirmar:'
      : 'Abrindo a janela do Windows para digitar a senha...');
    cred.salvarCredencial(cnpj);
    return log(`Senha guardada ${cred.ONDE}.`);
  }
  if (cmd === 'ultimo-dia-util') {
    const [m, a] = (positionals[1] || '').split('/').map(Number);
    const hoje = new Date();
    return log(formatarBR(ultimoDiaUtil(a || hoje.getFullYear(), m || hoje.getMonth() + 1)));
  }
  log(`Comando desconhecido: ${cmd}\n${AJUDA}`);
  process.exitCode = 1;
}

main().then(() => leitor?.close(), e => {
  leitor?.close();
  console.error(`\nErro: ${e.message}`);
  process.exit(1);
});
