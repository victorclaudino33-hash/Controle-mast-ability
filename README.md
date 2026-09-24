# Controle de Exames — Solicitação → Confirmação → ASO

App para lançar e acompanhar os três marcos (solicitação, confirmação do
agendamento e saída do ASO) de cada base, com indicadores calculados na
hora. Cada base só vê e edita os próprios registros; o login admin (você)
vê e edita tudo, de todas as bases.

## 1. Criar o projeto Firebase

1. Acesse https://console.firebase.google.com e clique em "Adicionar
   projeto". Dê um nome (ex.: `ability-controle-exames`) e conclua a criação.
2. No menu lateral, abra **Build → Authentication** → aba "Sign-in method"
   → ative **E-mail/senha**.
3. No menu lateral, abra **Build → Firestore Database** → "Criar banco de
   dados" → modo produção → escolha a região mais próxima (ex.:
   `southamerica-east1`).
4. Ainda em Firestore, vá na aba **Regras**, apague o conteúdo e cole o
   arquivo `firestore.rules` deste pacote. Clique em **Publicar**.
5. Volte em **Configurações do projeto** (ícone de engrenagem) → role até
   "Seus aplicativos" → clique no ícone `</>` para criar um app da Web →
   dê um nome → **não** marque "Configurar Firebase Hosting" → clique em
   registrar. Vai aparecer um bloco `firebaseConfig = {...}`. Copie esses
   valores para o arquivo `public/firebase-config.js`.

## 2. Criar os logins (um por base + o seu, de admin)

Em **Authentication → Users → Add user**, crie um login para cada base,
por exemplo:

| E-mail                         | Senha        | Base                  |
|---------------------------------|--------------|------------------------|
| osasco@ability-exames.com       | (defina)     | Osasco                 |
| riodejaneiro@ability-exames.com | (defina)     | Rio de Janeiro         |
| ... (uma linha por base) |
| victor@ability-exames.com       | (defina)     | (é o admin)            |

O e-mail não precisa ser real nem existir de fato — é só o login. Depois
de criar cada usuário, o Firebase mostra um **UID** (uma sequência tipo
`aB3xY...`). Copie o UID de cada um.

## 3. Dar a cada login sua base (ou marcar como admin)

Em **Firestore Database → Dados**, crie uma coleção chamada `usuarios`.
Para cada UID copiado no passo 2, crie um documento com o ID igual ao
UID e estes campos:

- Para uma base normal: `base` (string, ex. `"Osasco"`), `isAdmin`
  (boolean, `false`), `nome` (string, ex. `"Base Osasco"`).
- Para o seu login: `base` (pode deixar em branco), `isAdmin` (boolean,
  `true`), `nome` (`"Victor"`).

**Importante:** o texto em `base` precisa ser idêntico ao que está na
lista de bases (Osasco, Rio de Janeiro, São José dos Campos, Brasília,
Rio Grande do Sul, Santa Catarina, Cuiabá, Goiânia, Paraná).

## 4. Colocar o app no ar

O app é só HTML/JS estático (pasta `public/`) — sobe do mesmo jeito que
seus outros projetos na Vercel:

1. Suba a pasta `public/` (com `index.html`, `style.css`, `app.js`,
   `firebase-config.js` já preenchido) para um repositório no GitHub.
2. Na Vercel, "Add New Project" → importe o repositório → Root Directory
   = `public` → Deploy.
3. Pronto: o link gerado é o que você manda para cada base usar.

## 5. Uso do dia a dia

- Cada base entra com seu login e vê só os próprios registros.
- Você (admin) entra com seu login e enxerga todas as bases: na tela
  "Lançamentos" e "Indicadores" aparece um seletor para ver uma base
  específica ou "Todas as bases".
- Na aba **Parâmetros** (só aparece pro admin) você ajusta as metas de
  prazo, se a contagem é em dias úteis ou corridos, e a lista de
  feriados — um por linha, no formato `AAAA-MM-DD`.

## Sobre os cálculos

- **Até a confirmação** = data da confirmação − data da solicitação.
- **Confirmação → ASO** = data de saída do ASO − data da confirmação.
- **Total** = data de saída do ASO − data da solicitação.
- Cada um é comparado com a meta correspondente da aba Parâmetros para
  gerar a situação (No prazo / Fora do prazo / Aguardando ASO /
  Atrasado sem ASO / Pendente).

## Se quiser adicionar uma base nova depois

Edite a lista `bases` no documento `config/parametros` no Firestore (ou
pela aba Parâmetros do próprio app, se você adicionar essa lista lá) e
crie o login correspondente seguindo os passos 2 e 3.
