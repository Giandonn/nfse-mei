// Automação do Emissor Nacional da NFS-e (www.nfse.gov.br/EmissorNacional).
// Mapeado na versão 1.6.0.0 do portal. Fluxo: Pessoas -> Serviço -> Valores -> Emitir NFS-e.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { PERFIL_CHROME, AMBIENTES, criarPastaPrivada } = require('./config');
const { formatarValor, soDigitos, formatarCnpj } = require('./valores');

const MINUTOS = 60 * 1000;

// A senha só pode existir no cofre do sistema (src/credencial.js). O gerenciador de senhas do
// Chrome guardaria uma segunda cópia no perfil ao ver o login preenchido, então ele fica
// desligado e qualquer senha que ele já tenha guardado é apagada antes de abrir.
function semGerenciadorDeSenhas(perfil) {
  const pastaDefault = path.join(perfil, 'Default');
  criarPastaPrivada(pastaDefault);
  for (const nome of fs.readdirSync(pastaDefault)) {
    // Arquivo preso = outro Chrome do nfse-mei aberto; o launch abaixo avisa com a mensagem certa.
    if (/^Login Data/i.test(nome)) try { fs.rmSync(path.join(pastaDefault, nome), { force: true }); } catch { /* em uso */ }
  }
  const arqPrefs = path.join(pastaDefault, 'Preferences');
  let prefs = {};
  try { prefs = JSON.parse(fs.readFileSync(arqPrefs, 'utf8')); } catch { /* perfil novo */ }
  prefs.credentials_enable_service = false;
  prefs.credentials_enable_autosignin = false;
  prefs.profile = { ...prefs.profile, password_manager_enabled: false };
  fs.writeFileSync(arqPrefs, JSON.stringify(prefs), { mode: 0o600 });
}

