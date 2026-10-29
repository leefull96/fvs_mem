import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, updatePassword, reauthenticateWithCredential, EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, serverTimestamp, writeBatch, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, EMAIL_DOMAIN, OPTIONS, DEFAULT_DB } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ---------- 유틸 ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const won = n => (Number(n) || 0).toLocaleString("ko-KR");
const toNum = v => Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0;
const digits = v => String(v ?? "").replace(/\D/g, "");
const nk = s => String(s ?? "").replace(/\s/g, "").toLowerCase();
const fmtPhone = v => {
  const d = digits(v);
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return v;
};
const emailOf = id => `${id.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hidden"), 3200);
}
const authMsg = e => ({
  "auth/invalid-credential": "아이디 또는 비밀번호가 올바르지 않습니다.",
  "auth/wrong-password": "비밀번호가 올바르지 않습니다.",
  "auth/user-not-found": "존재하지 않는 아이디입니다.",
  "auth/too-many-requests": "시도가 너무 많습니다. 잠시 후 다시 시도하세요.",
  "auth/email-already-in-use": "이미 사용 중인 아이디입니다.",
  "auth/weak-password": "비밀번호는 6자 이상이어야 합니다.",
  "auth/network-request-failed": "네트워크 오류입니다."
}[e.code] || `오류: ${e.code || e.message}`);
function closeModal() { $("#modalRoot").innerHTML = ""; }

/* ---------- 상태 ---------- */
let me = null;                 // {uid, name, role, loginId}  role: super | admin | sales
let tab = "list";
let ym = todayStr().slice(0, 7);
let filterUid = "";            // 관리자 사원 필터
let loadedKey = "";           // 마지막으로 불러온 (월|사원) — 탭 이동 시 갱신 여부 판단
let callUid = "";              // 일별 콜량 탭에서 관리자가 고른 사원
let search = "";
let contracts = [], dailies = [], users = [], pendings = [], transfers = [];
const selected = new Set();    // 관리자 목록에서 체크한 회원 id
const PEND = "pending:";       // 아직 계정이 없는 담당자의 ownerUid 접두어
const pendId = n => n.replace(/[\/\s]+/g, "_");
let settings = { realtime: [...DEFAULT_DB.realtime], old: [...DEFAULT_DB.old] };

const isSuper = () => me?.role === "super";
const isAdmin = () => me?.role === "admin" || me?.role === "super";
const roleLabel = r => ({ super: "슈퍼 관리자", admin: "일반 관리자", sales: "영업사원" }[r] || r);
const nameOf = uid => String(uid || "").startsWith(PEND) ? `${uid.slice(PEND.length)} (미가입)`
  : users.find(u => u.uid === uid)?.name || (uid === me?.uid ? me.name : "(알수없음)");
const ownerOptions = sel => users.map(u => `<option value="${u.uid}" ${u.uid === sel ? "selected" : ""}>${esc(u.name)}</option>`).join("")
  + pendings.map(p => `<option value="${PEND}${esc(p.name)}" ${PEND + p.name === sel ? "selected" : ""}>${esc(p.name)} (미가입)</option>`).join("");

/* 금액·분류 */
const amt = c => Number(c.amount) || 0;
const isRefund = c => amt(c) < 0;
const isUpsell = c => c.contractType === "업셀";

/* ---------- 계약 기간 (시작일·종료일·무료 바우처) ---------- */
const isDate = s => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
// yyyy-mm-dd 에 일/주/개월/년을 더한다. (개월·년은 말일을 넘으면 그 달 말일로 맞춤)
function addSpan(s, qty, unit) {
  const [y, m, d] = s.split("-").map(Number);
  let dt;
  if (unit === "일" || unit === "주") dt = new Date(Date.UTC(y, m - 1, d + qty * (unit === "주" ? 7 : 1)));
  else {
    const t = m - 1 + (unit === "년" ? qty * 12 : qty), yy = y + Math.floor(t / 12), mm = ((t % 12) + 12) % 12;
    const dim = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    dt = new Date(Date.UTC(yy, mm, Math.min(d, dim)));
  }
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
// 시작일·종료일·바우처로 최종 종료일과 표기 문구를 만든다. 문제가 있으면 error.
function buildPeriod(start, end, qty, unit) {
  if (!start && !end) return qty ? { error: "무료 바우처를 반영하려면 계약 시작일과 종료일을 입력하세요." } : { period: "", endFinal: "" };
  if (!isDate(start) || !isDate(end)) return { error: "계약 시작일과 종료일을 yyyy-mm-dd 형식(예: 2026-10-01)으로 모두 입력하세요." };
  if (end < start) return { error: "계약 종료일이 시작일보다 빠를 수 없습니다." };
  const endFinal = qty > 0 ? addSpan(end, qty, unit) : end;
  return { endFinal, period: `${start} ~ ${endFinal}${qty > 0 ? " (무료 바우처 기간 포함)" : ""}` };
}
// 엑셀의 "26. 10. 1 ~ 26. 11. 1" 같은 문구를 yyyy-mm-dd 로 읽는다.
function parsePeriodText(t) {
  const m = /(\d{2,4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*~\s*(\d{2,4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/.exec(String(t || ""));
  if (!m) return null;
  const Y = v => String(v.length === 2 ? 2000 + +v : v);
  const a = `${Y(m[1])}-${pad(+m[2])}-${pad(+m[3])}`, b = `${Y(m[4])}-${pad(+m[5])}-${pad(+m[6])}`;
  return isDate(a) && isDate(b) ? { startDate: a, endDate: b, endFinal: b, period: `${a} ~ ${b}` } : null;
}

/* ---------- DB 출처 (실시간 / 구디비) ---------- */
const allSources = () => [...new Set([...settings.realtime, ...settings.old])];
const srcTags = n => [settings.realtime.includes(n) ? "실시간" : null, settings.old.includes(n) ? "구디비" : null].filter(Boolean);
function dbOptions(sel) {
  const list = allSources(); if (sel && !list.includes(sel)) list.push(sel);
  return `<option value=""></option>` + list.map(s => {
    const t = srcTags(s);
    return `<option value="${esc(s)}" ${s === sel ? "selected" : ""}>${esc(s)} (${t.length ? t.join("/") : "미등록"})</option>`;
  }).join("");
}
// 상태와 DB 출처가 맞지 않으면 안내 문구를 돌려준다. 맞으면 "".
function checkSource(status, src) {
  if (!status || !src) return "";
  if (status === "실시간" && !settings.realtime.includes(src))
    return `⚠ 잘못 기입하신 것 같습니다.\n\n상태가 '실시간'이면 DB 출처는 [${settings.realtime.join(", ")}] 중에서만 선택할 수 있습니다.\n'${src}'은(는) 실시간 DB 출처가 아닙니다.`;
  if (status === "구디비" && !settings.old.includes(src))
    return `⚠ 잘못 기입하신 것 같습니다.\n\n상태가 '구디비'이면 DB 출처는 [${settings.old.join(", ")}] 중에서만 선택할 수 있습니다.\n'${src}'은(는) 구디비 DB 출처가 아닙니다.`;
  return "";
}
async function loadSettings() {
  try {
    const s = await getDoc(doc(db, "settings", "db"));
    if (s.exists()) { const d = s.data(); settings = { realtime: d.realtime || [], old: d.old || [] }; }
  } catch (e) { console.warn("설정을 불러오지 못해 기본값을 사용합니다.", e); }
}

/* ---------- 로그인 ---------- */
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault(); $("#lerr").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, emailOf($("#lid").value), $("#lpw").value);
  } catch (err) { $("#lerr").textContent = authMsg(err); }
});
$("#btnOut").onclick = () => signOut(auth);

onAuthStateChanged(auth, async user => {
  if (!user) { me = null; $("#app").classList.add("hidden"); $("#login").classList.remove("hidden"); return; }
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists() || snap.data().active !== true) {
      await signOut(auth);
      $("#lerr").textContent = "사용이 중지되었거나 등록되지 않은 계정입니다. 관리자에게 문의하세요.";
      return;
    }
    const d = snap.data();
    me = { uid: user.uid, name: d.name, role: d.role, loginId: d.loginId };
    $("#who").textContent = `${me.name} (${roleLabel(me.role)})`;
    $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
    tab = "list"; filterUid = ""; callUid = ""; search = ""; selected.clear();
    await loadSettings();
    if (isAdmin()) await loadUsers();
    buildTabs(); await loadMonth(); render();
  } catch (err) {
    console.error(err);
    await signOut(auth);
    $("#lerr").textContent = "계정 정보를 불러오지 못했습니다. (보안 규칙/설정을 확인하세요)";
  }
});

/* ---------- 데이터 로드 ---------- */
async function loadUsers() {
  const s = await getDocs(collection(db, "users"));
  users = s.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
  const p = await getDocs(collection(db, "pending"));
  pendings = p.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
  // '담당자 이관 중'인 회원(대상 계정이 아직 없음)을 대상 이름·아이디별로 묶는다.
  const t = await getDocs(query(collection(db, "contracts"), where("transferLoginId", ">", "")));
  const g = new Map();
  t.docs.forEach(d => {
    const v = d.data(), k = `${v.transferLoginId}|${nk(v.transferName)}`;
    const o = g.get(k) || { loginId: v.transferLoginId, name: v.transferName, count: 0, froms: new Set() };
    o.count++; o.froms.add(v.ownerUid); g.set(k, o);
  });
  transfers = [...g.values()];
}
async function loadMonth() {
  const own = (isAdmin() ? (filterUid ? [where("ownerUid", "==", filterUid)] : []) : [where("ownerUid", "==", me.uid)]);
  const [a, c] = await Promise.all([
    getDocs(query(collection(db, "contracts"), ...own, where("ym", "==", ym))),
    getDocs(query(collection(db, "daily"), ...own, where("ym", "==", ym)))
  ]);
  contracts = a.docs.map(d => ({ id: d.id, ...d.data() }));
  dailies = c.docs.map(d => ({ id: d.id, ...d.data() }));
  loadedKey = `${ym}|${filterUid}`;
}

/* ---------- 탭 ---------- */
function buildTabs() {
  const items = [["list", "회원 목록·입력"], ["calls", "일별 콜량 입력"]];
  if (isSuper()) items.push(["stats", "영업 데이터 통계"]);
  if (isAdmin()) items.push(["users", "사원 관리"]);
  if (isSuper()) items.push(["settings", "DB 출처 설정"]);
  $("#tabs").innerHTML = items.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("");
  $("#tabs").onclick = async e => {
    const t = e.target.dataset.t; if (!t) return;
    tab = t; buildTabs();
    if (t === "users") await loadUsers();
    if ((t === "list" || t === "calls") && loadedKey !== `${ym}|${filterUid}`) await loadMonth();
    if (t === "settings") { await loadSettings(); draft = null; }
    render();
  };
}
function render() {
  if (tab === "list") renderList();
  else if (tab === "calls") renderCalls();
  else if (tab === "stats") renderStats();
  else if (tab === "users") renderUsers();
  else if (tab === "settings") renderSettings();
}

/* ---------- 공통 바 (월/사원 선택) ---------- */
function monthBar(extra = "") {
  const sel = isAdmin()
    ? `<div><label>사원</label><select id="fUid"><option value="">전체</option>${ownerOptions(filterUid)}</select></div>` : "";
  return `<div class="bar"><div><label>조회 월</label><input type="month" id="fYm" value="${ym}"></div>${sel}${extra}</div>`;
}
function bindMonthBar() {
  $("#fYm").onchange = async e => { if (!e.target.value) return; ym = e.target.value; await loadMonth(); render(); };
  const s = $("#fUid"); if (s) s.onchange = async e => { filterUid = e.target.value; await loadMonth(); render(); };
}

/* ---------- 회원 목록 ---------- */
function renderList() {
  const kw = search.trim().toLowerCase();
  const rows = contracts
    .filter(c => !kw || `${c.name} ${c.phone} ${c.dbSource} ${c.note} ${c.upsellNote}`.toLowerCase().includes(kw))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || ((b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
  const ok = rows.filter(c => !isRefund(c));
  const sNew = ok.filter(c => !isUpsell(c)).reduce((s, c) => s + amt(c), 0);
  const sUp = ok.filter(isUpsell).reduce((s, c) => s + amt(c), 0);
  const refunds = rows.filter(isRefund), sRef = refunds.reduce((s, c) => s + amt(c), 0);
  const adm = isAdmin();

  $("#view").innerHTML = `
    <div class="card">
      ${monthBar(`<div class="grow"><label>검색 (이름·전화·DB·비고)</label><input id="fSearch" value="${esc(search)}" placeholder="검색어"></div>
        <button class="btn" id="btnNew">+ 회원 추가</button>
        ${adm ? '<button class="btn ghost" id="btnTr">선택 회원 이관</button><button class="btn danger" id="btnDel">선택 삭제</button>' : ""}
        <button class="btn ghost" id="btnImp">엑셀 가져오기</button>
        <button class="btn ghost" id="btnCsv">엑셀(CSV) 저장</button>`)}
      <div class="sum">
        <div><span class="muted">건수 (환불 제외)</span><b>${ok.length}건</b></div>
        <div><span class="muted">신규 금액</span><b>${won(sNew)}원</b></div>
        <div><span class="muted">업셀 금액</span><b>${won(sUp)}원</b></div>
        <div><span class="muted">환불 ${refunds.length}건</span><b style="color:var(--red)">${won(sRef)}원</b></div>
        <div><span class="muted">합계 (환불 반영)</span><b>${won(sNew + sUp + sRef)}원</b></div>
      </div>
      <div class="tblwrap"><table>
        <thead><tr>${adm ? '<th><input type="checkbox" id="selAll" style="width:auto"></th>' : ""}<th>입금 날짜</th>${adm ? "<th>담당자</th><th>담당자 이관 중</th>" : ""}<th>회원명</th><th>전화번호</th><th>DB 출처</th><th>상태</th><th>계약 분류</th><th>등급 분류</th><th class="n">계약 금액</th><th>환불</th><th>계약 기간</th><th>업셀 여부 / 비고</th></tr></thead>
        <tbody>${rows.map((c, i) => `<tr class="click ${isRefund(c) ? "refund" : ""}" data-id="${c.id}">
          ${adm ? `<td class="sel"><input type="checkbox" data-sel="${c.id}" data-idx="${i}" style="width:auto" ${selected.has(c.id) ? "checked" : ""}></td>` : ""}
          <td>${esc(c.date)}</td>${adm ? `<td>${esc(nameOf(c.ownerUid))}</td><td>${c.transferLoginId ? `<span class="tag warn">→ ${esc(c.transferName)} (${esc(c.transferLoginId)})</span>` : ""}</td>` : ""}
          <td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${esc(c.dbSource)}</td><td>${esc(c.status)}</td><td>${esc(c.contractType)}</td><td>${esc(c.grade)}</td>
          <td class="n">${won(amt(c))}</td><td>${isRefund(c) ? '<span class="tag off">환불</span>' : ""}</td><td>${esc(c.period)}</td>
          <td>${esc([c.upsellNote, c.note].filter(Boolean).join(" / ").slice(0, 24))}</td></tr>`).join("") || `<tr><td colspan="14" class="muted" style="padding:24px;text-align:center">데이터가 없습니다.</td></tr>`}</tbody>
      </table></div>
      <p class="muted">행을 누르면 수정·삭제할 수 있습니다. 환불(계약 금액이 음수) 행은 빨간 배경으로 표시되며, 누르면 본 계약을 확인할 수 있습니다.${adm ? " 체크박스는 Shift를 누른 채 클릭하면 연속으로 선택됩니다." : ""}</p>
    </div>`;
  bindMonthBar();
  $("#fSearch").oninput = e => { search = e.target.value; const pos = e.target.selectionStart; renderList(); const i = $("#fSearch"); i.focus(); i.setSelectionRange(pos, pos); };
  $("#btnNew").onclick = () => openForm(null);
  $("#btnCsv").onclick = () => exportCsv(rows);
  $("#btnImp").onclick = openImport;
  if (adm) {
    const visible = new Set(rows.map(c => c.id));
    [...selected].forEach(id => { if (!visible.has(id)) selected.delete(id); });
    const cbs = [...$("#view").querySelectorAll("input[data-sel]")];
    const upd = () => {
      $("#btnTr").textContent = selected.size ? `선택 회원 이관 (${selected.size})` : "선택 회원 이관";
      $("#btnDel").textContent = selected.size ? `선택 삭제 (${selected.size})` : "선택 삭제";
      $("#selAll").checked = rows.length > 0 && selected.size === rows.length;
    };
    upd();
    $("#selAll").onchange = e => { rows.forEach(c => e.target.checked ? selected.add(c.id) : selected.delete(c.id)); cbs.forEach(cb => cb.checked = e.target.checked); upd(); };
    let last = -1;   // 마지막으로 클릭한 체크박스 위치 (Shift 연속 선택용)
    cbs.forEach(cb => cb.onclick = e => {
      const i = +cb.dataset.idx, on = cb.checked;
      if (e.shiftKey && last >= 0) {
        for (let k = Math.min(i, last); k <= Math.max(i, last); k++) { cbs[k].checked = on; on ? selected.add(rows[k].id) : selected.delete(rows[k].id); }
      } else on ? selected.add(cb.dataset.sel) : selected.delete(cb.dataset.sel);
      last = i; upd();
    });
    $("#btnTr").onclick = transferSelected;
    $("#btnDel").onclick = deleteSelected;
  }
  $("#view").querySelector("tbody").onclick = e => {
    if (e.target.closest("td.sel") || e.target.closest("input")) return;
    const tr = e.target.closest("tr[data-id]"); if (!tr) return;
    const c = contracts.find(x => x.id === tr.dataset.id);
    if (isRefund(c)) askRefund(c); else openForm(c);
  };
}

async function deleteSelected() {
  if (!selected.size) return toast("삭제할 회원을 먼저 체크하세요.");
  if (!confirm(`체크한 회원 ${selected.size}건을 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
  try {
    await commitOps([...selected].map(id => b => b.delete(doc(db, "contracts", id))));
    const n = selected.size; selected.clear();
    await loadMonth(); render(); toast(`${n}건을 삭제했습니다.`);
  } catch (er) { console.error(er); toast("삭제 실패: " + (er.code || er.message)); }
}

