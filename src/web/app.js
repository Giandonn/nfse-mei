// Painel do nfse-mei. Fala só com o servidor local (mesma origem), sempre mandando o código da sessão.
'use strict';

// ---- sessão: o código vem no endereço, vai para a memória da aba e sai da barra de endereço.
const parametros = new URLSearchParams(location.search);
const TOKEN = parametros.get('t') || sessionStorage.getItem('nfse-token') || '';
if (parametros.get('t')) {
  sessionStorage.setItem('nfse-token', TOKEN);
  history.replaceState(null, '', '/');
}

let estado = null;
let aba = sessionStorage.getItem('nfse-aba') || 'inicio';
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cnpjFmt = c => String(c || '').replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const mesFmt = m => { const [a, mm] = m.split('-'); return `${MESES[Number(mm) - 1]}/${a}`; };

async function api(metodo, caminho, corpo) {
  const r = await fetch(caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'X-Nfse-Token': TOKEN },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  let dados = {};
  try { dados = await r.json(); } catch { /* sem corpo */ }
  if (r.status === 403) throw new Error('Sessão expirada. Rode "nfse-mei abrir" de novo no terminal.');
  if (!r.ok && r.status !== 422) throw new Error(dados.erro || `Erro ${r.status}`);
  return dados;
}

let relogioAviso;
function avisar(msg, erro = false) {
  const el = $('#aviso');
  el.textContent = msg;
  el.className = `aviso${erro ? ' erro' : ''}`;
  el.hidden = false;
  clearTimeout(relogioAviso);
  relogioAviso = setTimeout(() => { el.hidden = true; }, erro ? 9000 : 5000);
}

async function recarregar() {
  estado = await api('GET', '/api/estado');
  desenhar();
}

// ---- telas

const ABAS = [
  ['inicio', 'Início'], ['clientes', 'Clientes'], ['dados', 'Meus dados'], ['automacao', 'Automação e e-mail'], ['notas', 'Notas'],
];

function desenhar() {
  $('#versao').textContent = `versão ${estado.versao}`;
  const pil = $('#status-piloto');
  pil.textContent = estado.agenda.ligada ? 'Piloto automático ligado' : 'Piloto automático desligado';
  pil.className = `pilula${estado.agenda.ligada ? ' ligado' : ''}`;
  if (!estado.cfg) {
    $('#abas').innerHTML = '';
    $('#conteudo').innerHTML = telaBoasVindas();
    return;
  }
  $('#abas').innerHTML = ABAS.map(([id, nome]) => `<button type="button" data-aba="${id}" ${id === aba ? 'aria-current="page"' : ''}>${nome}</button>`).join('');
  const telas = { inicio: telaInicio, clientes: telaClientes, dados: telaDados, automacao: telaAutomacao, notas: telaNotas };
  $('#conteudo').innerHTML = (telas[aba] || telaInicio)();
}

