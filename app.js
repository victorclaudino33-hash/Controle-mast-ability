import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, query, where,
  getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const BASES_PADRAO = [
  "Osasco", "Rio de Janeiro", "São José dos Campos", "Brasília",
  "Rio Grande do Sul", "Santa Catarina", "Cuiabá", "Goiânia", "Paraná"
];

const estado = {
  perfil: null,       // { base, isAdmin, nome }
  parametros: null,   // { meta1, meta2, metaTotal, modo, feriados:Set, bases:[] }
  registros: [],       // cache da última busca
  editandoId: null,
};

// ---------- Utilidades de data ----------
function paraData(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function isoDeData(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function formatarBR(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function diasUteisEntre(d1, d2, feriados) {
  const inverte = d2 < d1;
  const [ini, fim] = inverte ? [d2, d1] : [d1, d2];
  let cur = new Date(ini);
  let contagem = 0;
  while (cur <= fim) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6 && !feriados.has(isoDeData(cur))) contagem++;
    cur.setDate(cur.getDate() + 1);
  }
  const valor = contagem - 1;
  return inverte ? -valor : valor;
}
function diasCorridosEntre(d1, d2) {
  return Math.round((d2 - d1) / 86400000);
}
function calcularDias(iso1, iso2) {
  if (!iso1 || !iso2) return null;
  const d1 = paraData(iso1), d2 = paraData(iso2);
  return estado.parametros.modo === "corridos"
    ? diasCorridosEntre(d1, d2)
    : diasUteisEntre(d1, d2, estado.parametros.feriados);
}
function media(lista) {
  const v = lista.filter(x => x !== null && x !== undefined);
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}
function fmt1(n) { return n === null || n === undefined ? "—" : n.toFixed(1); }
function fmtPct(n) { return n === null || n === undefined ? "—" : (n * 100).toFixed(0) + "%"; }

// ---------- Derivar campos de um registro ----------
function derivar(r) {
  const ateConfirmacao = calcularDias(r.dataSolicitacao, r.dataConfirmacao);
  const confirmacaoAso = calcularDias(r.dataConfirmacao, r.dataASO);
  const total = calcularDias(r.dataSolicitacao, r.dataASO);
  const hojeIso = isoDeData(new Date());
  const diasAberto = !r.dataASO && r.dataSolicitacao ? calcularDias(r.dataSolicitacao, hojeIso) : null;

  let situacao = "pendente";
  let situacaoTexto = "Pendente";
  if (r.dataASO) {
    situacao = total <= estado.parametros.metaTotal ? "no-prazo" : "fora-prazo";
    situacaoTexto = total <= estado.parametros.metaTotal ? "No prazo" : "Fora do prazo";
  } else if (r.dataConfirmacao || r.dataSolicitacao) {
    if (diasAberto !== null && diasAberto > estado.parametros.metaTotal) {
      situacao = "fora-prazo"; situacaoTexto = "Atrasado sem ASO";
    } else {
      situacao = "aguardando"; situacaoTexto = "Aguardando ASO";
    }
  }
  return { ...r, ateConfirmacao, confirmacaoAso, total, diasAberto, situacao, situacaoTexto };
}

// ---------- Login ----------
document.getElementById("form-login").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const senha = document.getElementById("login-senha").value;
  const erro = document.getElementById("login-erro");
  erro.hidden = true;
  try {
    await signInWithEmailAndPassword(auth, email, senha);
  } catch (e) {
    erro.textContent = "E-mail ou senha incorretos.";
    erro.hidden = false;
  }
});
document.getElementById("botao-sair").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    document.getElementById("tela-login").hidden = false;
    document.getElementById("app").hidden = true;
    return;
  }
  const perfilSnap = await getDoc(doc(db, "usuarios", user.uid));
  if (!perfilSnap.exists()) {
    alert("Este login não tem um perfil configurado (base/admin). Peça para o administrador cadastrar em usuarios/" + user.uid + " no Firestore.");
    await signOut(auth);
    return;
  }
  estado.perfil = perfilSnap.data();
  await carregarParametros();
  montarSelects();
  document.getElementById("tela-login").hidden = true;
  document.getElementById("app").hidden = false;
  document.getElementById("topo-base-atual").textContent = estado.perfil.isAdmin
    ? "Administrador — todas as bases"
    : estado.perfil.base;
  document.getElementById("nav-parametros").hidden = !estado.perfil.isAdmin;
  document.getElementById("ind-bloco-bases").hidden = !estado.perfil.isAdmin;
  irParaTela("registro");
});