/* ---------- 환불 행 → 본 계약 확인 ---------- */
function askRefund(c) {
  $("#modalRoot").innerHTML = `<div class="modal"><div class="box" style="max-width:420px">
    <h2>환불 건</h2>
    <p style="margin:0 0 6px"><b>${esc(c.name)}</b> (${esc(c.phone)}) · ${won(amt(c))}원</p>
    <p>해당 회원의 본 계약 건을 확인하시겠습니까?</p>
    <div class="actions"><button class="btn ghost" id="rno">아니오 (이 환불 건 수정)</button><button class="btn" id="ryes">예</button></div></div></div>`;
  $("#rno").onclick = () => { closeModal(); openForm(c); };
  $("#ryes").onclick = async () => {
    closeModal();
    const key = digits(c.phone);
    if (!key) return alert("이 환불 건에 전화번호가 없어 본 계약을 찾을 수 없습니다.");
    try {
      const own = isAdmin() ? [] : [where("ownerUid", "==", me.uid)];
      const s = await getDocs(query(collection(db, "contracts"), ...own, where("phoneKey", "==", key)));
      const list = s.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(x => x.id !== c.id && nk(x.name) === nk(c.name) && amt(x) >= 0)
        .sort((a, b) => (a.date || "").localeCompare(b.date || "") || ((a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)));
      if (!list.length) return alert("회원명과 전화번호가 모두 일치하는 본 계약 건이 없습니다.");
      showOriginals(list, c);
    } catch (er) { console.error(er); alert("본 계약을 불러오지 못했습니다: " + (er.code || er.message)); }
  };
}
function showOriginals(list, refund) {
  let i = list.length - 1;     // 가장 최근 계약부터
  const draw = () => {
    const x = list[i];
    const row = (k, v) => `<dt>${k}</dt><dd>${v === "" || v == null ? '<span class="muted">-</span>' : esc(v)}</dd>`;
    $("#modalRoot").innerHTML = `<div class="modal"><div class="box" style="max-width:760px">
      <div class="vhead"><b>${esc(refund.name)} (${esc(refund.phone)}) 님의 본 계약</b><span class="muted">${i + 1} / ${list.length}${i === list.length - 1 ? " · 가장 최근" : ""}</span></div>
      <div class="vrow">
        <button class="vnav" id="vprev" title="이전 계약" ${i === 0 ? "disabled" : ""}>&lt;</button>
        <dl class="vcard">
          ${row("입금 날짜", x.date)}${isAdmin() ? row("담당자", nameOf(x.ownerUid)) : ""}${row("회원명", x.name)}${row("전화번호", x.phone)}
          ${row("DB 출처", x.dbSource)}${row("상태", x.status)}${row("계약 분류", x.contractType)}${row("등급 분류", x.grade)}
          ${row("계약 금액", won(amt(x)) + "원")}${row("계약 기간", x.period)}${row("무료 바우처", x.voucher)}${row("업셀 여부", x.upsellNote)}${row("비고", x.note)}
        </dl>
        <button class="vnav" id="vnext" title="다음 계약" ${i === list.length - 1 ? "disabled" : ""}>&gt;</button>
      </div>
      <div class="actions"><button class="btn ghost" id="vedit">이 계약 수정</button><button class="btn" id="vclose">닫기</button></div></div></div>`;
    $("#vprev").onclick = () => { if (i > 0) { i--; draw(); } };
    $("#vnext").onclick = () => { if (i < list.length - 1) { i++; draw(); } };
    $("#vclose").onclick = closeModal;
    $("#vedit").onclick = () => { closeModal(); openForm(x); };
  };
  draw();
}