function telaInicio() {
  const r = estado.resumo;
  const pct = Math.min(100, r.pct);
  const nivel = r.pct >= 100 ? 'perigo' : r.pct >= 80 || r.mesEstouro ? 'alerta' : '';
  const maior = Math.max(1, ...r.porMes);
  const mesAtual = new Date().getMonth();
  const proximas = estado.proximas;
  return `
  <h1>Olá!</h1>
  <p class="sub">Seu MEI em ${r.ano}, num lugar só.</p>
  <div class="grade">
    <section class="cartao">
      <h2>Faturamento ${r.ano}</h2>
      <div class="numero-grande">R$ ${esc(r.total)} <small>de R$ ${esc(r.limite)}</small></div>
      <div class="barra ${nivel}"><span style="width:${pct.toFixed(1)}%"></span></div>
      <div class="linha-info"><span>${r.pct.toFixed(0)}% do limite do MEI</span><span>ainda cabe R$ ${esc(r.restante)}</span></div>
      ${r.pct >= 100 ? '<div class="faixa perigo">Você passou do limite do MEI. Procure um contador.</div>'
        : r.mesEstouro ? `<div class="faixa alerta">No ritmo atual (projeção R$ ${esc(r.projecao)}), você passa do limite em ${MESES[r.mesEstouro - 1]}.</div>`
        : `<div class="linha-info" style="margin-top:6px"><span>Projeção no ano: R$ ${esc(r.projecao)}</span></div>`}
      <div class="meses">${r.porMes.map((v, i) => `<div class="${i <= mesAtual ? 'cheio' : ''}" style="height:${Math.max(2, (v / maior) * 100)}%" title="${MESES[i]}: R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}"></div>`).join('')}</div>
      <div class="rotulos-meses">${MESES.map(m => `<span>${m}</span>`).join('')}</div>
      ${r.sincronizadoEm ? '' : '<div class="faixa info">Conta só as notas do nfse-mei. <button class="botao" data-acao="sincronizar" style="margin-left:6px">Incluir as do portal</button></div>'}
    </section>

    <section class="cartao">
      <h2>Próximas notas</h2>
      ${proximas.length ? `<ul class="lista">${proximas.map(p => `
        <li><div>
          <div class="titulo">${esc(p.nome)}</div>
          <div class="detalhe">${p.feita ? `Nota nº ${esc(p.feita)} já emitida este mês` : `${esc(p.data)} · ${p.valor ? `R$ ${esc(p.valor)}` : 'valor na hora'}`}</div>
          <div class="chips">${p.feita ? '<span class="chip marca">feita ✓</span>' : p.automatico ? '<span class="chip marca">sai sozinha</span>' : '<span class="chip">1 clique</span>'}${p.email ? '<span class="chip">e-mail</span>' : ''}</div>
        </div></li>`).join('')}</ul>
        ${estado.agenda.ligada ? '' : '<div class="faixa alerta">O piloto automático está desligado: nada disso acontece sozinho. <button class="botao" data-acao="agenda" data-ligar="1">Ligar</button></div>'}`
      : `<p class="detalhe">Nenhum cliente com nota todo mês.</p><button class="botao" data-aba="clientes">Configurar em Clientes</button>`}
    </section>

    <section class="cartao">
      <h2>Próximo DAS</h2>
      <div class="numero-grande">${esc(estado.das.vencimento)}</div>
      <p class="detalhe">${estado.das.dias === 0 ? 'Vence hoje!' : estado.das.dias === 1 ? 'Vence amanhã.' : `Vence em ${estado.das.dias} dias.`} O piloto automático lembra 5 dias antes.</p>
      <a class="botao" href="https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Identificacao" target="_blank" rel="noopener noreferrer">Abrir o PGMEI</a>
    </section>

    <section class="cartao">
      <h2>Ações</h2>
      <p class="detalhe">Emitir uma nota avulsa, conferir tudo sem emitir ou atualizar a lista com o portal.</p>
      <div class="acoes">
        <button class="botao primario" data-acao="abrir-emitir">Emitir uma nota</button>
        <button class="botao" data-acao="sincronizar">Sincronizar com o portal</button>
      </div>
    </section>
  </div>`;
}

function telaClientes() {
  const ts = Object.entries(estado.cfg.tomadores);
  return `
  <h1>Clientes</h1>
  <p class="sub">Para quem você emite nota. Em cada um, escolha se a nota é todo mês, se sai sozinha e para onde vai o e-mail.</p>
  <div class="acoes" style="margin:0 0 16px"><button class="botao primario" data-acao="cliente-novo">+ Adicionar cliente</button></div>
  <div class="pilha">
  ${ts.length ? ts.map(([a, t]) => `
    <section class="cartao">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0">${esc(t.nome || a)}</h2>
          <div class="detalhe" style="color:var(--suave)">${cnpjFmt(t.cnpj)} · apelido <code>${esc(a)}</code></div>
          <div class="chips">
            ${a === estado.cfg.tomadorPadrao ? '<span class="chip">padrão</span>' : ''}
            ${t.mensal?.ativo ? `<span class="chip marca">todo mês${t.mensal.valor ? ` · R$ ${esc(t.mensal.valor)}` : ''}</span>` : ''}
            ${t.mensal?.automatico ? '<span class="chip marca">sai sozinha</span>' : t.mensal?.ativo ? '<span class="chip">1 clique</span>' : ''}
            ${t.email ? `<span class="chip">e-mail: ${esc(t.email)}</span>` : '<span class="chip">sem e-mail</span>'}
          </div>
        </div>
        <div class="acoes" style="margin:0">
          <button class="botao" data-acao="cliente-editar" data-apelido="${esc(a)}">Editar</button>
          ${a === estado.cfg.tomadorPadrao ? '' : `<button class="botao" data-acao="cliente-padrao" data-apelido="${esc(a)}">Tornar padrão</button>`}
        </div>
      </div>
    </section>`).join('') : '<div class="cartao vazio">Nenhum cliente ainda.</div>'}
  </div>`;
}