async function carregarParametros() {
  const ref = doc(db, "config", "parametros");
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const d = snap.data();
    const meta1 = d.meta1 ?? 1;
    const meta2 = d.meta2 ?? 7;
    estado.parametros = {
      meta1, meta2,
      metaTotal: meta1 + meta2,
      modo: d.modo ?? "uteis",
      feriados: new Set(d.feriados ?? []),
      bases: (d.bases && d.bases.length ? d.bases : BASES_PADRAO),
    };
  } else {
    estado.parametros = { meta1: 1, meta2: 7, metaTotal: 8, modo: "uteis", feriados: new Set(), bases: BASES_PADRAO };
    if (estado.perfil.isAdmin) {
      await setDoc(ref, {
        meta1: 1, meta2: 7, metaTotal: 8, modo: "uteis",
        feriados: [], bases: BASES_PADRAO
      });
    }
  }
}

function montarSelects() {
  const bases = estado.parametros.bases;
  const fBase = document.getElementById("f-base");
  fBase.innerHTML = "";
  if (estado.perfil.isAdmin) {
    bases.forEach(b => fBase.appendChild(new Option(b, b)));
  } else {
    fBase.appendChild(new Option(estado.perfil.base, estado.perfil.base));
    fBase.disabled = true;
  }

  const filtroBase = document.getElementById("filtro-base");
  const indBase = document.getElementById("ind-base");
  if (estado.perfil.isAdmin) {
    [filtroBase, indBase].forEach(sel => {
      sel.hidden = false;
      sel.innerHTML = "";
      sel.appendChild(new Option("Todas as bases", ""));
      bases.forEach(b => sel.appendChild(new Option(b, b)));
    });
  }

  if (estado.perfil.isAdmin) {
    document.getElementById("p-meta1").value = estado.parametros.meta1;
    document.getElementById("p-meta2").value = estado.parametros.meta2;
    document.getElementById("p-total-calc").textContent = estado.parametros.meta1 + estado.parametros.meta2;
    document.getElementById("p-modo").value = estado.parametros.modo;
    document.getElementById("p-feriados").value = [...estado.parametros.feriados].sort().join("\n");
  }
}

// ---------- Navegação ----------
document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => irParaTela(btn.dataset.tela));
});
function irParaTela(nome) {
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("ativo", b.dataset.tela === nome));
  ["registro", "lista", "indicadores", "parametros"].forEach(t => {
    document.getElementById("tela-" + t).hidden = t !== nome;
  });
  if (nome === "lista") carregarLista();
  if (nome === "indicadores") carregarIndicadores();
}

// ---------- Novo registro / edição ----------
document.getElementById("form-registro").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = document.getElementById("registro-msg");
  const dados = {
    colaborador: document.getElementById("f-colaborador").value.trim(),
    cpf: document.getElementById("f-cpf").value.trim(),
    base: estado.perfil.isAdmin ? document.getElementById("f-base").value : estado.perfil.base,
    tipoExame: document.getElementById("f-tipo").value,
    dataSolicitacao: document.getElementById("f-solicitacao").value,
    dataConfirmacao: document.getElementById("f-confirmacao").value || null,
    dataASO: document.getElementById("f-aso").value || null,
    observacao: document.getElementById("f-obs").value.trim(),
    atualizadoEm: serverTimestamp(),
  };
  try {
    if (estado.editandoId) {
      await updateDoc(doc(db, "registros", estado.editandoId), dados);
    } else {
      dados.criadoPor = auth.currentUser.uid;
      dados.criadoEm = serverTimestamp();
      await addDoc(collection(db, "registros"), dados);
    }
    msg.textContent = "Registro salvo.";
    msg.className = "mensagem ok";
    msg.hidden = false;
    cancelarEdicao();
    document.getElementById("form-registro").reset();
    if (!estado.perfil.isAdmin) document.getElementById("f-base").value = estado.perfil.base;
  } catch (e) {
    msg.textContent = "Não foi possível salvar: " + e.message;
    msg.className = "mensagem erro";
    msg.hidden = false;
  }
});

