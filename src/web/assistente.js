// Passo a passo do primeiro uso: senha do emissor -> o nfse-mei lê o portal e sugere o cadastro ->
// a pessoa confere -> e-mail (opcional) -> piloto automático -> pronto.
// Usa as funções do app.js (api, campo, interruptor, avisar...): elas só são chamadas depois que ele carrega.
'use strict';

const PASSOS = [['acesso', 'Acesso ao portal'], ['dados', 'Seus dados'], ['clientes', 'Clientes'], ['email', 'E-mail'], ['piloto', 'Piloto automático'], ['pronto', 'Pronto']];

// O que foi lido/digitado antes de salvar fica na memória da aba (sobrevive a um recarregar da página).
let as = (() => { try { return JSON.parse(sessionStorage.getItem('nfse-assistente')) || {}; } catch { return {}; } })();
const guardarAs = () => { try { sessionStorage.setItem('nfse-assistente', JSON.stringify(as)); } catch { /* sem armazenamento */ } };
const irPara = passo => { as.passo = passo; guardarAs(); desenhar(); window.scrollTo(0, 0); };

function emAssistente() {
  return !estado.cfg || Boolean(estado.cfg.assistente?.emAndamento);
}

// Em que passo a pessoa está, olhando o que já foi feito.
function passoAtual() {
  if (!estado.cfg) {
    if (!estado.cofre && (!as.passo || as.passo === 'acesso')) return 'dados';
    return ['acesso', 'dados', 'clientes'].includes(as.passo) ? as.passo : 'acesso';
  }
  if (['email', 'piloto', 'pronto'].includes(as.passo)) return as.passo;
  if (precisaEmail() && !estado.senhas.email && !estado.cfg.assistente?.pulouEmail) return 'email';
  return estado.agenda.ligada ? 'pronto' : 'piloto';
}
const precisaEmail = () => Object.values(estado.cfg?.tomadores || {}).some(t => t.email);

function telaAssistente() {
  const passo = passoAtual();
  const visiveis = PASSOS.filter(([id]) => id !== 'email' || !estado.cfg || precisaEmail() || passo === 'email');
  const n = visiveis.findIndex(([id]) => id === passo);
  const telas = { acesso: passoAcesso, dados: passoDados, clientes: passoClientes, email: passoEmail, piloto: passoPiloto, pronto: passoPronto };
  return `
  <ol class="progresso" aria-label="Passos">${visiveis.map(([id, nome], i) => `<li class="${i < n ? 'feito' : i === n ? 'atual' : ''}" ${i === n ? 'aria-current="step"' : ''}>${esc(nome)}</li>`).join('')}</ol>
  ${telas[passo]()}`;
}

function passoAcesso() {
  const tem = estado.senhas.emissor;
  const onde = estado.plataforma === 'darwin' ? 'no Keychain do Mac' : 'no cofre do Windows';
  return `
  <h1>Vamos deixar tudo pronto</h1>
  <p class="sub">Leva uns 5 minutos. Começa pela senha do Emissor Nacional: com ela, eu leio as notas que você já emitiu e preencho o resto sozinho.</p>
  <div class="pilha">
    <section class="cartao">
      <h2>Seu acesso ao Emissor Nacional</h2>
      <form data-form="as-acesso">
        <div class="campos">${campo('cnpj', 'CNPJ do seu MEI', as.cnpj || '', { placeholder: '00.000.000/0000-00', ajuda: '(o mesmo do login no portal)' })}</div>
        <p class="detalhe">Ao clicar, ${estado.plataforma === 'darwin' ? 'digite a senha <b>no terminal</b> onde você abriu o nfse-mei' : 'abre uma janela do Windows para você digitar a senha'}. Ela fica guardada ${onde} e nunca passa por esta página.</p>
        <span class="erro-campo" data-erro="geral"></span>
        <div class="acoes">
          <button class="botao primario">${tem ? 'Trocar a senha' : 'Guardar a senha e continuar'}</button>
          ${tem ? '<button type="button" class="botao primario" data-acao="as-importar">Ler minhas notas no portal</button>' : ''}
        </div>
      </form>
      ${as.erroImportar ? `<div class="faixa ${as.semChrome ? 'alerta' : 'perigo'}">${esc(as.erroImportar)}${as.semChrome ? ' <a class="botao" href="https://www.google.com/chrome/" target="_blank" rel="noopener noreferrer">Baixar o Chrome</a>' : ''}</div>` : ''}
    </section>
    <section class="cartao">
      <h2>Ainda não tem senha do Emissor Nacional?</h2>
      <p class="detalhe">Muita gente só entra pelo gov.br. O nfse-mei precisa da senha própria do emissor (o gov.br pede captcha, que um programa não consegue resolver).</p>
      <ol class="lista-passos">
        <li>Abra o <a href="https://www.nfse.gov.br/EmissorNacional/Acesso/PrimeiroAcesso" target="_blank" rel="noopener noreferrer">Primeiro acesso do Emissor Nacional</a> e cadastre uma senha para o seu CNPJ.</li>
        <li>Esqueceu a senha? Use <a href="https://www.nfse.gov.br/EmissorNacional/Acesso/RedefinirSenha" target="_blank" rel="noopener noreferrer">Esqueci a minha senha</a>.</li>
        <li>Volte aqui e clique em <b>Guardar a senha</b>.</li>
      </ol>
      <div class="acoes"><button type="button" class="botao" data-acao="as-manual">Prefiro preencher tudo à mão</button></div>
    </section>
  </div>`;
}