function campo(nome, rotulo, valor, { ajuda = '', largo = false, tipo = 'text', placeholder = '' } = {}) {
  return `<label class="campo${largo ? ' largo' : ''}">${rotulo}${ajuda ? ` <span class="ajuda">${ajuda}</span>` : ''}
    <input type="${tipo}" name="${nome}" value="${esc(valor)}" placeholder="${esc(placeholder)}" autocomplete="off">
    <span class="erro-campo" data-erro="${nome}"></span></label>`;
}

function interruptor(nome, titulo, explicacao, ligado, extra = '') {
  return `<div class="chave"><div class="texto"><strong>${titulo}</strong><span>${explicacao}</span></div>
    <label class="interruptor"><input type="checkbox" name="${nome}" ${ligado ? 'checked' : ''} ${extra} aria-label="${esc(titulo)}"><span></span></label></div>`;
}

function formCliente(apelido) {
  const t = apelido ? estado.cfg.tomadores[apelido] : {};
  const m = t.mensal || {};
  return `
  <h2 id="modal-titulo">${apelido ? `Editar ${esc(t.nome || apelido)}` : 'Novo cliente'}</h2>
  <form data-form="cliente" data-apelido-atual="${esc(apelido || '')}">
    <div class="campos">
      ${campo('nome', 'Razão social', t.nome, { largo: true, ajuda: '(o nfse-mei confere com o portal)' })}
      ${campo('cnpj', 'CNPJ', t.cnpj ? cnpjFmt(t.cnpj) : '', { placeholder: '00.000.000/0000-00' })}
      ${campo('apelido', 'Apelido', apelido, { ajuda: '(curto, sem espaço)', placeholder: 'acme' })}
      ${campo('email', 'E-mail para receber a nota', t.email, { largo: true, ajuda: '(vários: separe por vírgula; vazio = não manda)', tipo: 'text' })}
    </div>
    <div style="margin-top:16px">
      ${interruptor('mensalAtivo', 'Nota todo mês', 'No último dia útil do mês, o piloto automático cuida da nota deste cliente.', m.ativo)}
      <div class="campos" style="margin:4px 0 8px">${campo('valor', 'Valor fixo por mês (R$)', m.valor, { ajuda: '(vazio = você digita a cada mês)', placeholder: '3.500,00' })}</div>
      ${interruptor('automatico', 'Emitir sozinho, sem perguntar', 'A nota sai sozinha e você recebe um aviso depois. Desligado: aparece uma janela pedindo 1 clique.', m.automatico)}
    </div>
    <span class="erro-campo" data-erro="geral"></span>
    <div class="acoes" style="justify-content:space-between">
      <div>${apelido ? `<button type="button" class="botao perigo" data-acao="cliente-remover" data-apelido="${esc(apelido)}">Remover cliente</button>` : ''}</div>
      <div style="display:flex;gap:8px"><button type="button" class="botao" data-acao="fechar-modal">Cancelar</button><button class="botao primario">Salvar</button></div>
    </div>
  </form>`;
}

