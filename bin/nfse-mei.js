#!/usr/bin/env node
// nfse-mei: emite a NFS-e do MEI no Emissor Nacional pedindo só o que muda a cada nota.
const { parseArgs } = require('util');
const readline = require('readline');
const { ARQUIVO_CONFIG, AMBIENTES, carregarConfig, salvarConfig, expandirHome } = require('../src/config');
const { ultimoDiaUtil, formatarBR, parseBR, iso, hoje: hojeReal } = require('../src/datas');
const { parseValor, formatarValor, soDigitos, formatarCnpj, cnpjValido } = require('../src/valores');

const AJUDA = `
nfse-mei - emite a NFS-e do MEI no Emissor Nacional (nfse.gov.br)

Uso:
  nfse-mei abrir                    abre o PAINEL no navegador (cadastro, clientes, automação, e-mail, notas)
  nfse-mei init                     primeiro cadastro, passo a passo (seus dados, serviço e clientes)
  nfse-mei config                   menu para mudar seus dados, o serviço, os clientes e a senha
  nfse-mei senha [CNPJ]             guarda a senha do emissor (login automático)
  nfse-mei senha apagar             apaga a senha guardada
  nfse-mei emitir [opções]          pergunta cliente/valor/competência, preenche e emite
  nfse-mei doutor                   confere se está tudo pronto (Node, Chrome, cadastro, senha, portal)
  nfse-mei baixar [chave]           ajuda a baixar o PDF/XML (padrão: a última nota) e guarda na pasta do mês

Piloto automático:
  nfse-mei agendar                  liga a rotina diária (nota do mês, lembrete do DAS, limite do MEI)
  nfse-mei agendar remover          desliga a rotina
  nfse-mei rotina [--teste]         roda a rotina agora (com --teste preenche e confere, mas não emite)
  nfse-mei email                    configura o envio da nota por e-mail para o cliente
  nfse-mei email enviar <número>    manda (de novo) uma nota por e-mail

Seu MEI:
  nfse-mei painel                   faturamento do ano x limite do MEI, projeção e próximo DAS
  nfse-mei relatorio [ano]          números para a declaração anual (DASN-SIMEI); padrão: ano passado
  nfse-mei sincronizar [ano]        lê a lista de notas do portal (inclui as feitas à mão e as canceladas)
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

// ---- Cadastro: cada parte do config tem sua função, usada tanto no init quanto no menu `config`.

// Pergunta até vir uma resposta válida (sem derrubar o cadastro por um erro de digitação).
async function perguntarValido(pergunta, atual, validar = r => (r ? null : 'obrigatório')) {
  for (;;) {
    const r = await perguntar(pergunta, atual);
    const problema = validar(r);
    if (!problema) return r;
    if (leitor?.closed) throw new Error(`"${pergunta}": ${problema}`);
    log(`  ✗ ${problema}, tente de novo.`);
  }
}
const validarCnpj = r => (cnpjValido(r) ? null : 'CNPJ inválido (confira os 14 números)');
const simOuNao = async (pergunta, padrao) => (await perguntar(`${pergunta} (${padrao === 's' ? 'S/n' : 's/N'})`, padrao)).toLowerCase().startsWith('s');

async function editarPrestador(cfg) {
  log('VOCÊ (prestador): o CNPJ do seu MEI, o mesmo que você usa para entrar no Emissor Nacional.');
  cfg.prestadorCnpj = soDigitos(await perguntarValido('Seu CNPJ', cfg.prestadorCnpj, validarCnpj));
  cfg.ambiente = cfg.ambiente || 'producao';
  cfg.pastaNotas = await perguntar('Pasta onde guardar as notas (PDF/XML)', cfg.pastaNotas || '~/Documents/NFSe');
}

async function editarServico(cfg) {
  const s = cfg.servico || {};
  log('O SERVIÇO: copie da sua última nota emitida no portal (Notas emitidas → ⋮ → Visualizar).');
  cfg.servico = {
    municipio: await perguntarValido('Município onde o serviço é prestado, como aparece no portal (ex: São Paulo/SP)', s.municipio),
    codigoTributacaoNacional: await perguntarValido('Código de Tributação Nacional (ex: 01.01.01)', s.codigoTributacaoNacional,
      r => (/^\d{2}\.\d{2}\.\d{2}$/.test(r.trim()) ? null : 'use o formato 00.00.00')),
    nbs: soDigitos(await perguntarValido('Item da NBS, 9 dígitos (ex: 115022000)', s.nbs,
      r => (soDigitos(r).length === 9 ? null : 'a NBS tem 9 números'))),
    descricao: await perguntarValido('Descrição do serviço', s.descricao),
  };
  cfg.tributosAproximados = cfg.tributosAproximados ?? 3;
}

// Adiciona (apelido vazio) ou edita um cliente. Trocar o apelido renomeia o cliente.
async function editarCliente(cfg, apelidoAtual) {
  const t = cfg.tomadores[apelidoAtual] || {};
  const apelido = (await perguntarValido('Apelido do cliente, curto e sem espaço (ex: acme)', apelidoAtual, r => {
    const a = r.toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(a)) return 'use só letras, números, - ou _';
    if (a !== apelidoAtual && cfg.tomadores[a]) return `já existe um cliente "${a}"`;
    return null;
  })).toLowerCase();
  const cnpj = soDigitos(await perguntarValido('  CNPJ do cliente', t.cnpj, validarCnpj));
  const nome = await perguntar('  Razão social do cliente (o script confere com o portal)', t.nome);
  const { emailsValidos } = require('../src/email');
  const respostaEmail = await perguntarValido(`  E-mail do cliente para mandar a nota (vários: separe por vírgula; vazio = não manda${t.email ? '; - apaga' : ''})`, t.email || '',
    r => (!r || r === '-' || emailsValidos(r) ? null : 'e-mail inválido'));
  const email = respostaEmail === '-' ? '' : respostaEmail;
  let mensal;
  if (await simOuNao('  Nota todo mês para este cliente (lembrete ou emissão automática)?', t.mensal?.ativo ? 's' : 'n')) {
    const valor = await perguntarValido('    Valor fixo por mês (vazio = digitar a cada mês)', t.mensal?.valor || '', r => {
      if (!r) return null;
      try { parseValor(r); return null; } catch { return 'valor inválido (ex: 3500 ou 3.500,00)'; }
    });
    const { diaDaNotaValido } = require('../src/cadastro');
    const dia = diaDaNotaValido(await perguntarValido('    Dia da nota (1 a 31 = nota do mês anterior nesse dia; vazio = último dia útil, nota do próprio mês)',
      t.mensal?.dia ? String(t.mensal.dia) : '', r => (diaDaNotaValido(r) === null ? 'escolha um dia de 1 a 31, ou deixe vazio' : null)));
    const automatico = valor
      ? await simOuNao('    Emitir SOZINHO no dia da nota, sem perguntar? (você recebe um aviso depois)', t.mensal?.automatico ? 's' : 'n')
      : false;
    mensal = { ativo: true, valor: valor ? formatarValor(parseValor(valor)) : '', automatico };
    if (dia) mensal.dia = dia;
  }
  if (apelidoAtual && apelidoAtual !== apelido) {
    delete cfg.tomadores[apelidoAtual];
    if (cfg.tomadorPadrao === apelidoAtual) cfg.tomadorPadrao = apelido;
  }
  cfg.tomadores[apelido] = { cnpj, nome };
  if (email) cfg.tomadores[apelido].email = email;
  if (mensal) cfg.tomadores[apelido].mensal = mensal;
  cfg.tomadorPadrao = cfg.tomadorPadrao || apelido;
  return apelido;
}

async function guardarSenha(cfg) {
  const cred = require('../src/credencial');
  log(process.platform === 'darwin'
    ? 'Digite a senha do Emissor Nacional (não aparece na tela) e repita para confirmar:'
    : 'Abrindo a janela do Windows para digitar a senha...');
  cred.salvarCredencial(cfg.prestadorCnpj);
  log(`Senha guardada ${cred.ONDE}.`);
}

// Primeira vez: passo a passo. Se já existe config, abre o menu para mudar só o que precisa.
async function init({ seguirParaNota = false } = {}) {
  let cfg;
  try { cfg = carregarConfig(); } catch { /* config novo */ }
  if (cfg) return menuConfig(cfg);
  cfg = { tomadores: {} };
  if (!seguirParaNota) log('Vamos cadastrar os dados que se repetem todo mês.');
  log('É uma vez só; depois dá pra mudar com `nfse-mei config`.\n');
  log('1) ' + '-'.repeat(40));
  await editarPrestador(cfg);
  log('\n2) ' + '-'.repeat(40));
  await editarServico(cfg);
  log('\n3) ' + '-'.repeat(40));
  log('SEUS CLIENTES (tomadores): para quem você emite nota. Dá pra ter vários.');
  do await editarCliente(cfg, ''); while (await simOuNao('Adicionar outro cliente?', 'n'));
  salvarConfig(cfg);
  log(`\nTudo salvo em ${ARQUIVO_CONFIG}`);
  if (require('../src/credencial').SUPORTADO) {
    log('\n4) ' + '-'.repeat(40));
    if (await simOuNao('Guardar agora a senha do Emissor Nacional (login automático)?', 's')) await guardarSenha(cfg);
  }
  if (seguirParaNota) log('\nCadastro pronto. Das próximas vezes o nfse-mei já usa esses dados (mude com `nfse-mei config`).\nAgora, a nota:\n');
  else log('\nPróximo passo: nfse-mei emitir --teste');
}

async function menuClientes(cfg) {
  for (;;) {
    const apelidos = Object.keys(cfg.tomadores);
    log('\nClientes:');
    if (!apelidos.length) log('  (nenhum ainda)');
    apelidos.forEach((a, i) => {
      const t = cfg.tomadores[a];
      const extras = [a === cfg.tomadorPadrao && 'padrão',
        t.mensal?.ativo && `todo mês${t.mensal.dia ? ` (dia ${t.mensal.dia})` : ''}${t.mensal.valor ? ` R$ ${t.mensal.valor}` : ''}${t.mensal.automatico ? ', automática' : ''}`,
        t.email && `e-mail ${t.email}`].filter(Boolean);
      log(`  ${i + 1}) ${a.padEnd(12)} ${formatarCnpj(t.cnpj)}  ${t.nome || ''}${extras.length ? `  (${extras.join(' · ')})` : ''}`);
    });
    const op = (await perguntar('\n  a) adicionar   e) editar   r) remover   p) escolher o padrão   0) voltar\nEscolha', '0')).toLowerCase();
    if (op === '0' || leitor?.closed) return;
    if (op === 'a') {
      const novo = await editarCliente(cfg, '');
      salvarConfig(cfg);
      log(`  ✓ Cliente "${novo}" salvo.`);
      continue;
    }
    if (!['e', 'r', 'p'].includes(op)) { log('  Opção inválida.'); continue; }
    if (!apelidos.length) { log('  Não há clientes ainda: use "a" para adicionar.'); continue; }
    const r = await perguntar('  Qual cliente? (número ou apelido)');
    const apelido = /^\d+$/.test(r) ? apelidos[Number(r) - 1] : r.toLowerCase();
    if (!cfg.tomadores[apelido]) { log('  Cliente não encontrado.'); continue; }
    if (op === 'e') {
      const novo = await editarCliente(cfg, apelido);
      salvarConfig(cfg);
      log(`  ✓ Cliente "${novo}" salvo.`);
    } else if (op === 'p') {
      cfg.tomadorPadrao = apelido;
      salvarConfig(cfg);
      log(`  ✓ "${apelido}" é o cliente padrão agora.`);
    } else if (await simOuNao(`  Remover "${apelido}" (${cfg.tomadores[apelido].nome || formatarCnpj(cfg.tomadores[apelido].cnpj)})?`, 'n')) {
      delete cfg.tomadores[apelido];
      if (cfg.tomadorPadrao === apelido) cfg.tomadorPadrao = Object.keys(cfg.tomadores)[0];
      salvarConfig(cfg);
      log(`  ✓ "${apelido}" removido. As notas já emitidas para ele não mudam.`);
    }
  }
}

async function menuConfig(cfg) {
  const cred = require('../src/credencial');
  for (;;) {
    const s = cfg.servico;
    const nClientes = Object.keys(cfg.tomadores).length;
    log('\nnfse-mei - configuração (cada mudança é salva na hora)');
    log(`  1) Meus dados    ${formatarCnpj(cfg.prestadorCnpj)}  |  notas em ${cfg.pastaNotas}`);
    log(`  2) Serviço       ${s.codigoTributacaoNacional} / NBS ${s.nbs} / ${s.municipio}`);
    log(`  3) Clientes      ${nClientes} cadastrado${nClientes === 1 ? '' : 's'}`);
    if (cred.SUPORTADO) log(`  4) Senha         ${cred.temCredencial() ? 'guardada' : 'não guardada (login manual)'}`);
    const agenda = require('../src/agenda').situacao();
    log(`  5) Automação    ${agenda.ligada ? 'ligada' : 'desligada'} · lembrete do DAS ${cfg.automacao?.das === false ? 'desligado' : 'ligado'}`);
    log(`  6) E-mail        ${cfg.email?.remetente ? `envia de ${cfg.email.remetente}` : 'não configurado'}`);
    log('  0) Sair');
    const op = await perguntar('Escolha', '0');
    if (op === '0' || leitor?.closed) break;
    if (op === '1') { await editarPrestador(cfg); salvarConfig(cfg); log('  ✓ Salvo.'); }
    else if (op === '2') { await editarServico(cfg); salvarConfig(cfg); log('  ✓ Salvo.'); }
    else if (op === '3') await menuClientes(cfg);
    else if (op === '5') {
      const ag = require('../src/agenda');
      const ligada = ag.situacao().ligada;
      const acao = (await perguntar(`  l) ${ligada ? 'desligar' : 'ligar'} a rotina automática   d) ${cfg.automacao?.das === false ? 'ligar' : 'desligar'} o lembrete do DAS   0) voltar\nEscolha`, '0')).toLowerCase();
      if (acao === 'l') { if (ligada) log(`  ✓ ${ag.desligar()}`); else await agendar(); }
      else if (acao === 'd') {
        cfg.automacao = { ...cfg.automacao, das: cfg.automacao?.das === false };
        salvarConfig(cfg);
        log(`  ✓ Lembrete do DAS ${cfg.automacao.das ? 'ligado' : 'desligado'}.`);
      }
    }
    else if (op === '6') await configurarEmail(cfg);
    else if (op === '4' && cred.SUPORTADO) {
      const acao = (await perguntar('  g) guardar/trocar a senha   x) apagar a senha   0) voltar\nEscolha', '0')).toLowerCase();
      if (acao === 'g') await guardarSenha(cfg);
      else if (acao === 'x' && await simOuNao('  Apagar a senha guardada?', 'n')) { cred.apagarCredencial(); log('  ✓ Senha apagada.'); }
    } else log('  Opção inválida.');
  }
  if (!Object.keys(cfg.tomadores).length) log('\nAtenção: sem nenhum cliente cadastrado o `emitir` não funciona.');
}

// Cliente, valor e competência são escolhidos a cada nota: pelas opções ou perguntando no terminal.
async function montarNota(cfg, op) {
  const apelidos = Object.keys(cfg.tomadores);
  if (!apelidos.length) throw new Error('Nenhum cliente cadastrado. Rode: nfse-mei config');
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
  // Primeira vez: faz o cadastro aqui mesmo e segue para a nota (no --sim não há ninguém para responder).
  if (!op.sim && !require('fs').existsSync(ARQUIVO_CONFIG)) {
    log('Primeira vez por aqui: antes da nota, vamos cadastrar seus dados.');
    await init({ seguirParaNota: true });
  }
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
    if (pendentes.length && !op['sem-baixar']) {
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

async function sincronizar(anoArg) {
  const cfg = carregarConfig();
  const hoje = hojeReal();
  const ano = Number(anoArg) || hoje.getFullYear();
  const de = new Date(ano, 0, 1);
  const ate = ano === hoje.getFullYear() ? hoje : new Date(ano, 11, 31);
  log(`Lendo a lista "Notas emitidas" do portal de ${formatarBR(de)} a ${formatarBR(ate)} (só leitura)...`);
  const dados = await require('../src/rotina-real').sincronizarDoPortal(cfg, de, ate, log);
  const doAno = dados.notas.filter(n => n.mes.startsWith(`${ano}-`));
  const canceladas = doAno.filter(n => n.cancelada).length;
  log(`\n✓ ${doAno.length} nota${doAno.length === 1 ? '' : 's'} de ${ano} no portal${canceladas ? ` (${canceladas} cancelada${canceladas > 1 ? 's' : ''}, que não contam)` : ''}.`);
  log('Veja o resumo com: nfse-mei painel');
}

async function agendar(sub) {
  const agenda = require('../src/agenda');
  if (sub === 'remover') return log(agenda.desligar());
  if (sub === 'status') {
    const s = agenda.situacao();
    return log(s.ligada ? `Rotina ligada.${s.proxima ? ` Próxima execução: ${s.proxima}` : ''}${s.detalhe ? `\n! ${s.detalhe}` : ''}` : 'Rotina desligada. Ligue com: nfse-mei agendar');
  }
  const cfg = carregarConfig();
  const mensais = require('../src/rotina').clientesMensais(cfg);
  const cred = require('../src/credencial');
  log(agenda.ligar());
  log('\nA rotina roda sozinha todo dia (9h e a cada 2h até 21h, e quando você liga o computador). Ela:');
  if (mensais.length) {
    for (const [a, t] of mensais) {
      const v = t.mensal.valor ? `R$ ${formatarValor(parseValor(t.mensal.valor))}` : 'valor digitado na hora';
      const quando = t.mensal.dia ? `todo dia ${t.mensal.dia} (nota do mês anterior)` : 'no último dia útil do mês';
      log(`  • nota de ${t.nome || a} (${v}) ${quando}: ${t.mensal.automatico && t.mensal.valor ? 'EMITE SOZINHA e avisa' : 'abre uma janela com o valor para você conferir ou mudar'}`);
    }
  } else {
    log('  • (nenhum cliente com "nota todo mês": ative em nfse-mei config → 3) Clientes → e) editar)');
  }
  if (cfg.automacao?.das !== false) log('  • lembra do DAS nos 5 dias antes do vencimento (dia 20)');
  log('  • avisa quando o faturamento chegar perto do limite do MEI');
  if (mensais.some(([, t]) => t.mensal.automatico) && !cred.temCredencial()) {
    log('\n! Para emitir sozinha, a rotina precisa da senha do emissor guardada: nfse-mei senha');
  }
  log(`\nPara conferir sem emitir nada: nfse-mei rotina --teste\nO que ela fez fica em: ${agenda.LOG}\nPara desligar: nfse-mei agendar remover`);
}

async function configurarEmail(cfg) {
  const email = require('../src/email');
  const cred = require('../src/credencial');
  const e = cfg.email || {};
  log('E-MAIL: o nfse-mei manda a nota para o cliente usando o SEU e-mail (Gmail ou Outlook).');
  log('A senha NÃO é a do seu e-mail: é uma "senha de app", criada só para isso.');
  log('  Gmail: ative a verificação em 2 etapas e crie em https://myaccount.google.com/apppasswords\n');
  const remetente = await perguntarValido('Seu e-mail (remetente)', e.remetente, r => (email.emailValido(r) ? null : 'e-mail inválido'));
  const nome = await perguntar('Seu nome ou nome da empresa (vai na assinatura)', e.nome);
  const copia = await simOuNao('Mandar uma cópia oculta para você mesmo, como comprovante?', e.copiaParaMim === false ? 'n' : 's');
  cfg.email = { ...e, remetente: remetente.trim(), nome, copiaParaMim: copia };
  salvarConfig(cfg);
  if (cred.SUPORTADO && (!cred.temCredencial('email') || await simOuNao('Trocar a senha de app guardada?', 'n'))) {
    log(process.platform === 'darwin'
      ? 'Digite a senha de app (não aparece na tela) e repita para confirmar:'
      : 'Abrindo a janela do Windows: no "Usuário" deixe seu e-mail e na senha cole a SENHA DE APP.');
    cred.salvarCredencial(cfg.email.remetente, 'email');
  }
  if (cred.SUPORTADO && cred.temCredencial('email')) {
    process.stdout.write('Conferindo o login no servidor de e-mail... ');
    try {
      await email.testarLogin(cfg, cred.lerCredencial('email').senha);
      log('✓ funcionou.');
    } catch (err) {
      log(`✗ não entrou (${err.message.split('\n')[0]}). Confira o e-mail e a senha de app: nfse-mei email`);
    }
  }
  const semEmail = Object.entries(cfg.tomadores).filter(([, t]) => !t.email);
  if (semEmail.length && await simOuNao(`\nCadastrar agora o e-mail dos clientes (${semEmail.map(([a]) => a).join(', ')})?`, 's')) {
    for (const [a, t] of semEmail) {
      const r = await perguntarValido(`  E-mail de ${t.nome || a} (vários: separe por vírgula; vazio = não manda)`, '', v => (!v || email.emailsValidos(v) ? null : 'e-mail inválido'));
      if (r) t.email = r;
    }
    salvarConfig(cfg);
  }
  log('\n✓ E-mail configurado. Teste mandando um exemplo para você mesmo: nfse-mei email teste');
}

async function comandoEmail(sub, arg) {
  const cfg = carregarConfig();
  const email = require('../src/email');
  const cred = require('../src/credencial');
  if (!sub) return configurarEmail(cfg);
  if (!cfg.email?.remetente) throw new Error('E-mail ainda não configurado. Rode: nfse-mei email');
  if (!cred.temCredencial('email')) throw new Error('Senha de app não guardada. Rode: nfse-mei email');
  const senha = cred.lerCredencial('email').senha;
  if (sub === 'teste') {
    const exemplo = { email: cfg.email.remetente, nome: 'CLIENTE DE EXEMPLO LTDA', cnpj: '11222333000181' };
    const r = await email.enviarNota({ ...cfg, email: { ...cfg.email, copiaParaMim: false } }, senha, {
      tomador: exemplo, chave: '0'.repeat(50), numero: 'EXEMPLO', centavos: 123456, competencia: formatarBR(ultimoDiaUtil(hojeReal().getFullYear(), hojeReal().getMonth() + 1)),
    });
    return log(`✓ Exemplo enviado para ${r.para.join(', ')}. Veja como o cliente vai receber.`);
  }
  if (sub === 'enviar') {
    const { todasAsNotas } = require('../src/historico');
    const nota = todasAsNotas(cfg).find(n => n.numero === String(Number(arg)) || n.chave === soDigitos(arg));
    if (!nota) throw new Error(`Não achei a nota "${arg || ''}". Use o número da nota (rode nfse-mei sincronizar se ela foi feita no portal).`);
    const t = Object.values(cfg.tomadores).find(x => soDigitos(x.cnpj) === soDigitos(nota.cnpj));
    if (!t?.email) throw new Error('Esse cliente não tem e-mail cadastrado: nfse-mei config → 3) Clientes → e) editar');
    const [aaaa, mm] = nota.mes.split('-');
    const r = await email.enviarNota(cfg, senha, { tomador: t, chave: nota.chave, numero: nota.numero, centavos: nota.centavos, competencia: formatarBR(ultimoDiaUtil(+aaaa, +mm)) });
    return log(`✓ Nota nº ${nota.numero} enviada para ${r.para.join(', ')}.`);
  }
  throw new Error(`Uso: nfse-mei email [teste | enviar <número>]`);
}

// Painel no navegador: o servidor vive enquanto a aba estiver aberta (a página avisa a cada 15s).
async function abrirPainel(op) {
  const { criarServidor } = require('../src/servidor');
  const real = require('../src/rotina-real');
  const cred = require('../src/credencial');
  const email = require('../src/email');
  const { numeroDaChave } = require('../src/historico');
  const logArquivo = msg => require('fs').appendFileSync(require('path').join(require('path').dirname(ARQUIVO_CONFIG), 'rotina.log'), `${new Date().toISOString()}  [painel] ${msg}\n`);
  const painel = criarServidor({
    log: logArquivo,
    emitir: (dados, { teste }) => real.emitirComoSubprocesso(dados, { teste, log: logArquivo }),
    sincronizar: (cfg, de, ate) => real.sincronizarDoPortal(cfg, de, ate, logArquivo),
    testarEmail: cfg => email.testarLogin(cfg, cred.lerCredencial('email').senha),
    emailTeste: async cfg => {
      const r = await email.enviarNota({ ...cfg, email: { ...cfg.email, copiaParaMim: false } }, cred.lerCredencial('email').senha, {
        tomador: { email: cfg.email.remetente, nome: 'CLIENTE DE EXEMPLO LTDA', cnpj: '11222333000181' },
        chave: '0'.repeat(50), numero: 'EXEMPLO', centavos: 123456, competencia: formatarBR(ultimoDiaUtil(hojeReal().getFullYear(), hojeReal().getMonth() + 1)),
      });
      return r.para.join(', ');
    },
    enviarNota: (cfg, apelido, chave, centavos, competencia) => email.enviarNota(cfg, cred.lerCredencial('email').senha,
      { tomador: cfg.tomadores[apelido], chave, numero: numeroDaChave(chave), centavos, competencia }),
  });
  const { url } = await painel.iniciar();
  log('Painel do nfse-mei aberto no seu navegador.');
  log(`Se não abriu, copie este endereço (só funciona neste computador):\n  ${url}`);
  log('\nDeixe este terminal aberto enquanto usa o painel. Ele fecha sozinho quando você fechar a aba (ou Ctrl+C).');
  if (!op['sem-navegador']) require('../src/portal').abrirNoNavegadorPadrao(url);
  await new Promise(resolve => {
    const relogio = setInterval(() => {
      if (Date.now() - painel.ultimaAtividade() > 90000) {
        clearInterval(relogio);
        log('\nAba fechada: painel encerrado.');
        painel.parar().then(resolve);
      }
    }, 5000);
    process.once('SIGINT', () => { clearInterval(relogio); painel.parar().then(resolve); });
  });
}

async function main() {
  const { values: op, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      tomador: { type: 'string' }, valor: { type: 'string' }, competencia: { type: 'string' },
      teste: { type: 'boolean' }, sim: { type: 'boolean' }, homologacao: { type: 'boolean' }, ver: { type: 'boolean' },
      'sem-baixar': { type: 'boolean' }, 'sem-navegador': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const cmd = positionals[0];
  if (op.help || !cmd) return log(AJUDA);
  if (cmd === 'init') return init();
  if (cmd === 'config') return require('fs').existsSync(ARQUIVO_CONFIG) ? menuConfig(carregarConfig()) : init();
  if (cmd === 'emitir') return emitir(op);
  if (cmd === 'doutor') {
    if (!(await require('../src/doutor').doutor())) process.exitCode = 1;
    return;
  }
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
  if (cmd === 'abrir') return abrirPainel(op);
  if (cmd === 'painel') return log(require('../src/painel').textoPainel(carregarConfig()));
  if (cmd === 'relatorio') {
    const ano = Number(positionals[1]) || hojeReal().getFullYear() - 1;
    return log(require('../src/painel').textoRelatorio(carregarConfig(), ano));
  }
  if (cmd === 'sincronizar') return sincronizar(positionals[1]);
  if (cmd === 'rotina') {
    await require('../src/rotina-real').executarRotina({ teste: op.teste, eco: true });
    return;
  }
  if (cmd === 'agendar') return agendar(positionals[1]);
  if (cmd === 'email') return comandoEmail(positionals[1], positionals[2]);
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
