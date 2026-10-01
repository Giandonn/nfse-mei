// Manda a nota para o cliente por e-mail, com o seu próprio e-mail (Gmail com "senha de app", por padrão).
// O PDF oficial só sai do portal com captcha, então o e-mail leva número, valor e chave de acesso e o
// link da Consulta Pública oficial, onde o cliente vê e baixa o DANFSe. Nunca geramos um PDF próprio.
const nodemailer = require('nodemailer');
const { formatarValor, formatarCnpj } = require('./valores');

const CONSULTA_PUBLICA = 'https://www.nfse.gov.br/consultapublica';
const SERVIDORES = {
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
};

const emailValido = e => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(String(e || '').trim());
// Aceita vários destinatários separados por vírgula ou ponto e vírgula.
const listaDeEmails = s => String(s || '').split(/[,;]/).map(e => e.trim()).filter(Boolean);
const emailsValidos = s => { const l = listaDeEmails(s); return l.length > 0 && l.every(emailValido); };

function servidorDe(cfgEmail) {
  if (cfgEmail.host) return { host: cfgEmail.host, port: Number(cfgEmail.porta || 465), secure: cfgEmail.seguro ?? Number(cfgEmail.porta || 465) === 465 };
  const dominio = cfgEmail.remetente.split('@')[1]?.toLowerCase() || '';
  if (/outlook|hotmail|live\.com/.test(dominio)) return SERVIDORES.outlook;
  return SERVIDORES.gmail;
}

function montarMensagem(cfg, { tomador, chave, numero, centavos, competencia }) {
  const [, mm, aaaa] = competencia.split('/');
  const assinatura = cfg.email.nome || formatarCnpj(cfg.prestadorCnpj);
  const assunto = `NFS-e nº ${numero} · ${assinatura} · ${mm}/${aaaa}`;
  const linhas = [
    'Olá,',
    '',
    `Segue a nota fiscal de serviço referente a ${mm}/${aaaa}:`,
    '',
    `  Nota nº:          ${numero}`,
    `  Valor:            R$ ${formatarValor(centavos)}`,
    `  Competência:      ${competencia}`,
    `  Serviço:          ${cfg.servico.descricao}`,
    `  Prestador:        ${assinatura} (CNPJ ${formatarCnpj(cfg.prestadorCnpj)})`,
    `  Tomador:          ${tomador.nome || ''} (CNPJ ${formatarCnpj(tomador.cnpj)})`,
    `  Chave de acesso:  ${chave}`,
    '',
    'Para ver e baixar o PDF oficial (DANFSe), acesse a Consulta Pública de NFS-e e informe a chave de acesso acima:',
    CONSULTA_PUBLICA,
    '',
    'Qualquer dúvida, é só responder este e-mail.',
    assinatura,
  ];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const linha = (r, v) => `<tr><td style="padding:4px 16px 4px 0;color:#555">${r}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:560px">
<p>Olá,</p>
<p>Segue a nota fiscal de serviço referente a <b>${mm}/${aaaa}</b>:</p>
<table style="border-collapse:collapse">
${linha('Nota nº', numero)}${linha('Valor', `R$ ${formatarValor(centavos)}`)}${linha('Competência', competencia)}
${linha('Serviço', cfg.servico.descricao)}${linha('Prestador', `${assinatura} (CNPJ ${formatarCnpj(cfg.prestadorCnpj)})`)}
${linha('Tomador', `${tomador.nome || ''} (CNPJ ${formatarCnpj(tomador.cnpj)})`)}
</table>
<p style="margin-top:16px">Chave de acesso:<br><code style="font-size:13px;background:#f3f3f3;padding:4px 6px;display:inline-block">${esc(chave)}</code></p>
<p>Para ver e baixar o PDF oficial (DANFSe), acesse a <a href="${CONSULTA_PUBLICA}">Consulta Pública de NFS-e</a> e informe a chave de acesso.</p>
<p>Qualquer dúvida, é só responder este e-mail.<br>${esc(assinatura)}</p>
</div>`;
  return { assunto, texto: linhas.join('\n'), html };
}

// senha: a senha de app, lida do cofre por quem chama (nunca fica no config).
async function enviarNota(cfg, senha, dados, { transporte } = {}) {
  if (!cfg.email?.remetente) throw new Error('e-mail não configurado (nfse-mei email)');
  const para = listaDeEmails(dados.tomador.email);
  if (!para.length || !para.every(emailValido)) throw new Error(`e-mail do cliente inválido: "${dados.tomador.email || ''}"`);
  const { assunto, texto, html } = montarMensagem(cfg, dados);
  const t = transporte || nodemailer.createTransport({ ...servidorDe(cfg.email), auth: { user: cfg.email.remetente, pass: senha } });
  const info = await t.sendMail({
    from: cfg.email.nome ? { name: cfg.email.nome, address: cfg.email.remetente } : cfg.email.remetente,
    to: para,
    bcc: cfg.email.copiaParaMim === false ? undefined : cfg.email.remetente, // cópia para você, como comprovante
    subject: assunto, text: texto, html,
  });
  return { para, assunto, id: info.messageId };
}

// Só confere se o login no servidor funciona (sem mandar nada).
async function testarLogin(cfg, senha) {
  const t = nodemailer.createTransport({ ...servidorDe(cfg.email), auth: { user: cfg.email.remetente, pass: senha } });
  await t.verify();
}

module.exports = { enviarNota, testarLogin, montarMensagem, servidorDe, emailValido, emailsValidos, listaDeEmails, CONSULTA_PUBLICA };