function telaDados() {
  const c = estado.cfg;
  const s = c.servico;
  return `
  <h1>Meus dados</h1>
  <p class="sub">Os dados que vão em toda nota. Copie o serviço da sua última nota no portal (Notas emitidas → ⋮ → Visualizar).</p>
  <div class="pilha">
    <section class="cartao">
      <h2>Você (prestador)</h2>
      <form data-form="meus-dados"><div class="campos">
        ${campo('prestadorCnpj', 'Seu CNPJ', cnpjFmt(c.prestadorCnpj), { ajuda: '(o mesmo do login no Emissor Nacional)' })}
        ${campo('pastaNotas', 'Pasta das notas (PDF/XML)', c.pastaNotas)}
      </div><div class="acoes"><button class="botao primario">Salvar</button></div></form>
    </section>
    <section class="cartao">
      <h2>Serviço</h2>
      <form data-form="servico"><div class="campos">
        ${campo('municipio', 'Município da prestação', s.municipio, { placeholder: 'São Paulo/SP' })}
        ${campo('codigoTributacaoNacional', 'Código de Tributação Nacional', s.codigoTributacaoNacional, { placeholder: '01.01.01' })}
        ${campo('nbs', 'Item da NBS', s.nbs, { placeholder: '115022000' })}
        ${campo('descricao', 'Descrição do serviço', s.descricao, { largo: true })}
      </div><div class="acoes"><button class="botao primario">Salvar</button></div></form>
    </section>
    <section class="cartao">
      <h2>Senha do Emissor Nacional</h2>
      ${blocoSenha('emissor')}
    </section>
  </div>`;
}

function blocoSenha(qual) {
  if (!estado.cofre) return '<p class="detalhe">Neste sistema a senha não pode ser guardada: o login fica manual.</p>';
  const tem = estado.senhas[qual];
  const onde = estado.plataforma === 'darwin' ? 'no Keychain do macOS' : 'criptografada pelo Windows';
  const como = estado.plataforma === 'darwin'
    ? 'Ao clicar, digite a senha <b>no terminal</b> onde você abriu o painel.'
    : 'Ao clicar, abre uma janela do Windows para você digitar.';
  const sobre = qual === 'email'
    ? 'É a <b>senha de app</b> do seu e-mail, não a senha normal.'
    : 'Com ela guardada, o login no portal é automático (e o piloto automático consegue emitir).';
  return `<p class="detalhe">${sobre} Ela fica ${onde} e nunca passa por esta página.</p>
    <div class="chips" style="margin-bottom:12px">${tem ? '<span class="chip marca">guardada ✓</span>' : '<span class="chip alerta">não guardada</span>'}</div>
    <p class="detalhe" style="font-size:13px">${como}</p>
    <div class="acoes"><button class="botao primario" data-acao="senha" data-qual="${qual}">${tem ? 'Trocar a senha' : 'Guardar a senha'}</button>
    ${tem ? `<button class="botao perigo" data-acao="senha-apagar" data-qual="${qual}">Apagar</button>` : ''}</div>`;
}