// Por padrão o Chrome roda invisível (headless); `visivel` mostra a janela para acompanhar/depurar.
async function abrirNavegador({ visivel = false } = {}) {
  criarPastaPrivada(PERFIL_CHROME);
  semGerenciadorDeSenhas(PERFIL_CHROME);
  // Perfil próprio: a sessão do portal fica guardada entre execuções enquanto durar.
  const ctx = await chromium.launchPersistentContext(PERFIL_CHROME, {
    channel: 'chrome',
    headless: !visivel,
    viewport: visivel ? null : { width: 1600, height: 1000 },
    args: visivel ? ['--start-maximized'] : [],
  }).catch(e => {
    if (/has been closed|sessão de navegador existente|existing browser session/i.test(e.message)) {
      throw new Error('Já existe um Chrome do nfse-mei aberto. Feche essa janela e rode de novo.');
    }
    throw e;
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('dialog', async d => {
    console.log(`  ! O portal mostrou um alerta: "${d.message()}"`);
    await d.dismiss();
  });
  return { ctx, page };
}

// O portal do governo às vezes trava ou responde "The service is unavailable" (503);
// tenta de novo, esperando cada vez mais, antes de desistir.
const TENTATIVAS = 5;
async function abrirPagina(page, url, log = console.log) {
  for (let tentativa = 1; ; tentativa++) {
    let motivo;
    try {
      const resp = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      if (resp && resp.status() >= 500) {
        motivo = `portal fora do ar (HTTP ${resp.status()})`;
      } else if (!(await page.waitForFunction(() => window.jQuery, null, { timeout: 15000 }).then(() => true, () => false))) {
        // Quando sobrecarregado, o HTML vem mas os scripts/CSS do portal falham.
        motivo = 'portal carregou pela metade (sem scripts)';
      } else {
        return resp;
      }
    } catch {
      motivo = 'portal não respondeu';
    }
    if (tentativa >= TENTATIVAS) throw new Error(`${motivo}: ${url}. Tente de novo mais tarde.`);
    log(`  ${motivo}, tentando de novo em ${tentativa * 5}s (${tentativa}/${TENTATIVAS})...`);
    await page.waitForTimeout(tentativa * 5000);
  }
}

async function garantirLogin(page, base, log) {
  await abrirPagina(page, `${base}/EmissorNacional/Login`, log);
  if (!/\/Login/i.test(new URL(page.url()).pathname)) {
    log('Sessão ainda ativa, pulando o login.');
    return;
  }
  const cred = require('./credencial');
  if (cred.temCredencial()) {
    log('Entrando com CNPJ + senha do emissor...');
    // A senha só é digitada na página de login do próprio portal (nunca num redirecionamento para outro site).
    const aqui = new URL(page.url());
    if (aqui.origin !== new URL(base).origin || !/\/EmissorNacional\/Login/i.test(aqui.pathname)) {
      throw new Error(`Página de login inesperada (${aqui.origin}${aqui.pathname}); por segurança a senha não foi digitada.`);
    }
    const { usuario, senha } = cred.lerCredencial();
    try {
      await page.locator('#Inscricao').fill(soDigitos(usuario));
      await page.locator('#Senha').fill(senha);
    } catch {
      // Mensagem própria: a do Playwright pode trazer detalhes da chamada, e ela vai para o terminal.
      throw new Error('Não consegui preencher o login do portal (a tela mudou?). Rode com --ver para ver.');
    }
    await page.locator('form[action*="Login"] button[type=submit]').click();
    await page.waitForLoadState('domcontentloaded');
    const falhou = page.getByText(/Usuário e\/ou senha inválidos/i);
    if (await falhou.isVisible({ timeout: 5000 }).catch(() => false)) {
      throw new Error('O portal recusou o CNPJ/senha salvos. Rode `nfse-mei senha` para salvar de novo.');
    }
  } else {
    log('Faça o login no Chrome que abriu. Dica: `nfse-mei senha` guarda a senha do emissor e o login fica automático.');
    log('Espero até 10 minutos...');
  }
  await page.waitForURL(u => /\/EmissorNacional\/(Dashboard|DPS|Notas)/i.test(u.pathname), { timeout: 10 * MINUTOS });
  log('Login ok.');
}

async function clicarRadio(page, nome, valor) {
  const radio = page.locator(`input[type=radio][name="${nome}"][value="${valor}"]`);
  if (!(await radio.count())) throw new Error(`Campo ${nome} não encontrado no portal`);
  // Os radios são estilizados; clicar no label é o que dispara os handlers do portal.
  await radio.evaluate(r => (r.closest('label') || r.labels?.[0] || r).click());
  if (!(await radio.isChecked())) await radio.check({ force: true });
  if (!(await radio.isChecked())) throw new Error(`Não consegui marcar ${nome}=${valor}`);
}

// Marca "Não"/"Sim" no grupo de radios cuja pergunta contém `trecho`.
async function clicarRadioPorPergunta(page, trecho, textoOpcao) {
  const alvo = await page.evaluate(([trecho, textoOpcao]) => {
    const radios = [...document.querySelectorAll('input[type=radio]')];
    for (const r of radios) {
      let bloco = r.parentElement;
      for (let i = 0; i < 5 && bloco && !bloco.innerText.toLowerCase().includes(trecho); i++) bloco = bloco.parentElement;
      if (!bloco || !bloco.innerText.toLowerCase().includes(trecho)) continue;
      const rotulo = (r.labels?.[0]?.innerText || r.closest('label')?.innerText || '').trim();
      if (rotulo === textoOpcao) return { nome: r.name, valor: r.value };
    }
    return null;
  }, [trecho.toLowerCase(), textoOpcao]);
  if (!alvo) throw new Error(`Pergunta "${trecho}" não encontrada no portal`);
  await clicarRadio(page, alvo.nome, alvo.valor);
}

const textoSelecionado = select => select.evaluate(s => s.options[s.selectedIndex]?.text || '');

// Select2 com busca remota (município, código de tributação): abre, digita e escolhe a opção.
async function escolherSelect2(page, selectId, busca, textoOpcao) {
  const select = page.locator(`#${selectId}`);
  if ((await textoSelecionado(select)).includes(textoOpcao)) return; // o portal às vezes já traz preenchido
  // O container visual do select2 não é irmão direto do <select>; pega pela instância do jQuery.
  const container = await select.evaluateHandle(s => {
    const inst = window.jQuery && jQuery(s).data('select2');
    return inst ? inst.$container[0].querySelector('.select2-selection') : null;
  });
  const alvo = container.asElement();
  if (!alvo) throw new Error(`Não achei o seletor visual do campo ${selectId}`);
  await alvo.click();
  const campo = page.locator('.select2-container--open .select2-search__field');
  const opcao = page.locator('.select2-container--open .select2-results__option', { hasText: textoOpcao }).first();
  const erroBusca = page.locator('.select2-container--open .select2-results__message', { hasText: /erro/i });
  // A busca é feita no servidor do portal, que às vezes responde 503: redigita e tenta de novo.
  for (let tentativa = 1; ; tentativa++) {
    await campo.fill('');
    await campo.pressSequentially(busca, { delay: 40 });
    const deu = await Promise.race([
      opcao.waitFor({ timeout: 30000 }).then(() => 'ok'),
      erroBusca.waitFor({ timeout: 30000 }).then(() => 'erro'),
    ]).catch(() => 'timeout');
    if (deu === 'ok') break;
    if (tentativa >= TENTATIVAS) throw new Error(`A busca de "${busca}" no portal falhou ${TENTATIVAS} vezes (portal instável).`);
    console.log(`  busca de "${busca}" falhou no portal, tentando de novo em ${tentativa * 3}s (${tentativa}/${TENTATIVAS})...`);
    await page.waitForTimeout(tentativa * 3000);
  }
  await opcao.click();
  const escolhido = await textoSelecionado(select);
  if (!escolhido.includes(textoOpcao)) throw new Error(`Select ${selectId}: esperava "${textoOpcao}", ficou "${escolhido}"`);
}

// Chosen com opções locais (NBS): escolhe pelo início do texto e avisa o plugin.
async function escolherChosen(page, selectId, inicioTexto) {
  const select = page.locator(`#${selectId}`);
  const ok = await select.evaluate((s, inicio) => {
    const opt = [...s.options].find(o => o.text.trim().startsWith(inicio));
    if (!opt) return false;
    s.value = opt.value;
    if (window.jQuery) jQuery(s).trigger('chosen:updated').trigger('change');
    else s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, inicioTexto);
  if (!ok) throw new Error(`Opção "${inicioTexto}" não existe no campo ${selectId}`);
  const escolhido = await textoSelecionado(select);
  if (!escolhido.startsWith(inicioTexto)) throw new Error(`Campo ${selectId}: ficou "${escolhido}"`);
}

async function avancar(page, proximaEtapa) {
  await page.locator('button[type=submit]', { hasText: 'Avançar' }).click();
  try {
    await page.waitForURL(u => u.pathname.includes(proximaEtapa), { timeout: 30000 });
  } catch {
    const erros = await page.locator('.field-validation-error, .validation-summary-errors, .alert-danger').allInnerTexts();
    throw new Error(`O portal não avançou para ${proximaEtapa}. ${erros.filter(Boolean).join(' | ') || 'Veja a tela do Chrome.'}`);
  }
}

async function preencherPessoas(page, base, nota, log) {
  log('Etapa 1/3: Pessoas');
  await abrirPagina(page, `${base}/EmissorNacional/DPS/Pessoas/NovaNFSe`, log);
  await page.waitForURL(u => u.pathname.includes('/DPS/Pessoas'));
  // PRIMEIRO o IBS/CBS: trocar essa opção depois apaga o resto do formulário.
  await clicarRadio(page, 'PreencherInfoIBSCBS', '0');

  const comp = page.locator('#DataCompetencia');
  await comp.fill(nota.competencia);
  await comp.press('Tab');

  const doc = page.locator('#Tomador_Inscricao');
  await doc.click();
  await doc.fill('');
  await doc.pressSequentially(soDigitos(nota.tomador.cnpj), { delay: 40 });
  await page.locator('#btn_Tomador_Inscricao_pesquisar').click();
  await page.waitForFunction(() => document.querySelector('#Tomador_Nome')?.value.trim(), null, { timeout: 30000 });
  const nome = (await page.locator('#Tomador_Nome').inputValue()).trim();
  log(`  tomador: ${nome}`);
  if (nota.tomador.nome && nome.toUpperCase() !== nota.tomador.nome.toUpperCase()) {
    throw new Error(`O CNPJ ${formatarCnpj(nota.tomador.cnpj)} voltou como "${nome}", mas o config diz "${nota.tomador.nome}"`);
  }
  if ((await page.locator('#DataCompetencia').inputValue()) !== nota.competencia) {
    throw new Error('A data de competência não ficou gravada');
  }
  await avancar(page, '/DPS/Servico');
}

async function preencherServico(page, s, log) {
  log('Etapa 2/3: Serviço');
  await escolherSelect2(page, 'LocalPrestacao_CodigoMunicipioPrestacao', s.municipio.split('/')[0], s.municipio);
  await escolherSelect2(page, 'ServicoPrestado_CodigoTributacaoNacional', soDigitos(s.codigoTributacaoNacional), s.codigoTributacaoNacional);
  await clicarRadioPorPergunta(page, 'imunidade, exportação', 'Não');
  await escolherChosen(page, 'ServicoPrestado_CodigoNBS', s.nbs);
  await page.locator('#ServicoPrestado_Descricao').fill(s.descricao);
  await avancar(page, '/DPS/Tributacao');
}

async function preencherValores(page, nota, cfg, log) {
  log('Etapa 3/3: Valores');
  const valor = page.locator('#Valores_ValorServico');
  await valor.click();
  await valor.fill('');
  await valor.pressSequentially(String(nota.centavos), { delay: 40 }); // campo com máscara: digita os centavos
  await valor.press('Tab');
  const ficou = await valor.inputValue();
  if (ficou !== formatarValor(nota.centavos)) throw new Error(`Valor ficou "${ficou}", esperava "${formatarValor(nota.centavos)}"`);
  await clicarRadio(page, 'ValorTributos.TipoValorTributos', String(cfg.tributosAproximados));
  await avancar(page, '/DPS/EmitirNFSe');
}

// Lê a tela de revisão e confere o que importa antes de emitir.
async function conferirRevisao(page, nota) {
  const texto = await page.locator('body').innerText();
  const pegar = rotulo => {
    // Com ":" obrigatório: "Valor líquido da NFS-e" também é título de seção, sem ":".
    const m = new RegExp(`${rotulo}:\\s*\\n\\s*(.+)`).exec(texto);
    return m ? m[1].trim() : '?';
  };
  const resumo = {
    competencia: pegar('Data de Competência'),
    nbs: pegar('Item da NBS correspondente ao serviço/fornecimento prestado'),
    valorLiquido: pegar('Valor líquido da NFS-e'),
  };
  const problemas = [];
  if (resumo.competencia !== nota.competencia) problemas.push(`competência ${resumo.competencia}`);
  if (!texto.includes(formatarCnpj(nota.tomador.cnpj))) problemas.push('CNPJ do tomador não aparece na revisão');
  // Quem emite é a conta logada; confere que é o CNPJ do config (evita emitir com a senha de outra pessoa).
  if (nota.prestadorCnpj && !texto.includes(formatarCnpj(nota.prestadorCnpj))) problemas.push('o CNPJ logado no portal não é o prestadorCnpj do config');
  if (resumo.valorLiquido !== `R$ ${formatarValor(nota.centavos)}`) problemas.push(`valor líquido ${resumo.valorLiquido}`);
  return { resumo, problemas };
}

async function emitirEBaixar(page, base, cfg, nota, log) {
  const botao = page.locator('button, a', { hasText: 'Emitir NFS-e' }).last();
  // Aceita tanto o clique vindo do script quanto um clique manual no Chrome.
  if (nota.clicarEmitir) await botao.click();
  await page.waitForURL(u => /\/DPS\/NFSe$/i.test(u.pathname), { timeout: 15 * MINUTOS });
  const href = await page.locator('#btnDownloadDANFSE').getAttribute('href');
  const chave = /DANFSe\/(\d{50})/.exec(href || '')?.[1];
  if (!chave) throw new Error('Nota emitida, mas não achei a chave de acesso na tela. Baixe o PDF manualmente.');
  log(`Nota emitida! Chave: ${chave}`);

  const { destinoDaNota } = require('./downloads');
  // Registra antes de baixar: se o download falhar, a nota continua existindo.
  const hist = path.join(cfg.pastaNotas, 'historico.csv');
  if (!fs.existsSync(hist)) fs.writeFileSync(hist, 'emitida_em;competencia;tomador;cnpj;valor;chave\n');
  fs.appendFileSync(hist, `${new Date().toISOString()};${nota.competencia};${nota.apelido};${soDigitos(nota.tomador.cnpj)};${formatarValor(nota.centavos)};${chave}\n`);

  const arquivos = {};
  const pendentes = [];
  for (const [tipo, ext, assinatura] of [['DANFSe', 'pdf', '%PDF'], ['NFSe', 'xml', '<']]) {
    const url = linkDownload(base, tipo, chave);
    const resp = await page.context().request.get(url).catch(() => null);
    const corpo = resp && resp.ok() ? await resp.body() : null;
    // O portal pode responder 200 com a página do captcha em vez do arquivo.
    if (!corpo || !corpo.subarray(0, 64).toString('latin1').trimStart().startsWith(assinatura)) {
      pendentes.push({ ext, url });
      continue;
    }
    arquivos[ext] = destinoDaNota(cfg.pastaNotas, nota.competenciaISO, nota.apelido, chave, ext);
    fs.mkdirSync(path.dirname(arquivos[ext]), { recursive: true });
    fs.writeFileSync(arquivos[ext], corpo);
    log(`  salvo: ${arquivos[ext]}`);
  }
  return { chave, arquivos, pendentes };
}

// O download exige hCaptcha ("Validação de usuário") e só é disparado pelo menu da nota na
// lista; o link direto do arquivo dá 403 e a página da nota não tem botão de download.
// Se a pessoa não estiver logada, o portal pede login e volta para a lista sozinho.
const linkNotasEmitidas = base => `${base}/EmissorNacional/Notas/Emitidas`;

const linkDownload = (base, tipo, chave) => `${base}/EmissorNacional/Notas/Download/${tipo}/${chave}`;

function abrirNoNavegadorPadrao(url) {
  if (process.env.NFSE_MEI_NAO_ABRIR) return; // usado nos testes
  const { spawn } = require('child_process');
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
}

module.exports = {
  AMBIENTES, abrirNavegador, garantirLogin, preencherPessoas, preencherServico,
  preencherValores, conferirRevisao, emitirEBaixar, linkNotasEmitidas, abrirNoNavegadorPadrao,
};