/* ---------- 회원 입력/수정 모달 ---------- */
function openForm(c) {
  const e = c || { date: todayStr(), status: "", contractType: OPTIONS.contractType[0], grades: [] };
  const opt = (arr, v) => `<option value=""></option>` + (v && !arr.includes(v) ? [...arr, v] : arr).map(x => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("");
  $("#modalRoot").innerHTML = `<div class="modal"><form class="box" id="cf">
    <h2>${c ? "회원 정보 수정" : "회원 추가"}</h2>
    <div class="grid">
      ${isAdmin() ? `<div class="full"><label>담당자</label><select name="owner">${ownerOptions(c ? c.ownerUid : (filterUid || me.uid))}</select></div>` : ""}
      <div><label>입금 날짜 *</label><input type="date" name="date" value="${esc(e.date)}" required></div>
      <div><label>회원명 *</label><input name="name" value="${esc(e.name)}" required></div>
      <div><label>전화번호 *</label><input name="phone" inputmode="tel" value="${esc(e.phone)}" required></div>
      <div><label>DB 출처 (실시간/구디비 구분 표시)</label><select name="dbSource">${dbOptions(e.dbSource)}</select></div>
      <div><label>상태</label><select name="status">${opt(OPTIONS.status, e.status)}</select></div>
      <div><label>계약 분류</label><select name="contractType">${opt(OPTIONS.contractType, e.contractType)}</select></div>
      <div class="full"><label>등급 분류 (복수 선택)</label><div class="chk">${[...new Set([...OPTIONS.grades, ...(e.grades || [])])].map(g => `<label><input type="checkbox" name="grades" value="${esc(g)}" ${(e.grades || []).includes(g) ? "checked" : ""}>${esc(g)}</label>`).join("")}</div></div>
      <div><label>계약 금액 (원) — 환불은 음수(-)로 입력</label><input name="amount" inputmode="numeric" value="${e.amount ? won(e.amount) : ""}"></div>
      <div><label>업셀 여부</label><input name="upsellNote" value="${esc(e.upsellNote)}" placeholder="자유 기재"></div>
      <div class="full" id="rhint" style="margin-top:-6px"></div>
      <div><label>계약 시작일 (yyyy-mm-dd)</label><input name="startDate" inputmode="numeric" maxlength="10" placeholder="2026-10-01" autocomplete="off" value="${esc(e.startDate)}"></div>
      <div><label>계약 종료일 (yyyy-mm-dd)</label><input name="endDate" inputmode="numeric" maxlength="10" placeholder="2026-11-01" autocomplete="off" value="${esc(e.endDate)}"></div>
      <div><label>무료 바우처 (수치 + 단위)</label>
        <div style="display:flex;gap:8px"><input name="vqty" type="number" min="1" step="1" inputmode="numeric" placeholder="수치" value="${e.voucherQty || ""}" style="flex:1">
        <select name="vunit" style="flex:1">${["일", "주", "개월", "년"].map(u => `<option ${u === (e.voucherUnit || "일") ? "selected" : ""}>${u}</option>`).join("")}</select></div></div>
      <div id="phint" class="muted" style="align-self:end;padding-bottom:9px"></div>
      ${c && c.period && !c.startDate ? `<div class="full muted">기존에 입력된 계약 기간: ${esc(c.period)} (시작일·종료일을 입력하면 바뀝니다)</div>` : ""}
      ${c && c.voucher && !c.voucherQty ? `<div class="full muted">기존에 입력된 무료 바우처: ${esc(c.voucher)}</div>` : ""}
      <div class="full"><label>비고</label><textarea name="note">${esc(e.note)}</textarea></div>
    </div>
    <div class="err" id="cerr"></div>
    <div class="actions">${c ? `<button type="button" class="btn danger left" id="cdel">삭제</button>` : ""}
      <button type="button" class="btn ghost" id="ccancel">취소</button><button class="btn">저장</button></div>
  </form></div>`;
  const f = $("#cf");
  f.phone.onblur = () => f.phone.value = fmtPhone(f.phone.value);
  f.amount.onblur = () => f.amount.value = f.amount.value ? won(toNum(f.amount.value)) : "";
  const hint = () => { $("#rhint").innerHTML = toNum(f.amount.value) < 0 ? '<span class="tag off">환불</span> <span class="muted">계약 금액이 0보다 작아 환불로 표시됩니다.</span>' : ""; };
  f.amount.oninput = hint; hint();
  const phint = () => {
    const r = buildPeriod(f.startDate.value.trim(), f.endDate.value.trim(), Math.floor(Number(f.vqty.value)) || 0, f.vunit.value);
    $("#phint").innerHTML = r.error || !r.period ? "" : `계약 기간: <b>${esc(r.period)}</b>`;
  };
  [f.startDate, f.endDate].forEach(el => el.oninput = () => {
    const d = el.value.replace(/\D/g, "").slice(0, 8);
    el.value = d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
    phint();
  });
  f.vqty.oninput = phint; f.vunit.onchange = phint; phint();
  const warn = () => { const m = checkSource(f.status.value, f.dbSource.value); if (m) alert(m); };
  f.dbSource.onchange = warn; f.status.onchange = warn;
  $("#ccancel").onclick = closeModal;
  if (c) $("#cdel").onclick = async () => {
    if (!confirm(`'${c.name}' 회원을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try { await deleteDoc(doc(db, "contracts", c.id)); closeModal(); toast("삭제되었습니다."); await loadMonth(); render(); }
    catch (er) { $("#cerr").textContent = "삭제 실패: " + (er.code || er.message); }
  };
  f.onsubmit = async ev => {
    ev.preventDefault();
    const v = new FormData(f);
    const bad = checkSource(v.get("status"), v.get("dbSource"));
    if (bad) { alert(bad); return; }
    const grades = v.getAll("grades");
    const vqty = Math.floor(Number(v.get("vqty"))) || 0, vunit = v.get("vunit");
    const per = buildPeriod(v.get("startDate").trim(), v.get("endDate").trim(), vqty, vunit);
    if (per.error) { alert(per.error); return; }
    const date = v.get("date"), phone = fmtPhone(v.get("phone").trim());
    const data = {
      ownerUid: isAdmin() ? v.get("owner") : (c ? c.ownerUid : me.uid),
      date, ym: date.slice(0, 7),
      name: v.get("name").trim(), phone, phoneKey: digits(phone),
      dbSource: v.get("dbSource"), status: v.get("status"), contractType: v.get("contractType"),
      grades, grade: grades.join(", "),
      amount: toNum(v.get("amount")),
      startDate: v.get("startDate").trim(), endDate: v.get("endDate").trim(), endFinal: per.endFinal,
      period: per.period || (c && !c.startDate ? c.period || "" : ""),
      voucherQty: vqty, voucherUnit: vqty ? vunit : "",
      voucher: vqty ? `${vqty}${vunit}` : (c && !c.voucherQty ? c.voucher || "" : ""),
      upsellNote: v.get("upsellNote").trim(), note: v.get("note").trim(),
      updatedAt: serverTimestamp()
    };
    if (isAdmin() && c && data.ownerUid !== c.ownerUid) { data.transferName = deleteField(); data.transferLoginId = deleteField(); }
    try {
      if (c) await updateDoc(doc(db, "contracts", c.id), data);
      else { data.createdAt = serverTimestamp(); await addDoc(collection(db, "contracts"), data); }
      closeModal(); toast("저장되었습니다.");
      if (data.ym !== ym) ym = data.ym;
      await loadMonth(); render();
    } catch (er) { console.error(er); $("#cerr").textContent = "저장 실패: " + (er.code || er.message); }
  };
}

/* ---------- CSV ---------- */
const csvQ = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
function downloadCsv(lines, name) {
  const blob = new Blob(["﻿" + lines.map(r => r.map(csvQ).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function exportCsv(rows) {
  const head = ["입금 날짜", "담당자", "회원명", "전화번호", "DB 출처", "상태", "계약 분류", "등급 분류", "계약 금액", "환불", "계약 기간", "무료 바우처", "업셀 여부", "비고", "이관 중 대상"];
  downloadCsv([head, ...rows.map(c => [c.date, nameOf(c.ownerUid), c.name, c.phone, c.dbSource, c.status, c.contractType, c.grade, amt(c), isRefund(c) ? "환불" : "", c.period, c.voucher, c.upsellNote, c.note, c.transferLoginId ? `${c.transferName}(${c.transferLoginId})` : ""])], `회원목록_${ym}.csv`);
}

/* ---------- 일별 콜량 입력 ---------- */
async function renderCalls() {
  if (isAdmin() && !callUid) callUid = filterUid || users.find(u => u.role === "sales")?.uid || "";
  const owner = isAdmin() ? callUid : me.uid;
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const days = Array.from({ length: last }, (_, i) => `${ym}-${pad(i + 1)}`);
  let list = [];
  if (owner) {
    try {
      const s = await getDocs(query(collection(db, "daily"), where("ownerUid", "==", owner), where("ym", "==", ym)));
      list = s.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (er) { console.error(er); toast("콜량을 불러오지 못했습니다: " + (er.code || er.message)); }
  }
  if (tab !== "calls") return;
  const byDate = new Map(list.map(x => [x.date, x]));
  const wd = d => "일월화수목금토"[new Date(d + "T00:00:00").getDay()];
  const today = todayStr();
  $("#view").innerHTML = `<div class="card">
    <div class="bar"><div><label>조회 월</label><input type="month" id="cYm" value="${ym}"></div>
      ${isAdmin() ? `<div><label>사원</label><select id="cUid"><option value="">선택하세요</option>${ownerOptions(callUid)}</select></div>` : ""}
      <button class="btn" id="cSave">저장</button></div>
    ${owner ? `<p class="muted" style="margin-top:0">날짜별 콜량(건)과 콜 시간(분)을 입력하고 <b>저장</b>을 누르세요. 비워 두면 0으로 처리됩니다. 입력 후 저장하지 않고 다른 화면으로 가면 사라집니다.</p>
    <div class="tblwrap"><table><thead><tr><th>날짜</th><th class="n">콜량 (건)</th><th class="n">콜 시간 (분)</th></tr></thead>
      <tbody>${days.map(d => { const x = byDate.get(d); return `<tr class="${d === today ? "today" : ""}"><td>${d.slice(5).replace("-", "/")} (${wd(d)})</td>
        <td class="n"><input type="number" min="0" class="cc" data-d="${d}" value="${x?.callCount ?? ""}" style="max-width:110px;text-align:right"></td>
        <td class="n"><input type="number" min="0" class="ct" data-d="${d}" value="${x?.callTime ?? ""}" style="max-width:110px;text-align:right"></td></tr>`; }).join("")}</tbody>
      <tfoot><tr><td>합계</td><td class="n" id="sumC"></td><td class="n" id="sumT"></td></tr></tfoot></table></div>`
    : `<p class="muted">입력할 사원을 선택하세요.</p>`}</div>`;
  $("#cYm").onchange = async e => { if (!e.target.value) return; ym = e.target.value; await loadMonth(); renderCalls(); };
  if (isAdmin()) $("#cUid").onchange = e => { callUid = e.target.value; renderCalls(); };
  if (!owner) { $("#cSave").disabled = true; return; }
  const sums = () => {
    const sum = sel => [...$("#view").querySelectorAll(sel)].reduce((s, i) => s + toNum(i.value), 0);
    $("#sumC").textContent = won(sum("input.cc")); $("#sumT").textContent = won(sum("input.ct"));
  };
  sums(); $("#view").querySelectorAll("input.cc,input.ct").forEach(i => i.oninput = sums);
  const t = $("#view").querySelector("tr.today"); if (t) t.scrollIntoView({ block: "center" });
  $("#cSave").onclick = async () => {
    const ops = [];
    days.forEach(d => {
      const cc = toNum($(`input.cc[data-d="${d}"]`).value), ct = toNum($(`input.ct[data-d="${d}"]`).value);
      const old = byDate.get(d);
      if ((old?.callCount || 0) === cc && (old?.callTime || 0) === ct) return;
      ops.push(b => b.set(doc(db, "daily", `${owner}_${d}`), { ownerUid: owner, date: d, ym, callCount: cc, callTime: ct, updatedAt: serverTimestamp() }, { merge: true }));
    });
    if (!ops.length) return toast("바뀐 내용이 없습니다.");
    try { await commitOps(ops); toast(`${ops.length}일치를 저장했습니다.`); await loadMonth(); renderCalls(); }
    catch (er) { console.error(er); toast("저장 실패: " + (er.code || er.message)); }
  };
}

/* ---------- 영업 데이터 통계 (슈퍼 관리자 전용) ---------- */
const stx = { contracts: [], dailies: [], supply: new Map(), exec: [], uid: "" };
async function loadStatsData() {
  const [a, c, s, e] = await Promise.all([
    getDocs(query(collection(db, "contracts"), where("ym", "==", ym))),
    getDocs(query(collection(db, "daily"), where("ym", "==", ym))),
    getDocs(query(collection(db, "dbSupply"), where("ym", "==", ym))),
    getDoc(doc(db, "execStats", ym))
  ]);
  stx.contracts = a.docs.map(d => ({ id: d.id, ...d.data() }));
  stx.dailies = c.docs.map(d => ({ id: d.id, ...d.data() }));
  stx.supply = new Map(s.docs.map(d => [d.data().ownerUid, d.data().counts || {}]));
  stx.exec = e.exists() ? (e.data().rows || []) : [];
}
async function renderStats() {
  if (!isSuper()) { $("#view").innerHTML = `<div class="card">슈퍼 관리자만 볼 수 있습니다.</div>`; return; }
  $("#view").innerHTML = `<div class="card muted">불러오는 중…</div>`;
  try { await loadStatsData(); }
  catch (er) { console.error(er); $("#view").innerHTML = `<div class="card err">통계를 불러오지 못했습니다: ${esc(er.code || er.message)}<br>(보안 규칙을 최신으로 게시했는지 확인하세요)</div>`; return; }
  if (tab === "stats") drawStats();
}
function drawStats() {
  const isNew = c => !isRefund(c) && !isUpsell(c);               // 건수·신규 매출은 '신규' 계약만
  const ids = new Set(users.filter(u => u.role === "sales").map(u => u.uid));
  [...stx.contracts, ...stx.dailies].forEach(x => ids.add(x.ownerUid));
  stx.supply.forEach((_, k) => ids.add(k));
  const owners = [...ids].map(uid => ({ uid, name: nameOf(uid) })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const sumOf = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const aggregate = list => {
    const cs = stx.contracts.filter(c => list.has(c.ownerUid)), ds = stx.dailies.filter(d => list.has(d.ownerUid));
    return {
      live: cs.filter(c => isNew(c) && c.status === "실시간").length, old: cs.filter(c => isNew(c) && c.status === "구디비").length,
      calls: sumOf(ds, d => d.callCount || 0), time: sumOf(ds, d => d.callTime || 0),
      nw: sumOf(cs.filter(isNew), amt), up: sumOf(cs.filter(c => !isRefund(c) && isUpsell(c)), amt), ref: sumOf(cs.filter(isRefund), amt)
    };
  };
  const supplyOf = uid => Object.values(stx.supply.get(uid) || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const z = v => v ? won(v) : "";
  const red = v => `<td class="n" style="color:var(--red)">${z(v)}</td>`;

  /* ① 사원별 */
  const tot = { sup: 0, live: 0, old: 0, calls: 0, time: 0, nw: 0, up: 0, ref: 0 };
  const rowsA = owners.map(o => {
    const a = aggregate(new Set([o.uid])), sup = supplyOf(o.uid);
    Object.keys(tot).forEach(k => tot[k] += k === "sup" ? sup : a[k]);
    return { o, a, sup };
  });
  const aCsv = [["담당자", "DB 총 공급수", "실시간 신규", "구디비 신규", "콜 수", "콜 시간(분)", "신규 매출", "업셀 금액", "환불 금액", "총합계"],
    ...rowsA.map(r => [r.o.name, r.sup, r.a.live, r.a.old, r.a.calls, r.a.time, r.a.nw, r.a.up, r.a.ref, r.a.nw + r.a.up + r.a.ref]),
    ["총계", tot.sup, tot.live, tot.old, tot.calls, tot.time, tot.nw, tot.up, tot.ref, tot.nw + tot.up + tot.ref]];

  /* ② 날짜별 (전체 또는 한 사원) */
  const sel = stx.uid && owners.some(o => o.uid === stx.uid) ? new Set([stx.uid]) : new Set(owners.map(o => o.uid));
  const [y, m] = ym.split("-").map(Number), last = new Date(y, m, 0).getDate();
  const dt = { live: 0, old: 0, calls: 0, time: 0, nw: 0, up: 0, ref: 0 };
  const bCsv = [["날짜", "실시간 수", "구디비 수", "콜량", "콜시간(분)", "신규 금액", "업셀 금액", "환불 금액", "총합계"]];
  const bodyB = Array.from({ length: last }, (_, i) => {
    const d = `${ym}-${pad(i + 1)}`;
    const cs = stx.contracts.filter(c => c.date === d && sel.has(c.ownerUid)), ds = stx.dailies.filter(x => x.date === d && sel.has(x.ownerUid));
    const v = {
      live: cs.filter(c => isNew(c) && c.status === "실시간").length, old: cs.filter(c => isNew(c) && c.status === "구디비").length,
      calls: sumOf(ds, x => x.callCount || 0), time: sumOf(ds, x => x.callTime || 0),
      nw: sumOf(cs.filter(isNew), amt), up: sumOf(cs.filter(c => !isRefund(c) && isUpsell(c)), amt), ref: sumOf(cs.filter(isRefund), amt)
    };
    Object.keys(dt).forEach(k => dt[k] += v[k]);
    bCsv.push([d, v.live, v.old, v.calls, v.time, v.nw, v.up, v.ref, v.nw + v.up + v.ref]);
    return `<tr><td>${d.slice(5).replace("-", "/")}</td><td class="n">${v.live || ""}</td><td class="n">${v.old || ""}</td><td class="n">${z(v.calls)}</td><td class="n">${z(v.time)}</td><td class="n">${z(v.nw)}</td><td class="n">${z(v.up)}</td>${red(v.ref)}<td class="n">${z(v.nw + v.up + v.ref)}</td></tr>`;
  }).join("");

  /* ③ DB 출처별 분배 수 / 실제 결제 수 */
  const groups = [["실시간", "rt", settings.realtime], ["구 DB", "old", settings.old]];
  const paid = (uid, status, src) => stx.contracts.filter(c => c.ownerUid === uid && isNew(c) && c.status === status && c.dbSource === src).length;
  const cols = groups.flatMap(([, pre, list]) => list.map(s => ({ key: `${pre}:${s}`, src: s, status: pre === "rt" ? "실시간" : "구디비" })));
  const ctot = {}; cols.forEach(c => ctot[c.key] = { sup: 0, paid: 0 });
  const rowsC = owners.map(o => `<tr><td>${esc(o.name)}</td>${cols.map(c => {
    const sup = Number((stx.supply.get(o.uid) || {})[c.key]) || 0, pd = paid(o.uid, c.status, c.src);
    ctot[c.key].sup += sup; ctot[c.key].paid += pd;
    return `<td class="n"><input type="number" min="0" class="sp" data-u="${esc(o.uid)}" data-k="${esc(c.key)}" value="${sup || ""}" style="width:74px;text-align:right;padding:4px 6px"></td><td class="n">${pd || ""}</td>`;
  }).join("")}</tr>`).join("");

  /* ④ 본부 임원 */
  const exRows = stx.exec.length ? stx.exec : [];
  const exHtml = exRows.map((r, i) => `<tr data-i="${i}"><td><input class="ex-n" value="${esc(r.name)}" style="min-width:110px"></td>
    <td class="n"><input class="ex-new" inputmode="numeric" value="${r.newSales ? won(r.newSales) : ""}" style="text-align:right;min-width:120px"></td>
    <td class="n"><input class="ex-up" inputmode="numeric" value="${r.upsell ? won(r.upsell) : ""}" style="text-align:right;min-width:120px"></td>
    <td class="n ex-tot">${won((r.newSales || 0) + (r.upsell || 0))}</td>
    <td class="n"><input class="ex-sup" inputmode="numeric" value="${r.support ? won(r.support) : ""}" style="text-align:right;min-width:120px"></td>
    <td><button class="btn ghost sm" data-exdel="${i}">삭제</button></td></tr>`).join("");

  $("#view").innerHTML = `<div class="card">
    <div class="bar"><div><label>조회 월 (입금 날짜 기준)</label><input type="month" id="sYm" value="${ym}"></div>
      <div><label>날짜별 표에 보일 사원</label><select id="sUid"><option value="">전체 사원</option>${owners.map(o => `<option value="${esc(o.uid)}" ${o.uid === stx.uid ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></div>
      <button class="btn ghost" id="csvA">사원별 CSV</button><button class="btn ghost" id="csvB">날짜별 CSV</button></div>
    <p class="muted" style="margin-top:0">모든 날짜는 <b>입금 날짜</b> 기준입니다. 신규 건수·신규 매출은 '신규' 계약만, 업셀은 계약 분류 '업셀', 환불은 계약 금액이 음수인 건입니다. 총합계 = 신규 + 업셀 + 환불(음수).</p>

    <h3 style="margin:14px 0 8px">${m}월 영업 사원 데이터 통계</h3>
    <div class="tblwrap"><table><thead><tr><th>담당자</th><th class="n">DB 총 공급수</th><th class="n">실시간 신규</th><th class="n">구디비 신규</th><th class="n">콜 수</th><th class="n">콜 시간(분)</th><th class="n">신규 매출</th><th class="n">업셀 금액</th><th class="n">환불 금액</th><th class="n">총합계</th></tr></thead>
      <tbody>${rowsA.map(r => `<tr><td>${esc(r.o.name)}</td><td class="n">${z(r.sup)}</td><td class="n">${r.a.live || ""}</td><td class="n">${r.a.old || ""}</td><td class="n">${z(r.a.calls)}</td><td class="n">${z(r.a.time)}</td><td class="n">${z(r.a.nw)}</td><td class="n">${z(r.a.up)}</td>${red(r.a.ref)}<td class="n">${z(r.a.nw + r.a.up + r.a.ref)}</td></tr>`).join("") || '<tr><td colspan="10" class="muted">데이터가 없습니다.</td></tr>'}</tbody>
      <tfoot><tr><td>총계</td><td class="n">${won(tot.sup)}</td><td class="n">${tot.live}</td><td class="n">${tot.old}</td><td class="n">${won(tot.calls)}</td><td class="n">${won(tot.time)}</td><td class="n">${won(tot.nw)}</td><td class="n">${won(tot.up)}</td><td class="n" style="color:var(--red)">${won(tot.ref)}</td><td class="n">${won(tot.nw + tot.up + tot.ref)}</td></tr></tfoot></table></div>

    <h3 style="margin:26px 0 8px">${m}월 날짜별 데이터 취합 <span class="muted" style="font-weight:400">· ${sel.size === 1 ? esc(nameOf([...sel][0])) : "전체 사원"}</span></h3>
    <div class="tblwrap"><table><thead><tr><th>날짜</th><th class="n">실시간 수</th><th class="n">구디비 수</th><th class="n">콜량</th><th class="n">콜시간(분)</th><th class="n">신규 금액</th><th class="n">업셀 금액</th><th class="n">환불 금액</th><th class="n">총합계</th></tr></thead>
      <tbody>${bodyB}</tbody>
      <tfoot><tr><td>합계</td><td class="n">${dt.live}</td><td class="n">${dt.old}</td><td class="n">${won(dt.calls)}</td><td class="n">${won(dt.time)}</td><td class="n">${won(dt.nw)}</td><td class="n">${won(dt.up)}</td><td class="n" style="color:var(--red)">${won(dt.ref)}</td><td class="n">${won(dt.nw + dt.up + dt.ref)}</td></tr></tfoot></table></div>

    <h3 style="margin:26px 0 8px">DB 데이터 총 통계 (DB 분배 수 / 실제 결제 수)</h3>
    <p class="muted" style="margin-top:0">'DB 분배 수'는 직접 입력하는 값입니다(사원별·DB 출처별·월별). '실제 결제 수'는 입력된 신규 계약에서 자동 집계됩니다. DB 출처 목록은 'DB 출처 설정'을 따릅니다.</p>
    <div class="tblwrap"><table><thead>
      <tr><th rowspan="3">영업사원명</th>${groups.map(([t, , l]) => `<th class="c" colspan="${l.length * 2}" style="background:#eef2ff">${t}</th>`).join("")}</tr>
      <tr>${cols.map(c => `<th class="c" colspan="2">${esc(c.src)}</th>`).join("")}</tr>
      <tr>${cols.map(() => '<th class="n">DB 분배 수</th><th class="n">실제 결제 수</th>').join("")}</tr></thead>
      <tbody>${rowsC || ""}</tbody>
      <tfoot><tr><td>합계</td>${cols.map(c => `<td class="n">${z(ctot[c.key].sup)}</td><td class="n">${z(ctot[c.key].paid)}</td>`).join("")}</tr></tfoot></table></div>
    <div class="actions"><button class="btn" id="supSave">DB 분배 수 저장</button></div>

    <h3 style="margin:26px 0 8px">${m}월 본부 임원 데이터 통계</h3>
    <div class="tblwrap"><table><thead><tr><th>담당자</th><th class="n">신규 매출</th><th class="n">업셀 금액</th><th class="n">총 금액</th><th class="n">매출지원 금액</th><th></th></tr></thead>
      <tbody id="exBody">${exHtml || '<tr><td colspan="6" class="muted">등록된 임원이 없습니다.</td></tr>'}</tbody>
      <tfoot><tr><td>총계</td><td class="n" id="exT1"></td><td class="n" id="exT2"></td><td class="n" id="exT3"></td><td class="n" id="exT4"></td><td></td></tr></tfoot></table></div>
    <div class="actions"><button class="btn ghost" id="exAdd">+ 임원 추가</button><button class="btn" id="exSave">임원 통계 저장</button></div>
  </div>`;

  $("#sYm").onchange = async e => { if (!e.target.value) return; ym = e.target.value; await renderStats(); };
  $("#sUid").onchange = e => { stx.uid = e.target.value; drawStats(); };
  $("#csvA").onclick = () => downloadCsv(aCsv, `영업사원통계_${ym}.csv`);
  $("#csvB").onclick = () => downloadCsv(bCsv, `날짜별통계_${ym}.csv`);

  // DB 분배 수 저장
  $("#supSave").onclick = async () => {
    const ops = [];
    owners.forEach(o => {
      const counts = {};
      $("#view").querySelectorAll(`input.sp[data-u="${CSS.escape(o.uid)}"]`).forEach(i => { const v = toNum(i.value); if (v) counts[i.dataset.k] = v; });
      if (!Object.keys(counts).length && !stx.supply.has(o.uid)) return;
      ops.push(b => b.set(doc(db, "dbSupply", `${ym}_${o.uid}`), { ym, ownerUid: o.uid, counts, updatedAt: serverTimestamp() }));
    });
    if (!ops.length) return toast("저장할 내용이 없습니다.");
    try { await commitOps(ops); toast("DB 분배 수를 저장했습니다."); await renderStats(); }
    catch (er) { console.error(er); toast("저장 실패: " + (er.code || er.message)); }
  };

  // 본부 임원
  const readEx = () => [...$("#exBody").querySelectorAll("tr[data-i]")].map(tr => ({
    name: tr.querySelector(".ex-n").value.trim(), newSales: toNum(tr.querySelector(".ex-new").value),
    upsell: toNum(tr.querySelector(".ex-up").value), support: toNum(tr.querySelector(".ex-sup").value)
  }));
  const exTotals = () => {
    const r = readEx();
    $("#exBody").querySelectorAll("tr[data-i]").forEach((tr, i) => tr.querySelector(".ex-tot").textContent = won(r[i].newSales + r[i].upsell));
    $("#exT1").textContent = won(sumOf(r, x => x.newSales)); $("#exT2").textContent = won(sumOf(r, x => x.upsell));
    $("#exT3").textContent = won(sumOf(r, x => x.newSales + x.upsell)); $("#exT4").textContent = won(sumOf(r, x => x.support));
  };
  exTotals();
  $("#exBody").oninput = exTotals;
  $("#exBody").onclick = e => { const b = e.target.closest("button[data-exdel]"); if (!b) return; stx.exec = readEx(); stx.exec.splice(+b.dataset.exdel, 1); drawStats(); };
  $("#exAdd").onclick = () => { stx.exec = [...(exRows.length ? readEx() : []), { name: "", newSales: 0, upsell: 0, support: 0 }]; drawStats(); };
  $("#exSave").onclick = async () => {
    const rows = readEx().filter(r => r.name);
    try { await setDoc(doc(db, "execStats", ym), { ym, rows, updatedAt: serverTimestamp() }); stx.exec = rows; toast("임원 통계를 저장했습니다."); drawStats(); }
    catch (er) { console.error(er); toast("저장 실패: " + (er.code || er.message)); }
  };
}

async function commitOps(ops) {
  for (let i = 0; i < ops.length; i += 200) { const b = writeBatch(db); ops.slice(i, i + 200).forEach(f => f(b)); await b.commit(); }
}
// 회원(cSnaps)·콜량(dSnaps) 문서를 to 담당자에게 옮기고 '이관 중' 표시를 지운다.
async function moveDocs(cSnaps, dSnaps, to) {
  const ops = [];
  cSnaps.forEach(x => ops.push(b => b.update(x.ref, { ownerUid: to, updatedAt: serverTimestamp(), transferName: deleteField(), transferLoginId: deleteField() })));
  dSnaps.forEach(x => {
    const { transferName, transferLoginId, ...v } = x.data();
    const nid = `${to}_${v.date}`;
    if (nid === x.id) return;
    ops.push(b => b.set(doc(db, "daily", nid), { ...v, ownerUid: to }, { merge: true }));
    ops.push(b => b.delete(x.ref));
  });
  await commitOps(ops);
}
// from 담당자(ownerUid)의 회원·콜량 전체를 to 담당자에게 옮긴다.
async function reassign(from, to) {
  const [c, d] = await Promise.all([
    getDocs(query(collection(db, "contracts"), where("ownerUid", "==", from))),
    getDocs(query(collection(db, "daily"), where("ownerUid", "==", from)))
  ]);
  await moveDocs(c.docs, d.docs, to);
  return c.size;
}
// 계정 이름과 같은 '미가입 담당자'가 있으면 그 데이터를 계정으로 연결한다. (이름만 같은 경우는 호출 전에 확인을 받는다)
async function linkPendingFor(uid, name) {
  const p = pendings.find(x => nk(x.name) === nk(name));
  if (!p) return 0;
  const n = await reassign(PEND + p.name, uid);
  await deleteDoc(doc(db, "pending", p.id));
  return n;
}
// 이름+아이디로 이관 대상 계정을 찾는다.
function findTarget(name, loginId) {
  const u = users.find(x => x.loginId === String(loginId).trim().toLowerCase());
  if (!u) return { state: "none" };
  return { state: nk(u.name) === nk(name) ? "exact" : "mismatch", user: u };
}
// 계정이 이미 있으면 바로 이관, 없으면 '이관 중' 표시만 해 두었다가 계정 생성 때 자동 이관한다.
async function runTransfer({ contractIds, fromOwner, name, loginId }) {
  loginId = loginId.trim().toLowerCase();
  const t = findTarget(name, loginId);
  if (t.state === "mismatch") throw new Error(`아이디 ${loginId}의 사원 이름은 '${t.user.name}'입니다. 이름과 아이디가 일치하지 않습니다.`);
  if (t.state === "exact") {
    if (fromOwner === t.user.uid) throw new Error("현재 담당자와 같은 사원입니다.");
    let n;
    if (fromOwner) {
      n = await reassign(fromOwner, t.user.uid);
      if (fromOwner.startsWith(PEND)) { const p = pendings.find(x => PEND + x.name === fromOwner); if (p) await deleteDoc(doc(db, "pending", p.id)); }
    } else {
      await moveDocs(contractIds.map(id => ({ ref: doc(db, "contracts", id) })), [], t.user.uid); n = contractIds.length;
    }
    return `${n}건을 ${t.user.name}(${t.user.loginId})에게 이관했습니다.`;
  }
  let refs = [];
  if (fromOwner) {
    const [c, d] = await Promise.all([
      getDocs(query(collection(db, "contracts"), where("ownerUid", "==", fromOwner))),
      getDocs(query(collection(db, "daily"), where("ownerUid", "==", fromOwner)))
    ]);
    refs = [...c.docs, ...d.docs].map(x => x.ref);
  } else refs = contractIds.map(id => doc(db, "contracts", id));
  await commitOps(refs.map(r => b => b.update(r, { transferName: name, transferLoginId: loginId })));
  return `'담당자 이관 중'으로 표시했습니다. ${name}(${loginId}) 계정이 만들어지면 자동으로 이관됩니다.`;
}
function askTransfer(title, summary) {
  return new Promise(res => {
    $("#modalRoot").innerHTML = `<div class="modal"><form class="box" style="max-width:460px"><h2>${esc(title)}</h2>
      <p class="muted" style="margin-top:0">${summary}</p>
      <div class="grid"><div><label>옮길 사원 이름 *</label><input name="n" required autocomplete="off"></div>
      <div><label>옮길 사원 아이디 *</label><input name="i" required autocomplete="off" autocapitalize="none"></div></div>
      <div id="th" class="muted" style="margin-top:10px;min-height:44px"></div>
      <div class="actions"><button type="button" class="btn ghost" id="tc">취소</button><button class="btn">이관</button></div></form></div>`;
    const f = $("#modalRoot form");
    const vals = () => [f.n.value.trim().replace(/\s+/g, " "), f.i.value.trim().toLowerCase()];
    const upd = () => {
      const [n, i] = vals(); if (!n || !i) { $("#th").innerHTML = ""; return; }
      const t = findTarget(n, i);
      $("#th").innerHTML = t.state === "exact" ? `→ 기존 사원 <b>${esc(t.user.name)}</b> (${esc(t.user.loginId)})에게 바로 이관됩니다.`
        : t.state === "mismatch" ? `<span style="color:var(--red)">아이디 ${esc(i)}의 사원 이름은 '${esc(t.user.name)}'입니다. 이름과 아이디가 일치하지 않습니다.</span>`
        : `→ 아직 이 계정이 없습니다. <b>담당자 이관 중</b>으로 표시해 두고, <b>${esc(n)} / ${esc(i)}</b> 계정이 만들어지면 자동으로 이관됩니다.`;
    };
    f.n.oninput = upd; f.i.oninput = upd;
    $("#tc").onclick = () => { closeModal(); res(null); };
    f.onsubmit = e => {
      e.preventDefault(); const [n, i] = vals();
      if (findTarget(n, i).state === "mismatch") return upd();
      closeModal(); res({ name: n, loginId: i });
    };
  });
}
async function transferSelected() {
  if (!selected.size) return toast("이관할 회원을 먼저 체크하세요.");
  const t = await askTransfer("선택 회원 이관", `체크한 회원 <b>${selected.size}건</b>의 담당자를 옮깁니다. (일별 콜량 기록은 옮겨지지 않습니다)`);
  if (!t) return;
  try { const msg = await runTransfer({ contractIds: [...selected], ...t }); selected.clear(); await loadUsers(); await loadMonth(); render(); toast(msg); }
  catch (er) { console.error(er); toast("실패: " + (er.message || er.code)); }
}
async function transferOwner(fromUid) {
  const t = await askTransfer("담당자의 회원 전체 이관", `<b>${esc(nameOf(fromUid))}</b>의 모든 회원과 일별 콜량 기록을 옮깁니다.`);
  if (!t) return;
  try { const msg = await runTransfer({ fromOwner: fromUid, ...t }); await loadUsers(); renderUsers(); toast(msg); }
  catch (er) { console.error(er); toast("실패: " + (er.message || er.code)); }
}
async function cancelTransfer(loginId) {
  if (!confirm("이 '이관 중' 표시를 취소할까요? 회원은 지금 담당자에게 그대로 남습니다.")) return;
  try {
    const [c, d] = await Promise.all([
      getDocs(query(collection(db, "contracts"), where("transferLoginId", "==", loginId))),
      getDocs(query(collection(db, "daily"), where("transferLoginId", "==", loginId)))
    ]);
    await commitOps([...c.docs, ...d.docs].map(x => b => b.update(x.ref, { transferName: deleteField(), transferLoginId: deleteField() })));
    await loadUsers(); renderUsers(); toast("이관을 취소했습니다.");
  } catch (er) { toast("실패: " + (er.code || er.message)); }
}
// 새 계정이 만들어질 때, 이름+아이디가 일치하는 '이관 중' 회원을 넘겨받는다.
async function completeTransfers(uid, loginId, name) {
  const [c, d] = await Promise.all([
    getDocs(query(collection(db, "contracts"), where("transferLoginId", "==", loginId))),
    getDocs(query(collection(db, "daily"), where("transferLoginId", "==", loginId)))
  ]);
  const cs = c.docs.filter(x => nk(x.data().transferName) === nk(name)), ds = d.docs.filter(x => nk(x.data().transferName) === nk(name));
  await moveDocs(cs, ds, uid);
  return cs.length;
}
/* ---------- 사원 관리 ---------- */
function askName(title, cur, hint = "") {
  return new Promise(res => {
    $("#modalRoot").innerHTML = `<div class="modal"><form class="box" style="max-width:400px"><h2>${esc(title)}</h2>
      <div><label>이름</label><input name="n" value="${esc(cur)}" required></div>
      <p class="muted">${hint}</p>
      <div class="actions"><button type="button" class="btn ghost" id="nc">취소</button><button class="btn">확인</button></div></form></div>`;
    $("#nc").onclick = () => { closeModal(); res(null); };
    $("#modalRoot form").onsubmit = e => { e.preventDefault(); const v = e.target.n.value.trim().replace(/\s+/g, " "); closeModal(); res(v || null); };
  });
}
async function renameUser(uid) {
  const u = users.find(x => x.uid === uid); if (!u) return;
  if (!(isSuper() || u.role === "sales")) return toast("관리자 계정의 이름은 슈퍼 관리자만 바꿀 수 있습니다.");
  const nn = await askName("담당자 이름 변경", u.name, "이름만 바뀌고, 입력된 회원 데이터는 그대로 유지됩니다.");
  if (!nn || nn === u.name) return;
  if (users.some(x => x.uid !== uid && nk(x.name) === nk(nn))) return toast("같은 이름의 사원이 이미 있습니다.");
  try {
    await updateDoc(doc(db, "users", uid), { name: nn });
    if (uid === me.uid) { me.name = nn; $("#who").textContent = `${me.name} (${roleLabel(me.role)})`; }
    await loadUsers(); renderUsers();
    toast("이름을 변경했습니다.");
  } catch (er) { console.error(er); toast("실패: " + (er.code || er.message)); }
}
async function renamePending(id) {
  const p = pendings.find(x => x.id === id); if (!p) return;
  const nn = await askName("미가입 담당자 이름 변경", p.name, "이름(표기)만 바꿉니다. 계정이 있는(또는 만들 예정인) 사원에게 옮기려면 '회원 이관'을 사용하세요.");
  if (!nn || nn === p.name) return;
  try {
    const target = users.find(x => nk(x.name) === nk(nn));
    const other = pendings.find(x => x.id !== id && nk(x.name) === nk(nn));
    if (target) return toast("이미 계정이 있는 사원에게 옮기려면 '회원 이관'을 사용하세요.");
    const nm = other ? other.name : nn;
    if (!other) await setDoc(doc(db, "pending", pendId(nm)), { name: nm, createdAt: serverTimestamp() }, { merge: true });
    const n = await reassign(PEND + p.name, PEND + nm);
    await deleteDoc(doc(db, "pending", p.id));
    await loadUsers(); renderUsers();
    toast(`${n}건의 담당자 표기를 '${nn}'(으)로 바꿨습니다.`);
  } catch (er) { console.error(er); toast("실패: " + (er.code || er.message)); }
}
function renderUsers() {
  const manage = u => isSuper() || u.role === "sales";
  const roleOpts = isSuper()
    ? `<option value="sales">영업사원</option><option value="admin">일반 관리자</option><option value="super">슈퍼 관리자</option>`
    : `<option value="sales">영업사원</option>`;
  $("#view").innerHTML = `<div class="card">
    <h3 style="margin:0 0 10px">사원 계정 발급</h3>
    <form class="bar" id="uf">
      <div><label>아이디 (영문 소문자·숫자)</label><input name="id" pattern="[a-z0-9._-]{3,20}" required placeholder="예: kim01"></div>
      <div><label>이름 (담당자명)</label><input name="name" list="pnames" required>
        <datalist id="pnames">${pendings.map(p => `<option value="${esc(p.name)}">`).join("")}</datalist></div>
      <div><label>임시 비밀번호 (6자 이상)</label><input name="pw" minlength="6" required></div>
      <div><label>권한</label><select name="role">${roleOpts}</select></div>
      <button class="btn">계정 만들기</button>
    </form>
    <div class="muted">'담당자 이관 중'인 회원이 있으면, 이름·아이디가 똑같이 일치할 때 자동으로 이 계정에 넘어갑니다.${isSuper() ? "" : " (일반 관리자는 영업사원 계정만 만들 수 있습니다.)"}</div>
    <div class="err" id="uerr"></div>
    <h3 style="margin:18px 0 8px">사원 목록</h3>
    <div class="tblwrap"><table><thead><tr><th>이름</th><th>아이디</th><th>권한</th><th>상태</th><th></th></tr></thead>
    <tbody>${users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.loginId)}</td>
      <td>${isSuper() && u.uid !== me.uid ? `<select data-role="${u.uid}" style="width:auto;padding:4px 6px">${["sales", "admin", "super"].map(r => `<option value="${r}" ${u.role === r ? "selected" : ""}>${roleLabel(r)}</option>`).join("")}</select>` : roleLabel(u.role)}</td>
      <td><span class="tag ${u.active ? "ok" : "off"}">${u.active ? "사용중" : "중지"}</span></td>
      <td>${manage(u) ? `<button class="btn ghost sm" data-ren="${u.uid}">이름 변경</button> ` : ""}<button class="btn ghost sm" data-tr="${u.uid}">회원 이관</button>
      ${u.uid === me.uid ? `<span class="muted">본인</span>` : manage(u) ? `<button class="btn ghost sm" data-uid="${u.uid}" data-act="${u.active ? 0 : 1}">${u.active ? "사용 중지" : "다시 사용"}</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
    ${pendings.length ? `<h3 style="margin:22px 0 8px">미가입 담당자 (엑셀로 올렸지만 아직 계정이 없음)</h3>
    <div class="tblwrap"><table><thead><tr><th>이름</th><th></th></tr></thead>
    <tbody>${pendings.map(p => `<tr><td>${esc(p.name)}</td><td><button class="btn ghost sm" data-trp="${esc(p.name)}">회원 이관</button> <button class="btn ghost sm" data-pen="${esc(p.id)}">이름 변경</button></td></tr>`).join("")}</tbody></table></div>` : ""}
    ${transfers.length ? `<h3 style="margin:22px 0 8px">담당자 이관 중 (대상 계정이 아직 없음)</h3>
    <div class="tblwrap"><table><thead><tr><th>대상 이름</th><th>대상 아이디</th><th class="n">회원 수</th><th>현재 담당자</th><th></th></tr></thead>
    <tbody>${transfers.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(t.loginId)}</td><td class="n">${t.count}</td><td>${[...t.froms].map(f => esc(nameOf(f))).join(", ")}</td>
      <td><button class="btn ghost sm" data-tcx="${esc(t.loginId)}">이관 취소</button></td></tr>`).join("")}</tbody></table></div>
    <p class="muted">위 이름·아이디와 똑같이 계정을 만들면 회원이 자동으로 넘어갑니다.</p>` : ""}
    <p class="muted">사용 중지된 계정은 로그인할 수 없으며, 입력했던 데이터는 그대로 보관됩니다. 비밀번호를 잊은 사원은 새 아이디를 발급하고 기존 계정을 중지하세요.</p></div>`;

  $("#uf").onsubmit = async ev => {
    ev.preventDefault(); $("#uerr").textContent = "";
    const f = ev.target, id = f.id.value.trim().toLowerCase(), name = f.name.value.trim().replace(/\s+/g, " ");
    const role = isSuper() ? f.role.value : "sales";
    if (users.some(u => u.loginId === id)) { $("#uerr").textContent = "이미 사용 중인 아이디입니다."; return; }
    if (users.some(u => nk(u.name) === nk(name))) { $("#uerr").textContent = "같은 이름의 사원이 이미 있습니다."; return; }
    const bad = transfers.find(t => t.loginId === id && nk(t.name) !== nk(name));
    if (bad) { $("#uerr").textContent = `이 아이디로 이관 대기 중인 이름은 '${bad.name}'입니다. 이름을 맞춰 주세요.`; return; }
    // 관리자 로그인 상태를 유지하기 위해 별도의 앱 인스턴스로 계정을 만든다.
    const sec = initializeApp(firebaseConfig, "secondary-" + Date.now());
    const secAuth = getAuth(sec);
    try {
      const cred = await createUserWithEmailAndPassword(secAuth, emailOf(id), f.pw.value);
      await signOut(secAuth);
      await setDoc(doc(db, "users", cred.user.uid), { loginId: id, name, role, active: true, createdAt: serverTimestamp() });
      let n = await completeTransfers(cred.user.uid, id, name);
      if (pendings.some(p => nk(p.name) === nk(name)) && confirm(`엑셀로 올려 둔 미가입 담당자 '${name}'의 회원도 이 계정으로 옮길까요?\n(이름만 같은 다른 사람이면 [취소])`)) n += await linkPendingFor(cred.user.uid, name);
      toast(n ? `'${id}' 계정을 만들고, 회원 ${n}건을 이관했습니다.` : `'${id}' 계정이 만들어졌습니다.`);
      await loadUsers(); renderUsers();
    } catch (er) { console.error(er); $("#uerr").textContent = authMsg(er); }
  };
  $("#view").onclick = async e => {
    if (tab !== "users") return;
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.ren) return renameUser(b.dataset.ren);
    if (b.dataset.pen) return renamePending(b.dataset.pen);
    if (b.dataset.tr) return transferOwner(b.dataset.tr);
    if (b.dataset.trp) return transferOwner(PEND + b.dataset.trp);
    if (b.dataset.tcx) return cancelTransfer(b.dataset.tcx);
    if (b.dataset.uid) {
      const active = b.dataset.act === "1";
      if (!active && !confirm("이 사원의 로그인을 중지할까요?")) return;
      try { await updateDoc(doc(db, "users", b.dataset.uid), { active }); await loadUsers(); renderUsers(); toast("변경되었습니다."); }
      catch (er) { toast("실패: " + (er.code || er.message)); }
    }
  };
  $("#view").onchange = async e => {
    if (tab !== "users") return;
    const s = e.target.closest("select[data-role]"); if (!s) return;
    if (!confirm(`권한을 '${roleLabel(s.value)}'(으)로 바꿀까요?`)) { renderUsers(); return; }
    try { await updateDoc(doc(db, "users", s.dataset.role), { role: s.value }); await loadUsers(); renderUsers(); toast("권한을 변경했습니다."); }
    catch (er) { toast("실패: " + (er.code || er.message)); renderUsers(); }
  };
}

/* ---------- DB 출처 설정 (슈퍼 관리자) ---------- */
let draft = null;
function renderSettings() {
  if (!isSuper()) { $("#view").innerHTML = `<div class="card">슈퍼 관리자만 사용할 수 있습니다.</div>`; return; }
  if (!draft) draft = { realtime: [...settings.realtime], old: [...settings.old] };
  const panel = (key, title, desc) => `<div class="card" style="flex:1;min-width:280px;margin:0;border:1px solid var(--line);box-shadow:none">
    <h3 style="margin:0 0 4px">${title}</h3><p class="muted" style="margin:0 0 10px">${desc}</p>
    <div class="chips">${draft[key].map((n, i) => `<span class="chip">${esc(n)}<button data-rm="${key}:${i}" title="삭제">×</button></span>`).join("") || '<span class="muted">비어 있음</span>'}</div>
    <div class="bar" style="margin:10px 0 0"><div class="grow"><input data-add="${key}" placeholder="DB 출처 이름 입력 후 Enter"></div><button class="btn ghost" data-addbtn="${key}">추가</button></div></div>`;
  const names = [...new Set([...draft.realtime, ...draft.old])];
  $("#view").innerHTML = `<div class="card">
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      ${panel("realtime", "실시간 DB 출처", "상태가 '실시간'인 회원에게 선택할 수 있는 DB 출처")}
      ${panel("old", "구디비 DB 출처", "상태가 '구디비'인 회원에게 선택할 수 있는 DB 출처")}
    </div>
    <h3 style="margin:20px 0 8px">입력창 콤보박스에 표시될 목록</h3>
    <div class="tblwrap"><table style="max-width:420px"><thead><tr><th>DB 출처</th><th>실시간</th><th>구디비</th></tr></thead>
      <tbody>${names.map(n => `<tr><td>${esc(n)}</td><td>${draft.realtime.includes(n) ? '<span class="tag ok">실시간</span>' : ""}</td><td>${draft.old.includes(n) ? '<span class="tag">구디비</span>' : ""}</td></tr>`).join("")}</tbody></table></div>
    <div class="err" id="serr"></div>
    <div class="actions"><button class="btn ghost" id="sreset">되돌리기</button><button class="btn" id="ssave">저장</button></div>
    <p class="muted">같은 이름을 양쪽에 모두 넣을 수 있습니다(예: 급등). 이미 입력된 회원 데이터는 바뀌지 않으며, 앞으로 저장하는 회원부터 이 기준으로 검사합니다.</p></div>`;
  const add = key => {
    const inp = $(`input[data-add="${key}"]`), n = inp.value.trim().replace(/\s+/g, " ");
    if (!n) return;
    if (n.includes(",")) { $("#serr").textContent = "이름에 쉼표(,)는 쓸 수 없습니다."; return; }
    if (!draft[key].includes(n)) draft[key].push(n);
    renderSettings(); $(`input[data-add="${key}"]`).focus();
  };
  $("#view").querySelectorAll("input[data-add]").forEach(i => i.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); add(i.dataset.add); } });
  $("#view").querySelectorAll("button[data-addbtn]").forEach(b => b.onclick = () => add(b.dataset.addbtn));
  $("#view").querySelectorAll("button[data-rm]").forEach(b => b.onclick = () => { const [k, i] = b.dataset.rm.split(":"); draft[k].splice(+i, 1); renderSettings(); });
  $("#sreset").onclick = () => { draft = null; renderSettings(); };
  $("#ssave").onclick = async () => {
    if (!draft.realtime.length) { $("#serr").textContent = "실시간 DB 출처는 최소 1개 이상 필요합니다."; return; }
    try {
      await setDoc(doc(db, "settings", "db"), { realtime: draft.realtime, old: draft.old, updatedAt: serverTimestamp(), updatedBy: me.uid });
      settings = { realtime: [...draft.realtime], old: [...draft.old] };
      toast("DB 출처 설정을 저장했습니다.");
    } catch (er) { console.error(er); $("#serr").textContent = "저장 실패: " + (er.code || er.message); }
  };
}

/* ---------- 비밀번호 변경 ---------- */
$("#btnPw").onclick = () => {
  $("#modalRoot").innerHTML = `<div class="modal"><form class="box" id="pf" style="max-width:380px"><h2>비밀번호 변경</h2>
    <div style="margin-bottom:10px"><label>현재 비밀번호</label><input type="password" name="cur" required></div>
    <div><label>새 비밀번호 (6자 이상)</label><input type="password" name="nw" minlength="6" required></div>
    <div class="err" id="perr"></div>
    <div class="actions"><button type="button" class="btn ghost" id="pcancel">취소</button><button class="btn">변경</button></div></form></div>`;
  $("#pcancel").onclick = closeModal;
  $("#pf").onsubmit = async ev => {
    ev.preventDefault(); const f = ev.target;
    try {
      const u = auth.currentUser;
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, f.cur.value));
      await updatePassword(u, f.nw.value);
      closeModal(); toast("비밀번호가 변경되었습니다.");
    } catch (er) { $("#perr").textContent = authMsg(er); }
  };
};