function passoDados() {
  const s = as.servico || {};
  const veio = Boolean(as.servico) && as.importou;
  return `
  <h1>Confira seus dados</h1>
  <p class="sub">${veio ? 'Peguei da sua última nota no portal. Se estiver tudo certo, é só continuar.' : 'Copie da sua última nota no portal (Notas emitidas → ⋮ → Visualizar → aba Serviço).'}</p>
  <form data-form="as-dados" class="pilha">
    <section class="cartao">
      <h2>Você ${veio ? '<span class="chip marca">do portal ✓</span>' : ''}</h2>
      <div class="campos">
        ${campo('prestadorCnpj', 'Seu CNPJ', cnpjFmt(as.prestador?.prestadorCnpj || as.cnpj || ''), { placeholder: '00.000.000/0000-00' })}
        ${campo('pastaNotas', 'Pasta das notas (PDF/XML)', as.prestador?.pastaNotas || '~/Documents/NFSe')}
      </div>
    </section>
    <section class="cartao">
      <h2>O serviço que você presta ${veio ? '<span class="chip marca">do portal ✓</span>' : ''}</h2>
      <div class="campos">
        ${campo('municipio', 'Município da prestação', s.municipio, { placeholder: 'São Paulo/SP' })}
        ${campo('codigoTributacaoNacional', 'Código de Tributação Nacional', s.codigoTributacaoNacional, { placeholder: '01.01.01' })}
        ${campo('nbs', 'Item da NBS', s.nbs, { placeholder: '115022000' })}
        ${campo('descricao', 'Descrição do serviço', s.descricao, { largo: true, placeholder: 'Análise e desenvolvimento de sistemas' })}
      </div>
    </section>
    <span class="erro-campo" data-erro="geral"></span>
    <div class="acoes" style="justify-content:space-between">
      <button type="button" class="botao" data-acao="as-voltar" data-para="acesso">Voltar</button>
      <button class="botao primario">Continuar</button>
    </div>
  </form>`;
}