function cancelarEdicao() {
  estado.editandoId = null;
  document.getElementById("registro-titulo").textContent = "Novo registro";
  document.getElementById("registro-cancelar-edicao").hidden = true;
  document.getElementById("f-base").disabled = !estado.perfil.isAdmin ? true : false;
}
document.getElementById("registro-cancelar-edicao").addEventListener("click", () => {
  document.getElementById("form-registro").reset();
  cancelarEdicao();
});

function editarRegistro(r) {
  estado.editandoId = r.id;
  document.getElementById("f-colaborador").value = r.colaborador;
  document.getElementById("f-cpf").value = r.cpf;
  document.getElementById("f-base").value = r.base;
  document.getElementById("f-tipo").value = r.tipoExame;
  document.getElementById("f-solicitacao").value = r.dataSolicitacao || "";
  document.getElementById("f-confirmacao").value = r.dataConfirmacao || "";
  document.getElementById("f-aso").value = r.dataASO || "";
  document.getElementById("f-obs").value = r.observacao || "";
  document.getElementById("registro-titulo").textContent = "Editar registro";
  document.getElementById("registro-cancelar-edicao").hidden = false;
  irParaTela("registro");
}

async function excluirRegistro(id) {
  if (!confirm("Excluir este registro? Essa ação não pode ser desfeita.")) return;
  await deleteDoc(doc(db, "registros", id));
  carregarLista();
}

// ---------- Busca de registros ----------
async function buscarRegistros() {
  const col = collection(db, "registros");
  let snap;
  if (estado.perfil.isAdmin) {
    snap = await getDocs(col);
  } else {
    snap = await getDocs(query(col, where("base", "==", estado.perfil.base)));
  }
  const lista = [];
  snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
  lista.sort((a, b) => (b.dataSolicitacao || "").localeCompare(a.dataSolicitacao || ""));
  estado.registros = lista.map(derivar);
  return estado.registros;
}

// ---------- Tela Lançamentos ----------
let debounceBusca = null;
document.getElementById("filtro-busca").addEventListener("input", () => {
  clearTimeout(debounceBusca);
  debounceBusca = setTimeout(renderizarLista, 200);
});
document.getElementById("filtro-base")?.addEventListener("change", renderizarLista);

async function carregarLista() {
  document.querySelector(".col-base").hidden = !estado.perfil.isAdmin;
  await buscarRegistros();
  renderizarLista();
}