/* ======================================================================
   엑셀 가져오기 (xlsx 업로드 → 미리보기 → 저장)
   ====================================================================== */
const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
function loadXlsxLib() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = XLSX_URL; s.onload = res;
    s.onerror = () => rej(new Error("엑셀 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요."));
    document.head.appendChild(s);
  });
}
const normH = s => String(s ?? "").replace(/\s/g, "").toLowerCase();
const HEADER_ALIASES = {
  date: ["입금날짜", "신규날짜", "날짜"], callCount: ["콜량"], callTime: ["콜시간"], name: ["회원명", "이름"],
  phone: ["전화번호", "연락처", "휴대폰"], dbSource: ["db출처", "db"], status: ["상태"], contractType: ["계약분류"],
  grade: ["등급분류", "등급"], amount: ["계약금액", "신규금액"], period: ["계약기간"], voucher: ["무료바우처"],
  upsellNote: ["업셀여부"], note: ["비고"],
  upsellDate: ["업셀날짜"], upsellAmount: ["업셀금액"]       // 예전 양식(업셀을 같은 행에 적던 시트) 호환
};
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function cellDate(v, refYear) {
  if (v instanceof Date && !isNaN(v)) return ymd(new Date(v.getTime() + 12 * 3600 * 1000));
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  const s = String(v ?? "").trim(); if (!s) return "";
  let m = s.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/); if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/(\d{1,2})\s*[./월-]\s*(\d{1,2})\s*일?$/); if (m) return `${refYear}-${pad(+m[1])}-${pad(+m[2])}`;
  return "";
}
function parseSheet(wb, sheetName, refYear) {
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false });
  const txt = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "", blankrows: false });
  const hi = raw.slice(0, 15).findIndex(r => r.some(c => normH(c) === "회원명"));
  if (hi < 0) return { error: "'회원명' 열이 있는 머리글 행을 찾지 못했습니다. 회원 목록 시트를 선택해 주세요." };
  const col = {};
  raw[hi].forEach((h, i) => { for (const [k, al] of Object.entries(HEADER_ALIASES)) if (col[k] === undefined && al.includes(normH(h))) col[k] = i; });
  const rows = [];
  for (let r = hi + 1; r < raw.length; r++) {
    const g = k => col[k] === undefined ? "" : raw[r][col[k]];
    const t = k => col[k] === undefined ? "" : String(txt[r]?.[col[k]] ?? "").trim();
    const name = String(g("name") ?? "").trim();
    if (!name && !t("phone")) continue;
    let phone = t("phone"); const dg = digits(phone);
    phone = (dg.length === 10 && dg.startsWith("10")) ? fmtPhone("0" + dg) : fmtPhone(phone);
    const grades = String(g("grade")).split(/[,，/]/).map(x => x.trim()).filter(Boolean);
    const pp = parsePeriodText(t("period"));
    const base = {
      line: r + 1, name, phone, date: cellDate(g("date"), refYear),
      dbSource: t("dbSource"), status: t("status"), contractType: t("contractType") || "신규",
      grades, grade: grades.join(", "), amount: toNum(g("amount")), period: pp ? pp.period : t("period"), startDate: pp?.startDate || "", endDate: pp?.endDate || "", endFinal: pp?.endFinal || "", voucher: t("voucher"),
      upsellNote: String(g("upsellNote") ?? "").trim(), note: String(g("note") ?? "").trim(),
      callCount: g("callCount") === "" ? null : toNum(g("callCount")), callTime: g("callTime") === "" ? null : toNum(g("callTime"))
    };
    rows.push(base);
    // 예전 양식: 같은 행에 업셀 날짜·금액이 있으면 '업셀' 행을 하나 더 만든다.
    const upAmt = toNum(g("upsellAmount"));
    if (col.upsellAmount !== undefined && upAmt) {
      rows.push({ ...base, contractType: "업셀", date: cellDate(g("upsellDate"), refYear), amount: upAmt, period: "", voucher: "", upsellNote: "", note: "", callCount: null, callTime: null });
    }
  }
  return { rows };
}