function telaAutomacao() {
  const c = estado.cfg;
  const e = c.email || {};
  const log = estado.log.map(l => l.replace(/^\S+\s+/, '')).join('\n');
  return `
  <h1>Automação e e-mail</h1>
  <p class="sub">Ligue uma vez e o computador cuida da nota do mês, do DAS e do limite do MEI.</p>
  <div class="pilha">
    <section class="cartao">
      <h2>Piloto automático</h2>
      ${interruptor('agenda', 'Rotina diária', `Roda escondida todo dia (9h e a cada 2h até 21h, e quando você liga o computador). ${estado.agenda.proxima ? `Próxima: ${esc(estado.agenda.proxima)}.` : ''}`, estado.agenda.ligada, 'data-acao-troca="agenda"')}
      ${interruptor('das', 'Lembrete do DAS', 'Nos 5 dias antes do vencimento (dia 20), uma vez por dia, até você marcar "Já paguei".', c.automacao?.das !== false, 'data-acao-troca="das"')}
      ${estado.agenda.detalhe ? `<div class="faixa alerta">${esc(estado.agenda.detalhe)}</div>` : ''}
      <p class="detalhe" style="margin-top:12px">Quais clientes têm nota todo mês (e se ela sai sozinha) você escolhe em <button class="botao" data-aba="clientes">Clientes</button></p>
    </section>

    <section class="cartao">
      <h2>E-mail da nota para o cliente</h2>
      <p class="detalhe">Sai do <b>seu</b> e-mail (Gmail ou Outlook), com número, valor, chave de acesso e o link da Consulta Pública oficial, onde o cliente baixa o PDF.</p>
      <form data-form="email"><div class="campos">
        ${campo('remetente', 'Seu e-mail (remetente)', e.remetente, { placeholder: 'voce@gmail.com' })}
        ${campo('nome', 'Seu nome ou empresa (assinatura)', e.nome)}
      </div>
      ${interruptor('copiaParaMim', 'Cópia oculta para mim', 'Você recebe uma cópia de cada e-mail, como comprovante.', e.copiaParaMim !== false)}
      <div class="acoes"><button class="botao primario">Salvar</button></div></form>
    </section>

    ${e.remetente ? `<section class="cartao">
      <h2>Senha de app do e-mail</h2>
      <p class="detalhe">No Gmail: ative a verificação em 2 etapas e crie a senha em <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">myaccount.google.com/apppasswords</a>.</p>
      ${blocoSenha('email')}
      ${estado.senhas.email ? '<div class="acoes"><button class="botao" data-acao="email-teste">Mandar um e-mail de teste para mim</button></div>' : ''}
    </section>` : ''}

    <section class="cartao">
      <h2>O que a rotina fez</h2>
      ${log ? `<pre class="log">${esc(log)}</pre>` : '<p class="detalhe">Ainda não rodou.</p>'}
    </section>
  </div>`;
}

function telaNotas() {
  const ns = estado.notas;
  return `
  <h1>Notas</h1>
  <p class="sub">As últimas notas (do nfse-mei e, depois de sincronizar, também as feitas no portal).</p>
  <section class="cartao">
    <div class="acoes" style="margin:0 0 12px"><button class="botao" data-acao="sincronizar">Sincronizar com o portal</button></div>
    ${ns.length ? `<table><thead><tr><th>Nº</th><th>Competência</th><th>Cliente</th><th style="text-align:right">Valor</th></tr></thead><tbody>
      ${ns.map(n => `<tr class="${n.cancelada ? 'cancelada' : ''}" title="${esc(n.chave)}"><td>${esc(n.numero)}</td><td>${esc(mesFmt(n.mes))}</td><td>${esc(n.cliente)}${n.cancelada ? ' (cancelada)' : ''}</td><td class="num">R$ ${esc(n.valor)}</td></tr>`).join('')}
    </tbody></table>` : '<p class="vazio">Nenhuma nota ainda.</p>'}
  </section>`;
}

function telaBoasVindas() {
  return `
  <h1>Bem-vindo ao nfse-mei</h1>
  <p class="sub">Cadastre seus dados uma vez. Depois dá para mudar tudo aqui no painel.</p>
  <form data-form="inicial">
    <ol class="passos">
      <li><section class="cartao"><h2>Você (prestador)</h2><div class="campos">
        ${campo('prestadorCnpj', 'Seu CNPJ', '', { ajuda: '(o mesmo do login no Emissor Nacional)', placeholder: '00.000.000/0000-00' })}
        ${campo('pastaNotas', 'Pasta das notas', '~/Documents/NFSe')}
      </div></section></li>
      <li><section class="cartao"><h2>Serviço</h2><p class="detalhe">Copie da sua última nota no portal (Notas emitidas → ⋮ → Visualizar).</p><div class="campos">
        ${campo('municipio', 'Município da prestação', '', { placeholder: 'São Paulo/SP' })}
        ${campo('codigoTributacaoNacional', 'Código de Tributação Nacional', '', { placeholder: '01.01.01' })}
        ${campo('nbs', 'Item da NBS', '', { placeholder: '115022000' })}
        ${campo('descricao', 'Descrição do serviço', '', { largo: true, placeholder: 'Análise e desenvolvimento de sistemas' })}
      </div></section></li>
      <li><section class="cartao"><h2>Seu primeiro cliente</h2><div class="campos">
        ${campo('nome', 'Razão social', '', { largo: true })}
        ${campo('cnpj', 'CNPJ', '', { placeholder: '00.000.000/0000-00' })}
        ${campo('apelido', 'Apelido', '', { ajuda: '(curto, sem espaço)', placeholder: 'acme' })}
      </div></section></li>
    </ol>
    <span class="erro-campo" data-erro="geral"></span>
    <div class="acoes"><button class="botao primario">Salvar e continuar</button></div>
  </form>`;
}