function cartaoCliente(c, i) {
  const m = c.mensal || {};
  const p = `clientes.${i}`;
  return `
  <section class="cartao cliente-as" data-i="${i}">
    <div class="chave" style="border:0;padding-top:0">
      <div class="texto"><strong>${esc(c.nome || 'Novo cliente')}</strong><span>${c.notas ? `${c.notas} nota${c.notas > 1 ? 's' : ''} nos últimos meses · última de R$ ${esc(c.ultimoValor)}` : 'Digite o CNPJ: eu busco o nome na Receita.'}</span></div>
      <label class="interruptor"><input type="checkbox" name="${p}.incluir" ${c.incluir !== false ? 'checked' : ''} aria-label="Incluir este cliente"><span></span></label>
    </div>
    <div class="corpo-cliente" ${c.incluir === false ? 'hidden' : ''}>
      <div class="campos">
        ${campo(`${p}.cnpj`, 'CNPJ', c.cnpj ? cnpjFmt(c.cnpj) : '', { placeholder: '00.000.000/0000-00' })}
        ${campo(`${p}.nome`, 'Razão social', c.nome, { largo: true })}
        ${campo(`${p}.email`, 'E-mail para receber a nota', c.email, { largo: true, ajuda: '(opcional; vários: separe por vírgula)' })}
        ${campo(`${p}.apelido`, 'Apelido', c.apelido, { ajuda: '(curto, sem espaço)' })}
      </div>
      <div style="margin-top:12px">
        ${interruptor(`${p}.mensalAtivo`, 'Nota todo mês', 'No último dia útil do mês, o nfse-mei cuida da nota deste cliente.', m.ativo)}
        <div class="campos" style="margin:4px 0 8px">${campo(`${p}.valor`, 'Valor por mês (R$)', m.valor, { placeholder: '3.500,00', ajuda: '(vazio = você digita a cada mês)' })}</div>
        <fieldset class="escolha" ${m.ativo ? '' : 'disabled'}>
          <legend>Na hora da nota</legend>
          <label><input type="radio" name="${p}.modo" value="pergunta" ${m.automatico ? '' : 'checked'}> <span><b>Me pergunte antes</b> (recomendado): aparece uma janela com o valor, você confere e clica em Emitir.</span></label>
          <label><input type="radio" name="${p}.modo" value="sozinho" ${m.automatico ? 'checked' : ''}> <span><b>Emita sozinho</b>: a nota sai e você recebe um aviso. Valor fora do comum ou acima do limite do MEI sempre pergunta.</span></label>
        </fieldset>
      </div>
    </div>
  </section>`;
}

function passoClientes() {
  if (!as.clientes?.length) as.clientes = [{ incluir: true, mensal: { ativo: true } }];
  return `
  <h1>Para quem você emite nota</h1>
  <p class="sub">${as.importou && as.clientes.some(c => c.notas) ? 'Estes são os clientes das suas notas no portal. Ligue os que entram no nfse-mei.' : 'Cadastre seus clientes. Dá para adicionar e mudar depois no painel.'}</p>
  <form data-form="as-clientes" class="pilha">
    ${as.clientes.map(cartaoCliente).join('')}
    <div><button type="button" class="botao" data-acao="as-cliente-novo">+ Adicionar cliente</button></div>
    <span class="erro-campo" data-erro="geral"></span>
    <div class="acoes" style="justify-content:space-between">
      <button type="button" class="botao" data-acao="as-voltar" data-para="dados">Voltar</button>
      <button class="botao primario">Salvar e continuar</button>
    </div>
  </form>`;
}

function passoEmail() {
  const e = estado.cfg.email || {};
  const dominio = (e.remetente || '').split('@')[1] || '';
  const microsoft = /outlook|hotmail|live\.|msn\./i.test(dominio);
  const destinos = Object.values(estado.cfg.tomadores).filter(t => t.email).map(t => t.email).join(', ');
  return `
  <h1>Mandar a nota por e-mail</h1>
  <p class="sub">Quando a nota sair, o nfse-mei manda para ${esc(destinos)} com número, valor, chave e o link oficial do PDF. Sai do <b>seu</b> e-mail.</p>
  <div class="pilha">
    <section class="cartao">
      <h2>1. Seu e-mail</h2>
      <form data-form="as-email"><div class="campos">
        ${campo('remetente', 'Seu e-mail', e.remetente, { placeholder: 'voce@gmail.com' })}
        ${campo('nome', 'Assinatura (seu nome ou empresa)', e.nome)}
      </div>
      ${microsoft ? '<div class="faixa alerta">Hotmail/Outlook pessoal não aceita mais programas mandando e-mail com senha. Use um Gmail (pode ser um só para isso).</div>' : ''}
      <div class="acoes"><button class="botao ${e.remetente ? '' : 'primario'}">${e.remetente ? 'Salvar' : 'Continuar'}</button></div></form>
    </section>
    ${e.remetente ? `
    <section class="cartao">
      <h2>2. Senha de app do Gmail</h2>
      <p class="detalhe">Não é a senha normal do e-mail: é uma senha só para o nfse-mei, que você cria no Google e pode apagar quando quiser.</p>
      <ol class="lista-passos">
        <li>Ative a <a href="https://myaccount.google.com/signinoptions/twosv" target="_blank" rel="noopener noreferrer">verificação em duas etapas</a> (sem ela, o Google diz "a configuração não está disponível").</li>
        <li>Abra <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">Senhas de app</a>, confira se está na conta <b>${esc(e.remetente)}</b> (foto no canto de cima), digite <code>nfse-mei</code> e clique em <b>Criar</b>.</li>
        <li>Copie a senha de 16 letras e clique em <b>Guardar a senha de app</b> aqui embaixo.</li>
      </ol>
      <div class="faixa info">O Google mostrou <b>"Verifique se é você"</b> e não deixou continuar? Acontece logo depois de ligar a verificação em duas etapas. Tente pelo celular (onde a conta já está), no Wi-Fi de casa, ou espere algumas horas e tente de novo. Enquanto isso, pule este passo: dá para terminar depois em <b>Automação e e-mail</b>.</div>
      <div class="chips" style="margin:12px 0">${estado.senhas.email ? '<span class="chip marca">senha guardada ✓</span>' : '<span class="chip alerta">senha não guardada</span>'}</div>
      <div class="acoes">
        <button class="botao ${estado.senhas.email ? '' : 'primario'}" data-acao="senha" data-qual="email">${estado.senhas.email ? 'Trocar a senha de app' : 'Guardar a senha de app'}</button>
        ${estado.senhas.email ? '<button class="botao" data-acao="email-teste">Mandar um e-mail de teste para mim</button>' : ''}
      </div>
    </section>` : ''}
    <div class="acoes" style="justify-content:space-between">
      <button type="button" class="botao" data-acao="as-pular-email">Pular por agora</button>
      <button type="button" class="botao primario" data-acao="as-ir" data-para="piloto" ${estado.senhas.email ? '' : 'disabled'}>Continuar</button>
    </div>
  </div>`;
}