function renderizarLista() {
  const termo = document.getElementById("filtro-busca").value.trim().toLowerCase();
  const baseSel = estado.perfil.isAdmin ? document.getElementById("filtro-base").value : "";
  let linhas = estado.registros;
  if (baseSel) linhas = linhas.filter(r => r.base === baseSel);
  if (termo) linhas = linhas.filter(r =>
    (r.colaborador || "").toLowerCase().includes(termo) || (r.cpf || "").includes(termo)
  );

  const corpo = document.getElementById("tabela-lista-corpo");
  corpo.innerHTML = "";
  document.getElementById("lista-vazio").hidden = linhas.length > 0;

  linhas.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.colaborador || "")}</td>
      <td>${escapeHtml(r.cpf || "")}</td>
      <td class="col-base" ${estado.perfil.isAdmin ? "" : "hidden"}>${escapeHtml(r.base || "")}</td>
      <td>${escapeHtml(r.tipoExame || "")}</td>
      <td>${formatarBR(r.dataSolicitacao)}</td>
      <td>${formatarBR(r.dataConfirmacao)}</td>
      <td>${formatarBR(r.dataASO)}</td>
      <td>${r.ateConfirmacao ?? "—"}</td>
      <td>${r.confirmacaoAso ?? "—"}</td>
      <td>${r.total ?? "—"}</td>
      <td><span class="situacao ${r.situacao}">${r.situacaoTexto}</span></td>
      <td></td>
    `;
    const tdAcoes = tr.lastElementChild;
    const bEditar = document.createElement("button");
    bEditar.className = "botao-icone"; bEditar.title = "Editar"; bEditar.textContent = "✎";
    bEditar.addEventListener("click", () => editarRegistro(r));
    const bExcluir = document.createElement("button");
    bExcluir.className = "botao-icone"; bExcluir.title = "Excluir"; bExcluir.textContent = "✕";
    bExcluir.style.marginLeft = "6px";
    bExcluir.addEventListener("click", () => excluirRegistro(r.id));
    tdAcoes.appendChild(bEditar);
    tdAcoes.appendChild(bExcluir);
    corpo.appendChild(tr);
  });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Tela Indicadores ----------
document.getElementById("ind-base")?.addEventListener("change", renderizarIndicadores);

async function carregarIndicadores() {
  await buscarRegistros();
  renderizarIndicadores();
}

function renderizarIndicadores() {
  const baseSel = estado.perfil.isAdmin ? document.getElementById("ind-base").value : "";
  const linhas = baseSel ? estado.registros.filter(r => r.base === baseSel) : estado.registros;

  const comConfirmacao = linhas.filter(r => r.ateConfirmacao !== null);
  const comAso = linhas.filter(r => r.total !== null);
  const semAso = linhas.filter(r => !r.dataASO);
  const atrasadosSemAso = linhas.filter(r => r.situacao === "fora-prazo" && !r.dataASO);
  const pctPrazo = lista => {
    const noPrazo = lista.filter(r => r.situacao === "no-prazo").length;
    const foraPrazo = lista.filter(r => r.situacao === "fora-prazo" && r.dataASO).length;
    const total = noPrazo + foraPrazo;
    return total ? noPrazo / total : null;
  };

  const cartoes = [
    ["Total de registros", linhas.length, false],
    ["Média até a confirmação (dias)", fmt1(media(comConfirmacao.map(r => r.ateConfirmacao))), false],
    ["Média confirmação → ASO (dias)", fmt1(media(comAso.map(r => r.confirmacaoAso))), false],
    ["Média total, solicitação → ASO (dias)", fmt1(media(comAso.map(r => r.total))), false],
    ["% no prazo (total)", fmtPct(pctPrazo(linhas)), false],
    ["Ainda sem ASO", semAso.length, false],
    ["Atrasados sem ASO", atrasadosSemAso.length, true],
  ];
  const cont = document.getElementById("ind-cartoes");
  cont.innerHTML = "";
  cartoes.forEach(([rot, val, destaque]) => {
    const div = document.createElement("div");
    div.className = "cartao-metrica";
    div.innerHTML = `<p class="rotulo">${rot}</p><p class="valor ${destaque ? "destaque" : ""}">${val}</p>`;
    cont.appendChild(div);
  });

  renderizarGraficoMensal(linhas);
  if (estado.perfil.isAdmin) renderizarTabelaBases();
}

function renderizarGraficoMensal(linhas) {
  const porMes = {};
  linhas.forEach(r => {
    if (!r.dataSolicitacao) return;
    const mes = r.dataSolicitacao.slice(0, 7);
    porMes[mes] = porMes[mes] || { ate: [], aso: [] };
    if (r.ateConfirmacao !== null) porMes[mes].ate.push(r.ateConfirmacao);
    if (r.total !== null) porMes[mes].aso.push(r.total);
  });
  const meses = Object.keys(porMes).sort();
  const alturaMax = 150;
  const maiorValor = Math.max(
    1, ...meses.flatMap(m => [media(porMes[m].ate) || 0, media(porMes[m].aso) || 0])
  );
  const cont = document.getElementById("ind-grafico-mensal");
  cont.innerHTML = "";
  if (!meses.length) {
    cont.innerHTML = `<p class="estado-vazio" style="padding:0;">Sem dados suficientes ainda.</p>`;
    return;
  }
  meses.forEach(m => {
    const mAte = media(porMes[m].ate), mAso = media(porMes[m].aso);
    const col = document.createElement("div");
    col.className = "gb-coluna";
    const [ano, mes] = m.split("-");
    const rotuloMes = new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
    col.innerHTML = `
      <div class="gb-barras">
        <div class="gb-barra solicitacao" title="Até confirmação: ${fmt1(mAte)} dias" style="height:${(mAte || 0) / maiorValor * alturaMax}px"></div>
        <div class="gb-barra aso" title="Total até o ASO: ${fmt1(mAso)} dias" style="height:${(mAso || 0) / maiorValor * alturaMax}px"></div>
      </div>
      <span class="gb-mes">${rotuloMes}</span>
    `;
    cont.appendChild(col);
  });
  if (!document.getElementById("gb-legenda-fixa")) {
    const leg = document.createElement("div");
    leg.id = "gb-legenda-fixa";
    leg.className = "gb-legenda";
    leg.innerHTML = `<span><i style="background:var(--cinza)"></i>Até confirmação</span><span><i style="background:var(--vermelho)"></i>Total até o ASO</span>`;
    document.getElementById("ind-grafico-mensal").after(leg);
  }
}

function renderizarTabelaBases() {
  const corpo = document.getElementById("ind-tabela-bases-corpo");
  corpo.innerHTML = "";
  estado.parametros.bases.forEach(base => {
    const linhas = estado.registros.filter(r => r.base === base);
    const comAso = linhas.filter(r => r.total !== null);
    const noPrazo = linhas.filter(r => r.situacao === "no-prazo").length;
    const foraPrazo = linhas.filter(r => r.situacao === "fora-prazo" && r.dataASO).length;
    const pct = (noPrazo + foraPrazo) ? noPrazo / (noPrazo + foraPrazo) : null;
    const semAso = linhas.filter(r => !r.dataASO).length;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${base}</td>
      <td>${linhas.length}</td>
      <td>${fmt1(media(linhas.filter(r => r.ateConfirmacao !== null).map(r => r.ateConfirmacao)))}</td>
      <td>${fmt1(media(comAso.map(r => r.confirmacaoAso)))}</td>
      <td>${fmt1(media(comAso.map(r => r.total)))}</td>
      <td>${fmtPct(pct)}</td>
      <td>${semAso}</td>
    `;
    corpo.appendChild(tr);
  });
}

// ---------- Parâmetros (admin) ----------
document.getElementById("form-parametros")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = document.getElementById("parametros-msg");
  const feriados = document.getElementById("p-feriados").value
    .split("\n").map(s => s.trim()).filter(Boolean);
  const meta1 = Number(document.getElementById("p-meta1").value);
  const meta2 = Number(document.getElementById("p-meta2").value);
  const dados = {
    meta1, meta2, metaTotal: meta1 + meta2,
    modo: document.getElementById("p-modo").value,
    feriados,
    bases: estado.parametros.bases,
  };
  try {
    await setDoc(doc(db, "config", "parametros"), dados);
    estado.parametros = { ...dados, feriados: new Set(feriados) };
    msg.textContent = "Parâmetros salvos.";
    msg.className = "mensagem ok";
    msg.hidden = false;
  } catch (e) {
    msg.textContent = "Não foi possível salvar: " + e.message;
    msg.className = "mensagem erro";
    msg.hidden = false;
  }
});