function formEmitir() {
  const ts = Object.entries(estado.cfg.tomadores);
  const padrao = estado.cfg.tomadorPadrao || ts[0]?.[0];
  const hoje = new Date();
  const ud = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  while ([0, 6].includes(ud.getDay())) ud.setDate(ud.getDate() - 1);
  const comp = ud.toLocaleDateString('pt-BR');
  const valorPadrao = estado.cfg.tomadores[padrao]?.mensal?.valor || '';
  return `
  <h2 id="modal-titulo">Emitir uma nota</h2>
  <form data-form="emitir">
    <div class="campos">
      <label class="campo largo">Cliente<select name="apelido">${ts.map(([a, t]) => `<option value="${esc(a)}" ${a === padrao ? 'selected' : ''}>${esc(t.nome || a)} (${cnpjFmt(t.cnpj)})</option>`).join('')}</select><span class="erro-campo" data-erro="apelido"></span></label>
      ${campo('valor', 'Valor (R$)', valorPadrao, { placeholder: '3.500,00' })}
      ${campo('competencia', 'Competência', comp, { placeholder: 'DD/MM/AAAA', ajuda: '(confira feriados)' })}
    </div>
    <div style="margin-top:8px">${interruptor('enviarEmail', 'Mandar por e-mail para o cliente', 'Se o cliente e o seu e-mail estiverem configurados.', true)}</div>
    <div class="faixa info">"Testar" faz tudo no portal (login, preencher, conferir) e <b>para antes de emitir</b>. Leva cerca de 1 minuto.</div>
    <span class="erro-campo" data-erro="geral"></span>
    <div class="acoes" style="justify-content:space-between">
      <button type="button" class="botao" data-acao="fechar-modal">Cancelar</button>
      <div style="display:flex;gap:8px"><button type="button" class="botao" data-acao="emitir-teste">Testar sem emitir</button><button type="button" class="botao primario" data-acao="emitir-confirmar">Emitir de verdade…</button></div>
    </div>
  </form>`;
}

// ---- modal

function abrirModal(html) {
  $('#modal-corpo').innerHTML = html;
  $('#modal').hidden = false;
  $('#modal-corpo').querySelector('input, select, button')?.focus();
}
function fecharModal() { $('#modal').hidden = true; $('#modal-corpo').innerHTML = ''; }

function mostrarErros(form, erros) {
  form.querySelectorAll('[data-erro]').forEach(el => { el.textContent = ''; });
  form.querySelectorAll('.invalido').forEach(el => el.classList.remove('invalido'));
  for (const [k, msg] of Object.entries(erros || {})) {
    const alvo = form.querySelector(`[data-erro="${k}"]`) || form.querySelector('[data-erro="geral"]');
    if (alvo) alvo.textContent = msg;
    form.querySelector(`[name="${k}"]`)?.classList.add('invalido');
  }
  form.querySelector('.invalido')?.focus();
}

const dadosDe = form => Object.fromEntries([...form.elements].filter(e => e.name).map(e => [e.name, e.type === 'checkbox' ? e.checked : e.value]));

async function ocupar(botao, texto, fn) {
  const antes = botao?.textContent;
  if (botao) { botao.disabled = true; botao.textContent = texto; }
  try { return await fn(); } finally { if (botao) { botao.disabled = false; botao.textContent = antes; } }
}

// ---- eventos (sem JavaScript inline: a política de segurança da página proíbe)