function openImport() {
  const ownerSel = isAdmin()
    ? `<div><label>담당자 * (파일명으로 자동 입력)</label><input id="xowner" list="xownerlist" placeholder="예: 최세영" autocomplete="off">
        <datalist id="xownerlist">${[...users.map(u => u.name), ...pendings.map(p => p.name)].map(n => `<option value="${esc(n)}">`).join("")}</datalist></div>` : "";
  $("#modalRoot").innerHTML = `<div class="modal"><div class="box" style="max-width:1000px">
    <h2>엑셀에서 회원 가져오기</h2>
    <div class="bar">
      <div class="grow"><label>엑셀 파일 (.xlsx)</label><input type="file" id="xf" accept=".xlsx,.xls,.csv"></div>
      <div id="xsheetWrap" class="hidden"><label>시트</label><select id="xsheet"></select></div>
      ${ownerSel}
      <div><label>날짜가 비어 있는 행에 넣을 날짜</label><input type="date" id="xdef" value="${todayStr()}"></div>
    </div>
    <p class="muted" style="margin:0 0 8px">머리글(입금 날짜, 회원명, 전화번호, 계약 금액 등)은 전용시트 양식과 같아야 합니다. 같은 전화번호·날짜·분류·금액의 회원이 이미 있으면 '중복'으로 제외되고, 실시간/구디비와 DB 출처가 맞지 않는 행은 '오류'로 표시됩니다.</p>
    <div id="xhint" class="muted" style="margin-bottom:8px"></div>
    <div id="xprev"></div>
    <div class="err" id="xerr"></div>
    <div class="actions"><button type="button" class="btn ghost" id="xcancel">닫기</button><button type="button" class="btn" id="xgo" disabled>선택한 행 저장</button></div>
  </div></div>`;
  let wb = null, parsed = [], existing = new Map(), seq = 0;
  const ownerName = () => isAdmin() ? ($("#xowner").value || "").trim().replace(/\s+/g, " ") : me.name;
  const ownerUid = () => {
    if (!isAdmin()) return me.uid;
    const n = ownerName(); if (!n) return "";
    const u = users.find(x => nk(x.name) === nk(n));
    return u ? u.uid : PEND + n;
  };
  const updateHint = () => {
    if (!isAdmin()) return;
    const n = ownerName(), u = n && users.find(x => nk(x.name) === nk(n));
    $("#xhint").innerHTML = !n ? "" : u
      ? `→ 기존 사원 <b>${esc(u.name)}</b> (아이디 ${esc(u.loginId)})의 회원으로 저장됩니다.`
      : `→ 아직 계정이 없는 담당자입니다. <b>${esc(n)}</b> 이름으로 저장해 두고, 이후 '회원 이관'으로 옮기거나 같은 이름으로 계정을 만들 때 연결할 수 있습니다.`;
  };
  const guessOwner = fname => {
    const base = fname.replace(/\.[^.]+$/, "").trim();
    const hit = [...users.map(u => u.name), ...pendings.map(p => p.name)].filter(Boolean).sort((a, b) => b.length - a.length).find(n => nk(base).includes(nk(n)));
    return hit || base;
  };
  $("#xcancel").onclick = closeModal;
  const keyOf = (phone, name, date, type, amount) => `${digits(phone) || name}|${date}|${type || "신규"}|${amount || 0}`;

  async function ensureExisting(months) {
    const uid = ownerUid();
    await Promise.all([...months].filter(m => !existing.has(`${uid}|${m}`)).map(async m => {
      const s = await getDocs(query(collection(db, "contracts"), where("ownerUid", "==", uid), where("ym", "==", m)));
      existing.set(`${uid}|${m}`, new Set(s.docs.map(d => { const v = d.data(); return keyOf(v.phone, v.name, v.date, v.contractType, v.amount); })));
    }));
  }
  async function refreshPreview() {
    const my = ++seq, def = $("#xdef").value, uid = ownerUid();
    if (!parsed.length) return;
    $("#xerr").textContent = "";
    if (!uid) { $("#xerr").textContent = "담당자 이름을 입력하세요."; parsed.forEach(r => { r.st = "err"; r.msg = "담당자 없음"; r.use = false; }); drawPreview(); return; }
    parsed.forEach(r => r.finalDate = r.date || def);
    const months = new Set(parsed.map(r => (r.finalDate || "").slice(0, 7)).filter(m => /^\d{4}-\d{2}$/.test(m)));
    try { await ensureExisting(months); } catch (e) { $("#xerr").textContent = "기존 데이터 확인 실패: " + (e.code || e.message); }
    if (my !== seq) return;
    const seen = new Set();
    parsed.forEach(r => {
      r.tip = "";
      if (!r.name) { r.st = "err"; r.msg = "회원명 없음"; return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.finalDate || "")) { r.st = "err"; r.msg = "날짜 없음"; return; }
      const bad = checkSource(r.status, r.dbSource);
      if (bad) { r.st = "err"; r.msg = `${r.status}·${r.dbSource || "-"} 불일치`; r.tip = bad; return; }
      const k = keyOf(r.phone, r.name, r.finalDate, r.contractType, r.amount);
      if (existing.get(`${uid}|${r.finalDate.slice(0, 7)}`)?.has(k)) { r.st = "dup"; r.msg = "이미 등록됨"; return; }
      if (seen.has(k)) { r.st = "dup"; r.msg = "파일 내 중복"; return; }
      seen.add(k); r.st = "ok"; r.msg = r.date ? "" : "날짜 자동 입력";
    });
    parsed.forEach(r => { if (r.use === undefined || r.useAuto !== r.st) { r.use = r.st === "ok"; r.useAuto = r.st; } });
    drawPreview();
  }
  function drawPreview() {
    const n = parsed.filter(r => r.use && r.st !== "err").length;
    $("#xprev").innerHTML = `<div class="muted" style="margin-bottom:6px">총 ${parsed.length}행 · 신규 ${parsed.filter(r => r.st === "ok").length} · 중복 ${parsed.filter(r => r.st === "dup").length} · 오류 ${parsed.filter(r => r.st === "err").length}</div>
      <div class="tblwrap" style="max-height:340px;overflow:auto"><table><thead><tr><th>저장</th><th>상태</th><th>입금 날짜</th><th>회원명</th><th>전화번호</th><th>DB</th><th>상태</th><th>분류</th><th>등급</th><th class="n">계약 금액</th><th>콜량</th><th>콜 시간</th></tr></thead><tbody>
      ${parsed.map((r, i) => `<tr class="${r.amount < 0 ? "refund" : ""}"><td><input type="checkbox" data-i="${i}" style="width:auto" ${r.use ? "checked" : ""} ${r.st === "err" ? "disabled" : ""}></td>
        <td title="${esc(r.tip)}"><span class="tag ${r.st === "ok" ? "ok" : "off"}">${r.st === "ok" ? "신규" : r.st === "dup" ? "중복" : "오류"}</span> <span class="muted">${esc(r.msg)}</span></td>
        <td>${esc(r.finalDate)}</td><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${esc(r.dbSource)}</td><td>${esc(r.status)}</td><td>${esc(r.contractType)}</td><td>${esc(r.grade)}</td>
        <td class="n">${won(r.amount)}</td><td>${r.callCount ?? ""}</td><td>${r.callTime ?? ""}</td></tr>`).join("")}
      </tbody></table></div>`;
    $("#xgo").disabled = n === 0; $("#xgo").textContent = `선택한 ${n}건 저장`;
    $("#xprev").querySelectorAll("input[data-i]").forEach(cb => cb.onchange = () => { parsed[+cb.dataset.i].use = cb.checked; drawPreview(); });
  }
  function readSheet() {
    $("#xerr").textContent = ""; $("#xprev").innerHTML = ""; parsed = []; $("#xgo").disabled = true;
    const refYear = ($("#xdef").value || todayStr()).slice(0, 4);
    const r = parseSheet(wb, $("#xsheet").value, refYear);
    if (r.error) { $("#xerr").textContent = r.error; return; }
    if (!r.rows.length) { $("#xerr").textContent = "가져올 회원 행이 없습니다."; return; }
    parsed = r.rows; refreshPreview();
  }
  $("#xf").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      await loadXlsxLib();
      if (isAdmin()) { $("#xowner").value = guessOwner(f.name); updateHint(); }
      wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      $("#xsheet").innerHTML = wb.SheetNames.map(n => `<option>${esc(n)}</option>`).join("");
      const best = wb.SheetNames.find(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" }).slice(0, 15).some(r => r.some(c => normH(c) === "회원명")));
      if (best) $("#xsheet").value = best;
      $("#xsheetWrap").classList.toggle("hidden", wb.SheetNames.length < 2);
      readSheet();
    } catch (er) { console.error(er); $("#xerr").textContent = "파일을 읽지 못했습니다: " + er.message; }
  };
  $("#xsheet").onchange = readSheet;
  $("#xdef").onchange = () => { parsed.forEach(r => { r.use = undefined; }); refreshPreview(); };
  if (isAdmin()) { $("#xowner").oninput = updateHint; $("#xowner").onchange = () => { updateHint(); parsed.forEach(r => { r.use = undefined; }); refreshPreview(); }; }

  $("#xgo").onclick = async () => {
    const uid = ownerUid(), todo = parsed.filter(r => r.use && r.st !== "err");
    if (!todo.length) return;
    $("#xgo").disabled = true; $("#xerr").textContent = "";
    try {
      const ops = [];
      if (uid.startsWith(PEND)) { const nm = uid.slice(PEND.length); ops.push(b => b.set(doc(db, "pending", pendId(nm)), { name: nm, createdAt: serverTimestamp() }, { merge: true })); }
      todo.forEach(r => {
        const data = {
          ownerUid: uid, date: r.finalDate, ym: r.finalDate.slice(0, 7), name: r.name, phone: r.phone, phoneKey: digits(r.phone),
          dbSource: r.dbSource, status: r.status, contractType: r.contractType, grades: r.grades, grade: r.grade,
          amount: r.amount, period: r.period, startDate: r.startDate, endDate: r.endDate, endFinal: r.endFinal, voucher: r.voucher, upsellNote: r.upsellNote, note: r.note,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        };
        ops.push(b => b.set(doc(collection(db, "contracts")), data));
      });
      // 일별 콜량/콜 시간 (날짜별로 마지막 값 사용)
      const dmap = new Map();
      todo.forEach(r => { if (r.callCount !== null || r.callTime !== null) { const o = dmap.get(r.finalDate) || {}; if (r.callCount !== null) o.callCount = r.callCount; if (r.callTime !== null) o.callTime = r.callTime; dmap.set(r.finalDate, o); } });
      dmap.forEach((o, date) => ops.push(b => b.set(doc(db, "daily", `${uid}_${date}`), { ownerUid: uid, date, ym: date.slice(0, 7), ...o, updatedAt: serverTimestamp() }, { merge: true })));
      await commitOps(ops);
      closeModal(); toast(`${todo.length}건을 저장했습니다.`);
      const first = todo.map(r => r.finalDate).sort()[0];
      ym = first.slice(0, 7); if (isAdmin()) { filterUid = uid; await loadUsers(); }
      await loadMonth(); render();
    } catch (er) { console.error(er); $("#xerr").textContent = "저장 실패: " + (er.code || er.message); $("#xgo").disabled = false; }
  };
}