function passoPiloto() {
  const mensais = Object.values(estado.cfg.tomadores).filter(t => t.mensal?.ativo);
  return `
  <h1>Piloto automático</h1>
  <p class="sub">Uma tarefa escondida roda todo dia (9h e a cada 2h até 21h, e quando você liga o computador). Ela não abre nada se não houver o que fazer.</p>
  <section class="cartao">
    <ul class="lista-check">
      ${mensais.length ? `<li><b>Nota do mês</b>: ${mensais.map(t => `${esc(t.nome)} (${t.mensal.automatico ? 'sai sozinha' : 'pergunta antes'})`).join(', ')}.</li>` : ''}
      <li><b>Nunca duplica</b>: antes de emitir, confere no portal se a nota do mês já existe.</li>
      <li><b>DAS</b>: lembra nos 5 dias antes do vencimento (dia 20).</li>
      <li><b>Limite do MEI</b>: avisa antes de uma nota passar do limite do ano.</li>
    </ul>
    <div class="acoes" style="justify-content:space-between">
      <button type="button" class="botao" data-acao="as-ir" data-para="pronto">Agora não</button>
      <button type="button" class="botao primario" data-acao="as-ligar-piloto">Ligar o piloto automático</button>
    </div>
  </section>`;
}

function passoPronto() {
  const pend = estado.pendencias || [];
  const ts = Object.values(estado.cfg.tomadores);
  return `
  <h1>${pend.some(p => p.grave) ? 'Quase lá' : 'Tudo pronto ✓'}</h1>
  <p class="sub">${pend.length ? 'Ficou faltando pouca coisa. Dá para resolver agora ou depois, pelo painel.' : 'Daqui para a frente o nfse-mei cuida de tudo. Você só vê a janela de confirmação no dia da nota.'}</p>
  <div class="pilha">
    <section class="cartao">
      <h2>O que ficou configurado</h2>
      <ul class="lista-check">
        <li class="ok">Senha do Emissor Nacional ${estado.senhas.emissor ? 'guardada' : '<b>não guardada</b>'}</li>
        <li class="ok">${ts.length} cliente${ts.length > 1 ? 's' : ''}: ${ts.map(t => esc(t.nome)).join(', ')}</li>
        ${(estado.proximas || []).map(p => `<li class="ok">${p.feita ? `Nota de ${esc(p.nome)} deste mês já emitida (nº ${esc(p.feita)})` : `Próxima nota de ${esc(p.nome)}: ${esc(p.data)}${p.valor ? ` · R$ ${esc(p.valor)}` : ''} · ${p.automatico ? 'sai sozinha' : 'pergunta antes'}`}</li>`).join('')}
        ${estado.agenda.ligada && !estado.agenda.detalhe ? '<li class="ok">Piloto automático ligado</li>' : ''}
        ${estado.senhas.email ? `<li class="ok">E-mail sai de ${esc(estado.cfg.email.remetente)}</li>` : ''}
        ${pend.map(p => `<li class="${p.grave ? 'erro' : 'aviso'}">${esc(p.titulo)}: ${esc(p.detalhe || '')} <button class="botao" data-acao="as-concluir" data-destino="${esc(p.aba)}">Resolver</button></li>`).join('')}
      </ul>
    </section>
    <section class="cartao">
      <h2>Quer ver funcionando?</h2>
      <p class="detalhe">O teste entra no portal, preenche a nota inteira e confere, mas <b>para antes de emitir</b>. Leva cerca de 1 minuto.</p>
      <div class="acoes"><button type="button" class="botao" data-acao="as-testar">Testar sem emitir</button></div>
    </section>
    <div class="acoes"><button type="button" class="botao primario" data-acao="as-concluir" data-destino="inicio">Ir para o painel</button></div>
  </div>`;
}

