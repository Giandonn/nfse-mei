# nfse-mei

[![testes](https://github.com/Giandonn/nfse-mei/actions/workflows/testes.yml/badge.svg)](https://github.com/Giandonn/nfse-mei/actions/workflows/testes.yml)
[![npm](.github/npm.svg)](https://www.npmjs.com/package/nfse-mei)

**A nota do seu MEI no piloto automático.** O `nfse-mei` preenche por você o [Emissor Nacional da NFS-e](https://www.nfse.gov.br/EmissorNacional) (o portal do governo), confere tudo e emite. Se você quiser, ele faz isso **sozinho** no dia que você escolher (ou só abre uma janela com o valor para você conferir), manda a nota por e-mail para o cliente, lembra do DAS e avisa antes de você estourar o limite do MEI.

```text
✅ Nota nº 12 emitida
R$ 4.000,00 para ACME TECNOLOGIA LTDA · competência 30/10/2026
No ano: R$ 38.000,00 de R$ 81.000,00 (47%)
Enviei para financeiro@acme.com.br
```

![Painel do nfse-mei: faturamento do ano, próximas notas e próximo DAS](.github/painel.png)

Tudo se configura num **painel no navegador** (`nfse-mei abrir`): seus dados, clientes, se a nota sai sozinha, para qual e-mail vai. Quem prefere o terminal tem todos os comandos também.

```text
$ nfse-mei emitir
Clientes:
  1) acme: ACME TECNOLOGIA LTDA (11.222.333/0001-81)
  2) globex: GLOBEX SERVICOS LTDA (11.444.777/0001-61)
Para qual cliente? (número ou apelido) [acme]: 1
Valor da nota para ACME TECNOLOGIA LTDA (R$): 1200
Data de competência (DD/MM/AAAA) [30/09/2026]:

  Ambiente:    PRODUÇÃO (nota com valor fiscal)
  Tomador:     ACME TECNOLOGIA LTDA (11.222.333/0001-81)
  Serviço:     01.01.01 / NBS 115022000 / "Análise e desenvolvimento de sistemas"
  Valor:       R$ 1.200,00
  Competência: 30/09/2026
  Modo:        pergunta antes de emitir

Está certo? Posso abrir o portal e preencher? (S/n) [s]:
Entrando com CNPJ + senha do emissor...
Etapa 1/3: Pessoas
  tomador: ACME TECNOLOGIA LTDA
Etapa 2/3: Serviço
Etapa 3/3: Valores

Revisão no portal: competência 30/09/2026 | NBS 115022000 - ... | líquido R$ 1.200,00

Emitir agora? (s/N): s

✅ NFS-e EMITIDA: R$ 1.200,00 para ACME TECNOLOGIA LTDA (11.222.333/0001-81)
```

A cada nota você informa só **cliente, valor e data**, e o script sugere a data. Seus dados, o serviço (código, NBS, descrição) e as manhas do formulário ficam com o script.

> [!IMPORTANT]
> A nota é emitida **pelo portal oficial**, do mesmo jeito que você faria na mão. O script **não gera PDF por conta própria**: um DANFSe só vale se a NFS-e existir no Sistema Nacional.

## Começo rápido

Já tem Node.js 20+, Google Chrome e a [senha do Emissor Nacional](#1-crie-a-senha-do-emissor-nacional-uma-vez-só)? Então são 3 comandos:

```bash
npm install -g nfse-mei     # 1. instala
nfse-mei abrir              # 2. abre o painel: cadastre seus dados, clientes e ligue o piloto automático
```

Prefere o terminal? `nfse-mei emitir --teste` cadastra e testa sem emitir, `nfse-mei emitir` emite e `nfse-mei agendar` liga o piloto automático.

Falta alguma coisa? Veja os [requisitos](#requisitos) logo abaixo ou rode `nfse-mei doutor`, que diz o que falta.

---

## Requisitos

Antes de instalar, confira se você tem tudo isto:

**Sua situação**

- [ ] Ser **MEI** e emitir NFS-e pelo **Emissor Nacional** ([nfse.gov.br](https://www.nfse.gov.br/EmissorNacional)). Se o seu município ainda usa um sistema próprio de nota, este projeto não serve.
- [ ] Cliente (tomador) **com CNPJ no Brasil**. Nota para pessoa física ou para o exterior ainda não é suportada.

**Acesso ao portal**

- [ ] **Senha de primeiro acesso do Emissor Nacional.** Ela é diferente da conta gov.br. O script entra com **CNPJ + essa senha**, porque o gov.br bloqueia automação com captcha e 2FA. Se você ainda não tem, crie antes (ver o [passo 1](#1-crie-a-senha-do-emissor-nacional-uma-vez-só)). Vai precisar de:
  - CPF e data de nascimento
  - **Número do título de eleitor** (dá pra ver no app **e-Título**)
  - Acesso ao e-mail cadastrado, para receber o código de confirmação

**Dados da nota** (o `nfse-mei init` pergunta)

- [ ] **Seu CNPJ** do MEI
- [ ] **Município** onde o serviço é prestado
- [ ] **Código de Tributação Nacional** e **código da NBS** do seu serviço. Dá pra copiar de uma nota antiga ou perguntar ao seu contador.
- [ ] **Descrição do serviço** que vai na nota
- [ ] **CNPJ e razão social** de cada cliente

O valor e a data não entram aqui: eles são perguntados a cada nota.

**No computador**

- [ ] **Windows 10/11 ou macOS**. A senha fica guardada no cofre do sistema: DPAPI no Windows, **Keychain** no macOS. Linux: veja [Limitações](#limitações).
- [ ] [**Node.js 20+**](https://nodejs.org). Confira com `node -v`.
- [ ] [**Google Chrome**](https://www.google.com/chrome/) instalado

---

## Índice

- [Requisitos](#requisitos)
- [Como funciona](#como-funciona)
- [Instalação passo a passo](#instalação-passo-a-passo)
- [O painel](#o-painel)
- [Uso no dia a dia](#uso-no-dia-a-dia)
- [Piloto automático](#piloto-automático)
- [Seu MEI: painel, limite e declaração anual](#seu-mei-painel-limite-e-declaração-anual)
- [De onde vem cada dado da nota](#de-onde-vem-cada-dado-da-nota)
- [Configuração (config.json)](#configuração-configjson)
- [Baixar o PDF e o XML](#baixar-o-pdf-e-o-xml)
- [Problemas comuns](#problemas-comuns)
- [Segurança e privacidade](#segurança-e-privacidade)
- [Limitações](#limitações)
- [Contribuindo](#contribuindo)

---

## Como funciona

O `nfse-mei` usa o Google Chrome instalado na sua máquina, controlado pelo [Playwright](https://playwright.dev). Por padrão o Chrome roda **invisível** e tudo acontece no terminal.

1. **Dados da nota:** pergunta cliente (se houver mais de um), valor e competência, mostra o resumo e pede confirmação.
2. **Login:** entra no Emissor Nacional com o **CNPJ + senha do emissor** que você guardou.
3. **Preenchimento:** passa pelas telas Pessoas → Serviço → Valores.
4. **Conferência:** lê a tela de revisão do portal e confere competência, CNPJ do prestador, CNPJ do tomador e valor líquido. **Se algo não bater, para sem emitir.**
5. **Confirmação:** apita e pergunta "Emitir agora?". Só emite com `s`.
6. **Registro e download:** apita, mostra a chave de acesso e anota a nota em `historico.csv`. Depois abre a lista de notas no seu navegador para você passar pelo captcha e [baixar o PDF](#baixar-o-pdf-e-o-xml). O script pega o arquivo em Downloads e guarda na pasta do mês.

Até o passo 5 nada é enviado ao governo. Se o portal falhar no meio do caminho (ele cai bastante no fim do mês), o script tenta de novo e, se preciso, recomeça do login.

## Instalação passo a passo

### 1. Crie a senha do Emissor Nacional (uma vez só)

O gov.br tem captcha e 2FA, que bloqueiam qualquer automação (de propósito). Por isso o script usa a **outra porta oficial** do portal: CNPJ + senha própria do emissor.

1. Acesse https://www.nfse.gov.br/EmissorNacional e clique em **"Fazer primeiro acesso"**.
2. Informe o que o portal pedir (CPF, data de nascimento, **número do título de eleitor**...). Não lembra do título? Consulte no app **e-Título** ou no site do TSE (Autoatendimento Eleitoral).
3. Confirme o código enviado por e-mail e crie a senha.
4. Teste: entre no portal com **CNPJ + senha**, sem o gov.br.

> O portal às vezes responde "The service is unavailable" nessa etapa. É instabilidade do governo: aperte F5 ou tente mais tarde.

### 2. Instale o nfse-mei

```bash
npm install -g nfse-mei
```

Pronto: o comando `nfse-mei` funciona em qualquer terminal. Para conferir se a máquina está pronta (Node, Chrome, portal no ar), rode:

```bash
nfse-mei doutor
```

> **macOS:** se o `npm install -g` der erro de permissão (`EACCES`), rode `sudo npm install -g nfse-mei`. Isso acontece quando o Node foi instalado pelo instalador do site; com Homebrew (`brew install node`) não precisa.

Para atualizar depois: `npm install -g nfse-mei@latest`.

<details>
<summary>Instalar a partir do código (para quem quer mexer no projeto)</summary>

```bash
git clone https://github.com/Giandonn/nfse-mei.git
cd nfse-mei
npm install
npm link          # deixa o comando `nfse-mei` disponível em qualquer terminal
```

</details>

### 3. Configure seus dados

```bash
nfse-mei init
```

(Se você pular esta etapa e rodar direto `nfse-mei emitir`, ele percebe que é a primeira vez, faz este mesmo cadastro e segue para a nota.)

Você **não precisa abrir nenhum arquivo**: o `init` pergunta tudo no terminal, uma vez só, e salva. Se digitar algo errado (um CNPJ com dígito trocado, o código fora do formato), ele avisa e pergunta de novo. As perguntas, em ordem:

| Pergunta | Exemplo | Onde achar |
|---|---|---|
| Seu CNPJ (prestador) | `11222333000181` | Seu cartão CNPJ do MEI |
| Município da prestação | `São Paulo/SP` | Como aparece no campo "Município" do portal |
| Código de Tributação Nacional | `01.01.01` | Na sua última nota: "Código de Tributação Nacional" |
| Item da NBS | `115022000` | Na sua última nota: "Código da NBS" (sem pontos) |
| Descrição do serviço | `Análise e desenvolvimento de sistemas` | O texto que você costuma usar |
| Apelido do cliente | `acme` | Você inventa; é o que vai no `--tomador` |
| CNPJ do cliente | `11222333000181` | Contrato ou nota anterior |
| Razão social do cliente | `ACME TECNOLOGIA LTDA` | O script confere com o que o portal retornar |

O **valor não fica no config**: ele é perguntado a cada nota.

No fim ele oferece guardar a senha do emissor. No Windows abre uma janela para digitar; no macOS o terminal pede a senha (ela não aparece enquanto você digita) e pede de novo para confirmar. Dá pra fazer isso depois com `nfse-mei senha`.

> Não sabe o código ou a NBS? Abra uma nota antiga no portal (Notas emitidas → ⋮ → Visualizar) e copie. Na dúvida sobre qual NBS usar, **pergunte ao seu contador**.

**Mudar algo depois** (um cliente novo, outro CNPJ, trocar a senha): rode `nfse-mei config`. Ele abre um menu e você mexe só no que precisa. Cada mudança é salva na hora.

```text
$ nfse-mei config

nfse-mei - configuração (cada mudança é salva na hora)
  1) Meus dados    11.222.333/0001-81  |  notas em C:\Users\voce\Documents\NFSe
  2) Serviço       01.01.01 / NBS 115022000 / São Paulo/SP
  3) Clientes      2 cadastrados
  4) Senha         guardada
  0) Sair
Escolha [0]: 3

Clientes:
  1) acme         11.222.333/0001-81  ACME TECNOLOGIA LTDA  (padrão)
  2) globex       11.444.777/0001-61  GLOBEX SERVICOS LTDA

  a) adicionar   e) editar   r) remover   p) escolher o padrão   0) voltar
Escolha [0]:
```

O cliente **padrão** é o que já vem sugerido no `emitir`. Remover um cliente não mexe nas notas já emitidas para ele.

### 4. Faça um teste (não emite nada)

```bash
nfse-mei emitir --teste
```

Ele loga, preenche tudo, confere a revisão e **para sem emitir**. Se aparecer `MODO TESTE: tudo preenchido e conferido`, está pronto. Fica um rascunho no portal, que você pode ignorar.

## O painel

```bash
nfse-mei abrir
```

Abre no seu navegador um painel com tudo num lugar só:

| Tela | O que tem |
|---|---|
| **Início** | Faturamento do ano x limite do MEI (com gráfico por mês e projeção), próximas notas do piloto automático, próximo DAS, botões para emitir uma nota avulsa (ou só testar) e sincronizar com o portal |
| **Clientes** | Adicionar, editar e remover. Em cada um: **nota todo mês**, valor fixo, **dia da nota**, **emitir sozinho** (ou confirmar o valor numa janela) e o **e-mail** que recebe a nota |
| **Meus dados** | Seu CNPJ, pasta das notas, serviço (município, código, NBS, descrição) e a senha do emissor |
| **Automação e e-mail** | Ligar/desligar o piloto automático e o lembrete do DAS, configurar o e-mail, mandar um e-mail de teste e ver o que a rotina fez |
| **Notas** | As últimas notas, inclusive as feitas no portal e as canceladas |

Na primeira vez, o painel abre direto no cadastro. Ele valida tudo como o terminal: CNPJ pelos dígitos verificadores, código no formato `00.00.00`, NBS com 9 números, e-mails, valor.

**Segurança do painel** (ele mexe com emissão de nota fiscal):

- Roda **só no seu computador** (`127.0.0.1`, porta aleatória). Nada de fora alcança.
- Cada abertura gera um **código secreto** no endereço; sem ele, o painel não abre e a API não responde. O código sai da barra de endereço assim que a página carrega.
- **Outros sites não conseguem usá-lo**: ele confere a origem e o endereço de cada chamada (o que bloqueia também o ataque de "DNS rebinding") e não carrega nada da internet.
- **As senhas nunca passam pelo navegador.** O painel só mostra "guardada ✓". Para guardar ou trocar, abre a janela do Windows, ou, no macOS, pede no terminal onde você rodou `nfse-mei abrir`.
- **Emitir de verdade** pelo painel exige digitar `EMITIR`. "Testar sem emitir" faz tudo no portal e para antes.
- Ele **se desliga sozinho** cerca de 1 minuto depois que você fecha a aba.

## Uso no dia a dia

```bash
nfse-mei emitir                          # pergunta cliente, valor e competência
nfse-mei emitir --valor 1200             # já informa o valor (não pergunta)
nfse-mei emitir --tomador acme           # outro cliente do config
nfse-mei emitir --competencia 15/10/2026 # outra data de competência
nfse-mei emitir --ver                    # mostra o Chrome na tela (para acompanhar)
nfse-mei baixar                          # ajuda a baixar o PDF/XML da última nota e guarda na pasta do mês
nfse-mei config                          # muda seus dados, o serviço, os clientes ou a senha
nfse-mei doutor                          # confere se está tudo pronto e diz o que falta
nfse-mei ultimo-dia-util 12/2026         # só mostra a data
```

| Opção | O que faz |
|---|---|
| `--valor <1200,00>` | Valor do serviço. Aceita `1200`, `1200,00`, `1.200,00`. Sem a opção, pergunta |
| `--tomador <apelido>` | Cliente do config. Sem a opção, pergunta (se houver mais de um) |
| `--competencia <DD/MM/AAAA>` | Data de competência. Sem a opção, pergunta, sugerindo o último dia útil do mês |
| `--teste` | Preenche e confere, mas **nunca emite** |
| `--sim` | Emite sem perguntar nada (exige `--valor`). Serve para agendar, com cuidado |
| `--ver` | Mostra o Chrome na tela. Por padrão roda invisível e tudo acontece pelo terminal |
| `--homologacao` | Usa a Produção Restrita (notas sem valor fiscal). Exige cadastro separado nesse ambiente |

> [!WARNING]
> Depois de ver **"✅ NFS-e EMITIDA"**, não rode de novo para a mesma nota: sai uma segunda nota. Confira em `historico.csv`.

## Piloto automático

Para quem fatura todo mês para os mesmos clientes. Liga uma vez e o computador cuida do resto.

### Ligar

1. Para cada cliente fixo: `nfse-mei config` → **3) Clientes** → **e) editar** e responda:
   - **Nota todo mês para este cliente?** `s`
   - **Valor fixo por mês:** ex. `3500`. Deixe vazio se o valor muda; aí a janela abre com o campo vazio para você digitar.
   - **Dia da nota:** vazio = **último dia útil**, com a nota do próprio mês. Um dia de `1` a `31` = nesse dia, a nota do **mês anterior** (competência no último dia útil dele), para quem cobra no começo do mês pelo mês que passou. Em mês mais curto, vale o último dia do mês.
   - **Emitir SOZINHO, sem perguntar?** `s` para 100% automático, `n` para conferir o valor numa janela antes.
   - **E-mail do cliente:** para onde mandar a nota (opcional).
2. Guarde a senha do emissor, se ainda não guardou: `nfse-mei senha`.
3. Ligue a rotina:

   ```bash
   nfse-mei agendar
   ```

Ela roda escondida todo dia (9h e a cada 2h até 21h, e quando você liga o computador), sem precisar de administrador. No Windows é uma tarefa do **Agendador de Tarefas**; no macOS, um **LaunchAgent**.

### O que acontece

| Quando | O que a rotina faz |
|---|---|
| **No dia da nota** | Cliente "automático": entra no portal, **confere se a nota já existe** (inclusive feita à mão), emite, manda por e-mail e mostra um aviso ✅. Os outros: abre a janela da nota (abaixo) |
| **Computador desligado no dia** | Faz isso quando você ligar, até o dia 10 do mês seguinte, com a competência do mês certo |
| **5 dias antes do DAS (dia 20)** | Janela **[Abrir o PGMEI] [Já paguei] [Lembrar amanhã]**, uma vez por dia, até você marcar "Já paguei" |
| **Faturamento perto do limite** | Avisa ao passar de 80%, ao passar do limite e se, no ritmo atual, você vai estourar no ano |

### A janela da nota

```
┌─ nfse-mei: nota de outubro ─────────────────────────┐
│  HYPEX HOLDING LTDA                                 │
│  Competência: 30/10/2026                            │
│                                                     │
│  Valor:  R$ [ 3.500,00      ]                       │
│          ☐ Usar este valor nos próximos meses       │
│                                                     │
│  No ano: R$ 38.500,00 de R$ 81.000,00 (48%)         │
│                                                     │
│  [Emitir R$ 3.500,00] [Lembrar amanhã] [Pular este mês] │
└─────────────────────────────────────────────────────┘
```

- **Mudar o valor é só digitar.** O botão acompanha ("Emitir R$ 3.800,00"), então você vê o que vai sair antes de clicar. Valor que não dá para ler desliga o botão.
- **A mudança vale só para esta nota**, a não ser que você marque "Usar este valor nos próximos meses".
- **Erro de digitação:** valor muito diferente do de costume (mais de 50% para cima ou para baixo), ou que passaria do limite do MEI, pede uma confirmação. "Voltar" reabre a janela com o que você digitou.
- **Fechou sem responder?** Ela volta umas 4 horas depois. "Lembrar amanhã" volta no dia seguinte; "Pular este mês" não volta mais neste mês.

### Por que dá para confiar

- **Nunca emite duas vezes:** antes de emitir, lê a lista "Notas emitidas" do portal. Se já existe nota daquele cliente naquela competência (do nfse-mei ou feita à mão), não emite. Nota cancelada não conta.
- **Não emite às cegas:** se não conseguir ler a lista do portal, não emite e tenta mais tarde.
- **Limite do MEI:** uma nota que faria o faturamento do ano passar do limite **nunca sai sozinha**: vira pergunta, com o aviso.
- **Portal fora do ar:** tenta de novo nas próximas rodadas. Depois de 3 falhas, para de tentar sozinha e passa a perguntar.
- **Mesmas conferências do `emitir`:** competência, CNPJs e valor na tela de revisão. Se algo não bater, não emite.
- **Teste sem risco:** `nfse-mei rotina --teste` faz tudo, inclusive preencher o portal, e para na revisão.

### E-mail para o cliente

```bash
nfse-mei email          # configura (uma vez)
nfse-mei email teste    # manda um exemplo para você mesmo
```

O e-mail sai do **seu** e-mail (Gmail ou Outlook), com uma **senha de app**: não é a senha normal do e-mail, é uma senha criada só para isso. No Gmail: ative a verificação em 2 etapas e crie em [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). Ela fica no cofre do sistema, como a senha do emissor.

O cliente recebe número, valor, competência e a **chave de acesso**, com o link da [Consulta Pública oficial](https://www.nfse.gov.br/consultapublica), onde ele vê e baixa o PDF. O PDF não vai anexado porque o portal exige captcha para baixá-lo, e o nfse-mei nunca gera um PDF por conta própria. Você recebe uma cópia oculta, como comprovante. Para reenviar uma nota: `nfse-mei email enviar 12`.

### Acompanhar e desligar

```bash
nfse-mei agendar status     # está ligada? quando roda de novo?
nfse-mei rotina             # roda agora, mostrando o que faz
nfse-mei agendar remover    # desliga
```

Tudo o que a rotina faz fica em `rotina.log`, na pasta do config.

## Seu MEI: painel, limite e declaração anual

```text
$ nfse-mei painel
Seu MEI em 2026

  Faturado:   R$ 34.000,00 de R$ 81.000,00  [█████████████░░░░░░░░░░░░░░░░░] 42%
  Ainda cabe: R$ 47.000,00
  Projeção:   R$ 45.333,33 no ano, no ritmo atual

  Próximo DAS: vence 20/10/2026 (em 20 dias)
```

- `nfse-mei sincronizar`: lê a lista de notas do portal (só leitura), para o painel contar também as notas feitas à mão e descontar as canceladas. A rotina faz isso sozinha antes de emitir.
- `nfse-mei relatorio 2026`: o número para a **declaração anual do MEI (DASN-SIMEI)**, que vence em 31/05 do ano seguinte, com o total por mês e por cliente e o link para declarar.
- O limite padrão é R$ 81.000 por ano. No **primeiro ano** do MEI ele é proporcional (R$ 6.750 por mês de atividade): ajuste `limiteAnual` no `config.json`.

## De onde vem cada dado da nota

| Dado na nota | De onde vem | Quando é escolhido |
|---|---|---|
| **Prestador (você)** | A conta que fez login (CNPJ + senha) | No login. O portal preenche sozinho; o script confere com `prestadorCnpj` na revisão |
| **Tomador (cliente)** | Lista de clientes (`tomadores`) no config | A cada nota: você escolhe na lista ou usa `--tomador`. O script digita o CNPJ e confere a razão social retornada |
| **Valor** | Você digita a cada nota (ou `--valor`) | A cada nota. Não fica salvo em lugar nenhum além do `historico.csv` |
| **Competência** | Você confirma a cada nota (ou `--competencia`) | A cada nota. A sugestão é o último dia útil do mês, pulando fins de semana e feriados nacionais |
| **Município, código, NBS, descrição** | `servico` no config | Fixos; mude com `nfse-mei config` |
| **Tributos aproximados** | `tributosAproximados` (padrão `3` = não informar) | Fixo |
| **IBS/CBS** | Sempre "Não preencher" | Opcional para MEI em 2026 |

## Configuração (config.json)

O normal é usar `nfse-mei init` e `nfse-mei config`: você não precisa editar este arquivo. Ele fica aqui para quem quiser ver ou fazer backup.

Fica em `%APPDATA%\nfse-mei\config.json` no Windows e em `~/.config/nfse-mei/config.json` no macOS. Dá para apontar outro arquivo com a variável `NFSE_MEI_CONFIG`. Exemplo completo em [`config.example.json`](config.example.json):

```json
{
  "prestadorCnpj": "11222333000181",
  "ambiente": "producao",
  "pastaNotas": "~/Documents/NFSe",
  "servico": {
    "municipio": "São Paulo/SP",
    "codigoTributacaoNacional": "01.01.01",
    "nbs": "115022000",
    "descricao": "Análise e desenvolvimento de sistemas"
  },
  "tributosAproximados": 3,
  "tomadorPadrao": "acme",
  "tomadores": {
    "acme": { "cnpj": "11222333000181", "nome": "ACME TECNOLOGIA LTDA" },
    "globex": { "cnpj": "11444777000161", "nome": "GLOBEX SERVICOS LTDA" }
  }
}
```

## Baixar o PDF e o XML

O portal exige um **captcha ("Sou humano")** para baixar o DANFSe (PDF) e o XML. O link direto do arquivo responde 403, a página de cada nota não tem botão de download, e o captcha recusa navegadores automatizados. Então o clique é seu, mas o script faz o resto:

```text
✅ NFS-e EMITIDA: R$ 1.200,00 para ACME TECNOLOGIA LTDA (11.222.333/0001-81)
   Chave: 3550...

⬇️  FALTA SÓ BAIXAR. O portal exige captcha, então essa parte é sua:
   1. Abra a lista de notas (já abri no seu navegador; faça login se pedir):
      https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas
   2. Na nota de R$ 1.200,00 para ACME TECNOLOGIA LTDA: menu ⋮ → Download DANFS-e
   3. Marque "Sou humano" → Confirmar. Se quiser o XML, repita com Download XML.

   Estou vigiando C:\Users\voce\Downloads: quando o arquivo chegar, guardo em ...\NFSe\2026-09
   (Enter para parar de esperar)
   ✅ PDF salvo: ...\NFSe\2026-09\NFSe_2026-09_acme_12345678.pdf
```

- O link já abre sozinho no seu navegador normal. Se você não estiver logado, o portal pede login e volta direto para a lista.
- Enquanto você baixa, o script **vigia a pasta Downloads**. Quando chega `<chave>.pdf` (ou `.xml`), ele move o arquivo para `<pastaNotas>/AAAA-MM/` com o nome padronizado.
- Fechou antes de baixar? `nfse-mei baixar` retoma a última nota (ou `nfse-mei baixar <chave>` para uma específica). Ele só pede o que ainda falta.
- A pasta Downloads é detectada sozinha; se a sua for outra, configure `pastaDownloads` no config.

## Problemas comuns

Primeiro passo para qualquer problema: rode `nfse-mei doutor`. Ele confere Node, Chrome, cadastro, senha e se o portal está no ar, e diz o que fazer em cada item com ✗. Se for abrir uma issue, cole a saída dele.

| Mensagem | O que é | O que fazer |
|---|---|---|
| `portal fora do ar (HTTP 503), tentando de novo...` | O servidor do governo está sobrecarregado (comum no fim do mês) | Nada, o script tenta de novo. Se desistir, tente mais tarde |
| `portal instável, recomeçando do login` | Uma página veio quebrada no meio do caminho | Nada; como ainda não emitiu, recomeçar é seguro |
| `O portal recusou o CNPJ/senha salvos` | Senha errada ou expirada | `nfse-mei senha` |
| `Já existe um Chrome do nfse-mei aberto` | Outra execução ainda está rodando | Feche a outra janela/terminal |
| `O CNPJ ... voltou como "X", mas o config diz "Y"` | A razão social do cliente não bate | Corrija `nome` no config (ou o CNPJ) |
| `A revisão não bate com o esperado` | Algo ficou diferente na tela final | Nada foi emitido. Rode com `--ver` para ver onde |
| Captcha inválido no gov.br | O gov.br bloqueia navegador automatizado | Use o login por CNPJ + senha do emissor |

Quando dá erro, o script salva um print da tela em `ultimo-erro.png`, na mesma pasta do config.

## Segurança e privacidade

- A senha fica no cofre do sistema, e só o seu usuário, nesta máquina, consegue ler:
  - **Windows:** `%APPDATA%\nfse-mei\credencial.xml`, criptografada com **DPAPI**.
  - **macOS:** no **Keychain** (app Acesso às Chaves), item `nfse-mei`.

  Ela nunca aparece no terminal, na linha de comando nem em arquivo aberto. A **senha de app do e-mail** fica do mesmo jeito, num item separado (`credencial-email.xml` / `nfse-mei-email`).
- A senha só é digitada na página de login do próprio `nfse.gov.br`. Se o portal redirecionar para outro endereço, o script para sem digitar.
- O Chrome usa um **perfil próprio** (`perfil-chrome`, na pasta do config), separado do seu navegador. O gerenciador de senhas do Chrome fica **desligado** nesse perfil, e qualquer senha que ele tenha guardado é apagada a cada execução. Assim não existe uma segunda cópia da senha fora do cofre do sistema.
- No macOS/Linux a pasta do config é criada só para o seu usuário (permissão `700`). Ela guarda a sessão do portal e o histórico de notas.
- O script só conversa com `nfse.gov.br` e, se você configurar o e-mail, com o servidor do **seu** e-mail. Não há telemetria nem servidor intermediário.
- A rotina automática roda como o seu usuário, sem administrador, e não abre nenhuma porta nem atalho que um site possa acionar.
- `config.json`, PDFs e XMLs estão no `.gitignore`. **Não commite seus dados.**

## Limitações

- **Só o caso mais comum do MEI:** tomador com CNPJ no Brasil, sem retenção, sem dedução, sem intermediário e sem IBS/CBS.
- **Depende do layout do portal** (mapeado na versão 1.6.0.0). Se o governo mudar a tela, os seletores em `src/portal.js` precisam de ajuste. Abra uma issue.
- **Download com captcha:** manual, veja acima. Por isso o e-mail ao cliente leva a chave e o link da consulta oficial, não o PDF.
- **Piloto automático precisa do computador ligado** e com você logado em algum momento entre o dia da nota e o dia 10 do mês seguinte. No Linux, agende com o `cron` (o `nfse-mei agendar` mostra a linha).
- **Guardar a senha** funciona no Windows e no macOS. No Linux o resto funciona, mas o login fica manual (rode com `--ver` e entre na janela).
- **Futuro:** emitir pela [API oficial da NFS-e](https://www.gov.br/nfse) com certificado digital A1, sem navegador e sem captcha.

## Contribuindo

```bash
npm test                         # testes (rotina, e-mail com servidor SMTP local, agenda, painel...)
nfse-mei emitir --teste --ver    # roda o fluxo mostrando o Chrome, sem emitir
NFSE_MEI_HOJE=2026-10-30 nfse-mei rotina --teste   # simula a rotina num dia qualquer, sem emitir
```

A cada push, o GitHub Actions roda os testes em **Windows, macOS e Linux** (Node 20 e 22), inclusive guardando e lendo uma senha de teste no **Keychain real** do macOS, e instala o pacote como um usuário faria.

Estrutura:

- `bin/nfse-mei.js`: CLI (init, config, senha, emitir, baixar, agendar, rotina, email, painel...)
- `src/portal.js`: toda a automação do portal (seletores, retentativas, revisão)
- `src/rotina.js`: as regras do piloto automático (o que fazer em cada dia), testadas com o mundo simulado
- `src/rotina-real.js`: liga a rotina ao portal, à emissão, ao e-mail e às notificações
- `src/agenda.js`: Agendador de Tarefas (Windows) e LaunchAgent (macOS)
- `src/notificar.js`: avisos e janelas com botões, nativos de cada sistema
- `src/historico.js`: notas emitidas (CSV) + lista do portal; nunca emitir duas vezes
- `src/painel.js`: limite do MEI, projeção, DAS e relatório da DASN-SIMEI
- `src/email.js`: e-mail da nota para o cliente
- `src/servidor.js` + `src/web/`: o painel no navegador (servidor local e a página)
- `src/cadastro.js`: regras e validações do cadastro usadas pelo painel
- `src/datas.js`: último dia útil, dia da nota e feriados nacionais
- `src/valores.js`: dinheiro e CNPJ
- `src/credencial.js`: senha no cofre do sistema (DPAPI no Windows, Keychain no macOS)
- `src/downloads.js`: vigia a pasta Downloads e guarda os arquivos na pasta do mês
- `src/doutor.js`: checagens do `nfse-mei doutor`
- `src/config.js`: onde fica cada arquivo

PRs são bem-vindos, principalmente para outros cenários de nota (tomador pessoa física, exterior, retenções) e para a emissão via API.

## Aviso

Projeto independente, sem vínculo com a Receita Federal, o Comitê Gestor da NFS-e ou qualquer prefeitura. Você continua responsável pelas notas emitidas: confira o resumo antes de confirmar e, na dúvida sobre códigos fiscais, fale com um contador.

## Licença

[MIT](LICENSE)