document.addEventListener('click', async ev => {
  const alvo = ev.target.closest('[data-aba], [data-acao]');
  if (!alvo) return;
  if (alvo.dataset.aba) {
    aba = alvo.dataset.aba;
    sessionStorage.setItem('nfse-aba', aba);
    fecharModal();
    return desenhar();
  }
  const acao = alvo.dataset.acao;
  try {
    if (acao === 'fechar-modal') return fecharModal();
    if (acao === 'cliente-novo') return abrirModal(formCliente(''));
    if (acao === 'cliente-editar') return abrirModal(formCliente(alvo.dataset.apelido));
    if (acao === 'cliente-padrao') { await api('POST', '/api/clientes/padrao', { apelido: alvo.dataset.apelido }); avisar('Cliente padrão atualizado.'); return recarregar(); }
    if (acao === 'cliente-remover') {
      if (!confirm('Remover este cliente? As notas já emitidas para ele não mudam.')) return;
      await api('POST', '/api/clientes/remover', { apelido: alvo.dataset.apelido });
      fecharModal(); avisar('Cliente removido.'); return recarregar();
    }
    if (acao === 'agenda') {
      const r = await ocupar(alvo, 'Ligando…', () => api('POST', '/api/agenda', { ligar: true }));
      avisar(r.mensagem || 'Piloto automático ligado.'); return recarregar();
    }
    if (acao === 'sincronizar') {
      avisar('Lendo a lista de notas do portal… (pode levar 1 a 2 minutos)');
      const r = await ocupar(alvo, 'Sincronizando…', () => api('POST', '/api/sincronizar'));
      avisar(r.mensagem); return recarregar();
    }
    if (acao === 'senha') {
      avisar(estado.plataforma === 'darwin' ? 'Digite a senha no terminal onde o painel foi aberto…' : 'Abri uma janela do Windows: digite a senha nela.');
      const r = await ocupar(alvo, 'Esperando a senha…', () => api('POST', '/api/senha', { qual: alvo.dataset.qual }));
      if (r.erros) avisar(Object.values(r.erros)[0], true);
      else avisar(r.aviso || 'Senha guardada no cofre do sistema.', Boolean(r.aviso));
      return recarregar();
    }
    if (acao === 'senha-apagar') {
      if (!confirm('Apagar a senha guardada?')) return;
      await api('POST', '/api/senha', { qual: alvo.dataset.qual, apagar: true });
      avisar('Senha apagada.'); return recarregar();
    }
    if (acao === 'email-teste') {
      const r = await ocupar(alvo, 'Enviando…', () => api('POST', '/api/email/teste'));
      return avisar(r.mensagem);
    }
    if (acao === 'abrir-emitir') return abrirModal(formEmitir());
    if (acao === 'emitir-teste' || acao === 'emitir-confirmar' || acao === 'emitir-de-verdade') {
      const form = alvo.closest('form');
      const d = dadosDe(form);
      if (acao === 'emitir-confirmar') {
        const nome = form.querySelector('select[name=apelido]').selectedOptions[0].textContent;
        form.dataset.confirmando = '1';
        form.querySelector('.acoes').outerHTML = `<div class="faixa perigo"><b>Isto emite uma nota fiscal de verdade.</b><br>R$ ${esc(d.valor)} para ${esc(nome)}, competência ${esc(d.competencia)}.<br>Digite <b>EMITIR</b> para confirmar:</div>
          <label class="campo" style="margin-top:8px"><input type="text" name="confirmacao" autocomplete="off"><span class="erro-campo" data-erro="confirmacao"></span></label>
          <div class="acoes" style="justify-content:space-between"><button type="button" class="botao" data-acao="fechar-modal">Cancelar</button><button type="button" class="botao perigo cheio" data-acao="emitir-de-verdade">Emitir agora</button></div>`;
        return form.querySelector('[name=confirmacao]').focus();
      }
      const teste = acao === 'emitir-teste';
      avisar(teste ? 'Entrando no portal e preenchendo (sem emitir)…' : 'Emitindo no portal…');
      const r = await ocupar(alvo, teste ? 'Testando…' : 'Emitindo…', () => api('POST', '/api/emitir', { ...d, teste }));
      if (r.erros) return mostrarErros(form, r.erros);
      avisar(r.mensagem, !r.ok);
      if (r.ok && !teste) { fecharModal(); recarregar(); }
    }
  } catch (e) {
    avisar(e.message, true);
  }
});