// ---- ações

// Monta os clientes do formulário (só os ligados), no formato do servidor.
function clientesDoForm(form) {
  const d = dadosDe(form);
  return as.clientes.map((c, i) => {
    const v = k => d[`clientes.${i}.${k}`];
    return {
      i, incluir: v('incluir'), cnpj: v('cnpj'), nome: v('nome'), email: v('email'), apelido: v('apelido'), notas: c.notas, ultimoValor: c.ultimoValor,
      mensal: { ativo: v('mensalAtivo'), valor: v('valor'), automatico: form.querySelector(`[name="clientes.${i}.modo"]:checked`)?.value === 'sozinho' },
    };
  });
}

async function importar(botao) {
  as.erroImportar = '';
  avisar('Entrando no portal e lendo suas notas… (1 a 2 minutos)');
  const r = await ocupar(botao, 'Lendo o portal…', () => api('POST', '/api/assistente/importar'));
  if (!r.ok) {
    as.erroImportar = r.mensagem;
    as.semChrome = r.semChrome;
    guardarAs();
    return desenhar();
  }
  as.importou = true;
  as.servico = r.servico || as.servico;
  as.prestador = { prestadorCnpj: r.prestadorCnpj || as.cnpj, pastaNotas: '~/Documents/NFSe' };
  as.clientes = r.clientes.length
    ? r.clientes.map((c, i) => ({ ...c, incluir: c.mensal || i === 0, mensal: { ativo: c.mensal, valor: c.ultimoValor, automatico: false } }))
    : as.clientes;
  avisar(r.notas ? `Li ${r.notas} nota${r.notas > 1 ? 's' : ''} dos últimos meses.` : 'Não achei notas nos últimos meses: preencha à mão.');
  irPara('dados');
}

async function acaoAssistente(acao, alvo) {
  if (acao === 'as-manual') return irPara('dados');
  if (acao === 'as-voltar' || acao === 'as-ir') return irPara(alvo.dataset.para);
  if (acao === 'as-importar') return importar(alvo);
  if (acao === 'as-cliente-novo') {
    as.clientes = clientesDoForm(alvo.closest('form'));
    as.clientes.push({ incluir: true, mensal: { ativo: true } });
    guardarAs();
    return desenhar();
  }
  if (acao === 'as-pular-email') {
    await api('PUT', '/api/assistente', { pularEmail: true });
    return irPara('piloto');
  }
  if (acao === 'as-ligar-piloto') {
    const r = await ocupar(alvo, 'Ligando…', () => api('POST', '/api/agenda', { ligar: true }));
    if (r.mensagem && /Linux|crontab/.test(r.mensagem)) avisar(r.mensagem, true);
    await recarregar();
    return irPara('pronto');
  }
  if (acao === 'as-testar') {
    const t = Object.entries(estado.cfg.tomadores).find(([, x]) => x.mensal?.valor) || Object.entries(estado.cfg.tomadores)[0];
    const hoje = new Date();
    const ud = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    while ([0, 6].includes(ud.getDay())) ud.setDate(ud.getDate() - 1);
    avisar('Entrando no portal e preenchendo a nota (sem emitir)…');
    const r = await ocupar(alvo, 'Testando…', () => api('POST', '/api/emitir', { apelido: t[0], valor: t[1].mensal?.valor || '1,00', competencia: ud.toLocaleDateString('pt-BR'), teste: true }));
    return avisar(r.mensagem || 'Teste concluído.', !r.ok);
  }
  if (acao === 'as-concluir') {
    await api('PUT', '/api/assistente', { concluir: true });
    as = {};
    sessionStorage.removeItem('nfse-assistente');
    aba = alvo.dataset.destino || 'inicio';
    sessionStorage.setItem('nfse-aba', aba);
    return recarregar();
  }
}

async function enviarAssistente(tipo, form, botao) {
  const d = dadosDe(form);
  if (tipo === 'as-acesso') {
    as.cnpj = d.cnpj;
    guardarAs();
    avisar(estado.plataforma === 'darwin' ? 'Digite a senha no terminal onde o nfse-mei foi aberto…' : 'Abri uma janela do Windows: digite a senha do Emissor Nacional nela.');
    const r = await ocupar(botao, 'Esperando a senha…', () => api('POST', '/api/assistente/senha', { cnpj: d.cnpj }));
    if (r.erros) return mostrarErros(form, r.erros);
    await recarregar();
    return importar(document.querySelector('[data-acao="as-importar"]'));
  }
  if (tipo === 'as-dados') {
    as.prestador = { prestadorCnpj: d.prestadorCnpj, pastaNotas: d.pastaNotas };
    as.servico = { municipio: d.municipio, codigoTributacaoNacional: d.codigoTributacaoNacional, nbs: d.nbs, descricao: d.descricao };
    return irPara('clientes');
  }
  if (tipo === 'as-clientes') {
    as.clientes = clientesDoForm(form);
    guardarAs();
    const ligados = as.clientes.filter(c => c.incluir);
    const r = await ocupar(botao, 'Salvando…', () => api('POST', '/api/assistente/cadastro', {
      prestador: as.prestador, servico: as.servico,
      clientes: ligados.map(({ apelido, cnpj, nome, email, mensal }) => ({ apelido, cnpj, nome, email, mensal })),
    }));
    if (r.erros) {
      // Erros dos dados/serviço levam de volta para aquele passo; os dos clientes apontam o cartão certo.
      const deDados = Object.keys(r.erros).filter(k => !k.startsWith('clientes.') && k !== 'geral');
      if (deDados.length) { avisar(`Confira seus dados: ${r.erros[deDados[0]]}`, true); return irPara('dados'); }
      const traduzido = {};
      for (const [k, msg] of Object.entries(r.erros)) {
        const m = /^clientes\.(\d+)\.(.+)$/.exec(k);
        traduzido[m ? `clientes.${ligados[Number(m[1])].i}.${m[2]}` : k] = msg;
      }
      return mostrarErros(form, traduzido);
    }
    as.passo = null;
    guardarAs();
    avisar('Cadastro salvo.');
    return recarregar();
  }
  if (tipo === 'as-email') {
    const r = await ocupar(botao, 'Salvando…', () => api('PUT', '/api/email', { ...d, copiaParaMim: true }));
    if (r.erros) return mostrarErros(form, r.erros);
    return recarregar();
  }
}

// Busca o nome na Receita quando a pessoa termina de digitar o CNPJ de um cliente novo.
document.addEventListener('focusout', async ev => {
  const el = ev.target;
  const m = /^clientes\.(\d+)\.cnpj$/.exec(el.name || '');
  if (!m || el.value.replace(/\D/g, '').length !== 14) return;
  const form = el.closest('form');
  const nome = form.querySelector(`[name="clientes.${m[1]}.nome"]`);
  if (nome.value.trim()) return;
  const r = await api('POST', '/api/cnpj', { cnpj: el.value }).catch(() => ({}));
  if (!r.ok || nome.value.trim()) return;
  nome.value = r.nome;
  const apelido = form.querySelector(`[name="clientes.${m[1]}.apelido"]`);
  if (!apelido.value.trim()) apelido.value = r.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).find(p => p.length > 1 && !/^(ltda|me|epp|eireli|de|da|do)$/.test(p)) || '';
  const titulo = el.closest('.cliente-as')?.querySelector('.texto strong');
  if (titulo) titulo.textContent = r.nome;
});

// Liga/desliga os detalhes do cartão e as escolhas que só fazem sentido com "nota todo mês".
document.addEventListener('change', ev => {
  const m = /^clientes\.(\d+)\.(incluir|mensalAtivo)$/.exec(ev.target.name || '');
  if (!m) return;
  const cartao = ev.target.closest('.cliente-as');
  if (m[2] === 'incluir') cartao.querySelector('.corpo-cliente').hidden = !ev.target.checked;
  else cartao.querySelector('fieldset.escolha').disabled = !ev.target.checked;
});