document.addEventListener('change', async ev => {
  const el = ev.target;
  try {
    if (el.dataset.acaoTroca === 'agenda') {
      el.disabled = true;
      const r = await api('POST', '/api/agenda', { ligar: el.checked });
      avisar(el.checked ? 'Piloto automático ligado.' : 'Piloto automático desligado.');
      if (r.mensagem && /Linux|crontab/.test(r.mensagem)) avisar(r.mensagem, true);
      return recarregar();
    }
    if (el.dataset.acaoTroca === 'das') {
      await api('PUT', '/api/automacao', { das: el.checked });
      avisar(el.checked ? 'Lembrete do DAS ligado.' : 'Lembrete do DAS desligado.');
      return recarregar();
    }
    if (el.name === 'mensalAtivo' || el.name === 'automatico') ajustarFormCliente(el.closest('form'));
    if (el.name === 'apelido' && el.closest('form')?.dataset.form === 'emitir') {
      const v = estado.cfg.tomadores[el.value]?.mensal?.valor;
      if (v) el.closest('form').querySelector('[name=valor]').value = v;
    }
  } catch (e) {
    avisar(e.message, true);
    recarregar();
  }
});

// Sem "nota todo mês", não faz sentido valor fixo nem emissão automática.
function ajustarFormCliente(form) {
  if (!form || form.dataset.form !== 'cliente') return;
  const ativo = form.elements.mensalAtivo.checked;
  form.elements.valor.disabled = !ativo;
  form.elements.automatico.disabled = !ativo;
  if (!ativo) form.elements.automatico.checked = false;
}
new MutationObserver(() => ajustarFormCliente($('#modal-corpo form[data-form=cliente]'))).observe($('#modal-corpo'), { childList: true });

document.addEventListener('submit', async ev => {
  ev.preventDefault();
  const form = ev.target;
  const d = dadosDe(form);
  const botao = form.querySelector('button.primario');
  try {
    let r;
    const tipo = form.dataset.form;
    if (tipo === 'cliente') {
      r = await ocupar(botao, 'Salvando…', () => api('POST', '/api/clientes', {
        apelidoAtual: form.dataset.apelidoAtual, apelido: d.apelido, cnpj: d.cnpj, nome: d.nome, email: d.email,
        mensal: { ativo: d.mensalAtivo, valor: d.valor || '', automatico: d.automatico },
      }));
    } else if (tipo === 'meus-dados') r = await ocupar(botao, 'Salvando…', () => api('PUT', '/api/meus-dados', d));
    else if (tipo === 'servico') r = await ocupar(botao, 'Salvando…', () => api('PUT', '/api/servico', d));
    else if (tipo === 'email') r = await ocupar(botao, 'Salvando…', () => api('PUT', '/api/email', d));
    else if (tipo === 'inicial') {
      r = await ocupar(botao, 'Salvando…', () => api('POST', '/api/cadastro-inicial', {
        prestador: { prestadorCnpj: d.prestadorCnpj, pastaNotas: d.pastaNotas },
        servico: { municipio: d.municipio, codigoTributacaoNacional: d.codigoTributacaoNacional, nbs: d.nbs, descricao: d.descricao },
        cliente: { nome: d.nome, cnpj: d.cnpj, apelido: d.apelido },
      }));
    } else return;
    if (r.erros) return mostrarErros(form, r.erros);
    avisar('Salvo.');
    fecharModal();
    if (tipo === 'inicial') { aba = 'dados'; avisar('Cadastro feito! Agora guarde a senha do Emissor Nacional.'); }
    recarregar();
  } catch (e) {
    avisar(e.message, true);
  }
});

$('#modal').addEventListener('click', ev => { if (ev.target.id === 'modal') fecharModal(); });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !$('#modal').hidden) fecharModal(); });

// Avisa o servidor que a aba continua aberta (ele se desliga sozinho quando você fecha).
setInterval(() => { api('POST', '/api/ping').catch(() => {}); }, 15000);

recarregar().catch(e => { $('#conteudo').innerHTML = `<div class="cartao"><h2>Não consegui abrir o painel</h2><p>${esc(e.message)}</p></div>`; });
