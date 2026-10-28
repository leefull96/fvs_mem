import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, updatePassword, reauthenticateWithCredential, EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, EMAIL_DOMAIN, OPTIONS } from "./firebase-config.js";

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
const fmtPhone = v => {
  const d = String(v).replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return v;
};
const emailOf = id => `${id.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hidden"), 2600);
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

/* ---------- 상태 ---------- */
let me = null;                 // {uid, name, role, loginId}
let tab = "list";
let ym = todayStr().slice(0, 7);
let filterUid = "";            // 관리자 사원 필터
let search = "";
let contracts = [], dailies = [], users = [];
const isAdmin = () => me?.role === "admin";
const nameOf = uid => users.find(u => u.uid === uid)?.name || (uid === me?.uid ? me.name : "(알수없음)");

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
    $("#who").textContent = `${me.name} (${isAdmin() ? "관리자" : "영업사원"})`;
    $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
    tab = "list"; filterUid = ""; search = "";
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
}
async function loadMonth() {
  const own = (isAdmin() ? (filterUid ? [where("ownerUid", "==", filterUid)] : []) : [where("ownerUid", "==", me.uid)]);
  const [a, b, c] = await Promise.all([
    getDocs(query(collection(db, "contracts"), ...own, where("ym", "==", ym))),
    getDocs(query(collection(db, "contracts"), ...own, where("upYm", "==", ym))),
    getDocs(query(collection(db, "daily"), ...own, where("ym", "==", ym)))
  ]);
  const map = new Map();
  [...a.docs, ...b.docs].forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
  contracts = [...map.values()];
  dailies = c.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ---------- 탭 ---------- */
function buildTabs() {
  const items = [["list", "회원 목록·입력"], ["stats", "일별 통계"]];
  if (isAdmin()) items.push(["users", "사원 관리"]);
  $("#tabs").innerHTML = items.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("");
  $("#tabs").onclick = async e => {
    const t = e.target.dataset.t; if (!t) return;
    tab = t; buildTabs();
    if (t === "users") await loadUsers();
    render();
  };
}
function render() {
  if (tab === "list") renderList();
  else if (tab === "stats") renderStats();
  else renderUsers();
}

/* ---------- 공통 바 (월/사원 선택) ---------- */
function monthBar(extra = "") {
  const sel = isAdmin()
    ? `<div><label>사원</label><select id="fUid"><option value="">전체</option>${users.map(u => `<option value="${u.uid}" ${u.uid === filterUid ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>` : "";
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
    .filter(c => c.ym === ym)
    .filter(c => !kw || `${c.name} ${c.phone} ${c.dbSource} ${c.note}`.toLowerCase().includes(kw))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || ((b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
  const sNew = rows.reduce((s, c) => s + (c.newAmount || 0), 0);
  const sUp = contracts.filter(c => c.upYm === ym).reduce((s, c) => s + (c.upsellAmount || 0), 0);

  $("#view").innerHTML = `
    <div class="card">
      ${isAdmin() ? "" : dailyBox()}
      ${monthBar(`<div class="grow"><label>검색 (이름·전화·DB·비고)</label><input id="fSearch" value="${esc(search)}" placeholder="검색어"></div>
        <button class="btn" id="btnNew">+ 회원 추가</button>
        <button class="btn ghost" id="btnImp">엑셀 가져오기</button>
        <button class="btn ghost" id="btnCsv">엑셀(CSV) 저장</button>`)}
      <div class="sum">
        <div><span class="muted">건수</span><b>${rows.length}건</b></div>
        <div><span class="muted">신규 금액</span><b>${won(sNew)}원</b></div>
        <div><span class="muted">업셀 금액</span><b>${won(sUp)}원</b></div>
        <div><span class="muted">합계</span><b>${won(sNew + sUp)}원</b></div>
      </div>
      <div class="tblwrap"><table>
        <thead><tr><th>신규 날짜</th>${isAdmin() ? "<th>담당자</th>" : ""}<th>회원명</th><th>전화번호</th><th>DB 출처</th><th>상태</th><th>등급</th><th class="n">신규 금액</th><th>업셀 날짜</th><th class="n">업셀 금액</th><th>비고</th></tr></thead>
        <tbody>${rows.map(c => `<tr class="click" data-id="${c.id}">
          <td>${esc(c.date)}</td>${isAdmin() ? `<td>${esc(nameOf(c.ownerUid))}</td>` : ""}<td>${esc(c.name)}</td><td>${esc(c.phone)}</td>
          <td>${esc(c.dbSource)}</td><td>${esc(c.status)}</td><td>${esc(c.grade)}</td>
          <td class="n">${won(c.newAmount)}</td><td>${esc(c.upsellDate)}</td><td class="n">${c.upsellAmount ? won(c.upsellAmount) : ""}</td>
          <td>${esc((c.note || "").slice(0, 20))}</td></tr>`).join("") || `<tr><td colspan="11" class="muted" style="padding:24px;text-align:center">데이터가 없습니다.</td></tr>`}</tbody>
      </table></div>
      <p class="muted">행을 누르면 수정·삭제할 수 있습니다. 업셀이 다른 달에 발생한 건은 업셀 금액만 해당 월 합계에 포함됩니다.</p>
    </div>`;
  bindMonthBar();
  $("#fSearch").oninput = e => { search = e.target.value; const pos = e.target.selectionStart; renderList(); const i = $("#fSearch"); i.focus(); i.setSelectionRange(pos, pos); };
  $("#btnNew").onclick = () => openForm(null);
  $("#btnCsv").onclick = () => exportCsv(rows);
  $("#btnImp").onclick = openImport;
  $("#view").querySelector("tbody").onclick = e => {
    const tr = e.target.closest("tr[data-id]"); if (!tr) return;
    openForm(contracts.find(c => c.id === tr.dataset.id));
  };
  if (!isAdmin()) bindDaily();
}

/* ---------- 일별 콜량 입력 박스 ---------- */
function dailyBox() {
  return `<div class="bar" style="padding-bottom:12px;border-bottom:1px dashed var(--line)">
    <div><label>콜량 입력 날짜</label><input type="date" id="dDate" value="${todayStr()}"></div>
    <div><label>콜량 (건)</label><input type="number" id="dCount" min="0" inputmode="numeric"></div>
    <div><label>콜 시간</label><input id="dTime" placeholder="예: 2시간 30분"></div>
    <button class="btn" id="dSave">콜량 저장</button></div>`;
}
async function loadDailyInto() {
  const date = $("#dDate").value; if (!date) return;
  const s = await getDoc(doc(db, "daily", `${me.uid}_${date}`));
  $("#dCount").value = s.exists() ? s.data().callCount ?? "" : "";
  $("#dTime").value = s.exists() ? s.data().callTime ?? "" : "";
}
function bindDaily() {
  $("#dDate").onchange = loadDailyInto; loadDailyInto();
  $("#dSave").onclick = async () => {
    const date = $("#dDate").value; if (!date) return toast("날짜를 선택하세요.");
    try {
      await setDoc(doc(db, "daily", `${me.uid}_${date}`), {
        ownerUid: me.uid, date, ym: date.slice(0, 7),
        callCount: toNum($("#dCount").value), callTime: $("#dTime").value.trim(), updatedAt: serverTimestamp()
      });
      toast("콜량이 저장되었습니다.");
      if (date.slice(0, 7) === ym) { await loadMonth(); }
    } catch (e) { console.error(e); toast("저장 실패: " + (e.code || e.message)); }
  };
}

/* ---------- 회원 입력/수정 모달 ---------- */
function openForm(c) {
  const e = c || { date: todayStr(), status: OPTIONS.status[0], contractType: OPTIONS.contractType[0], grades: [] };
  const opt = (arr, v) => `<option value=""></option>` + (v && !arr.includes(v) ? [...arr, v] : arr).map(x => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("");
  $("#modalRoot").innerHTML = `<div class="modal"><form class="box" id="cf">
    <h2>${c ? "회원 정보 수정" : "회원 추가"}</h2>
    <div class="grid">
      <div><label>신규 날짜 *</label><input type="date" name="date" value="${esc(e.date)}" required></div>
      <div><label>회원명 *</label><input name="name" value="${esc(e.name)}" required></div>
      <div><label>전화번호 *</label><input name="phone" inputmode="tel" value="${esc(e.phone)}" required></div>
      <div><label>DB 출처</label><select name="dbSource">${opt(OPTIONS.dbSource, e.dbSource)}</select></div>
      <div><label>상태</label><select name="status">${opt(OPTIONS.status, e.status)}</select></div>
      <div><label>계약 분류</label><select name="contractType">${opt(OPTIONS.contractType, e.contractType)}</select></div>
      <div class="full"><label>등급 분류 (복수 선택)</label><div class="chk">${[...new Set([...OPTIONS.grades, ...(e.grades || [])])].map(g => `<label><input type="checkbox" name="grades" value="${esc(g)}" ${(e.grades || []).includes(g) ? "checked" : ""}>${esc(g)}</label>`).join("")}</div></div>
      <div><label>신규 금액 (원)</label><input name="newAmount" inputmode="numeric" value="${e.newAmount ? won(e.newAmount) : ""}"></div>
      <div><label>계약 기간</label><input name="period" value="${esc(e.period)}" placeholder="예: 6개월"></div>
      <div class="full"><label>업셀 여부 / 내용</label><textarea name="upsellNote">${esc(e.upsellNote)}</textarea></div>
      <div><label>업셀 날짜</label><input type="date" name="upsellDate" value="${esc(e.upsellDate)}"></div>
      <div><label>업셀 금액 (원)</label><input name="upsellAmount" inputmode="numeric" value="${e.upsellAmount ? won(e.upsellAmount) : ""}"></div>
      <div class="full"><label>무료 바우처</label><input name="voucher" value="${esc(e.voucher)}"></div>
      <div class="full"><label>비고</label><textarea name="note">${esc(e.note)}</textarea></div>
    </div>
    <div class="err" id="cerr"></div>
    <div class="actions">${c ? `<button type="button" class="btn danger left" id="cdel">삭제</button>` : ""}
      <button type="button" class="btn ghost" id="ccancel">취소</button><button class="btn">저장</button></div>
  </form></div>`;
  const f = $("#cf");
  f.phone.onblur = () => f.phone.value = fmtPhone(f.phone.value);
  ["newAmount", "upsellAmount"].forEach(n => f[n].onblur = () => f[n].value = f[n].value ? won(toNum(f[n].value)) : "");
  $("#ccancel").onclick = closeModal;
  if (c) $("#cdel").onclick = async () => {
    if (!confirm(`'${c.name}' 회원을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try { await deleteDoc(doc(db, "contracts", c.id)); closeModal(); toast("삭제되었습니다."); await loadMonth(); render(); }
    catch (er) { $("#cerr").textContent = "삭제 실패: " + (er.code || er.message); }
  };
  f.onsubmit = async ev => {
    ev.preventDefault();
    const v = new FormData(f);
    const grades = v.getAll("grades");
    const date = v.get("date"), upDate = v.get("upsellDate") || "";
    const data = {
      ownerUid: c ? c.ownerUid : me.uid,
      date, ym: date.slice(0, 7),
      name: v.get("name").trim(), phone: fmtPhone(v.get("phone").trim()),
      dbSource: v.get("dbSource"), status: v.get("status"), contractType: v.get("contractType"),
      grades, grade: grades.join(", "),
      newAmount: toNum(v.get("newAmount")), period: v.get("period").trim(),
      upsellNote: v.get("upsellNote").trim(), upsellDate: upDate, upYm: upDate ? upDate.slice(0, 7) : "",
      upsellAmount: toNum(v.get("upsellAmount")),
      voucher: v.get("voucher").trim(), note: v.get("note").trim(),
      updatedAt: serverTimestamp()
    };
    try {
      if (c) await updateDoc(doc(db, "contracts", c.id), data);
      else { data.createdAt = serverTimestamp(); await addDoc(collection(db, "contracts"), data); }
      closeModal(); toast("저장되었습니다.");
      if (data.ym !== ym) ym = data.ym;
      await loadMonth(); render();
    } catch (er) { console.error(er); $("#cerr").textContent = "저장 실패: " + (er.code || er.message); }
  };
}
function closeModal() { $("#modalRoot").innerHTML = ""; }

/* ---------- CSV ---------- */
function exportCsv(rows) {
  const head = ["신규 날짜", "담당자", "회원명", "전화번호", "DB 출처", "상태", "계약 분류", "등급 분류", "신규 금액", "업셀 여부", "업셀 날짜", "업셀 금액", "계약 기간", "무료 바우처", "비고"];
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [head.map(q).join(",")].concat(rows.map(c => [c.date, nameOf(c.ownerUid), c.name, c.phone, c.dbSource, c.status, c.contractType, c.grade, c.newAmount || "", c.upsellNote, c.upsellDate, c.upsellAmount || "", c.period, c.voucher, c.note].map(q).join(",")));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `회원목록_${ym}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- 일별 통계 ---------- */
function renderStats() {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const days = Array.from({ length: last }, (_, i) => `${ym}-${pad(i + 1)}`);
  const tot = { live: 0, old: 0, all: 0, calls: 0, nw: 0, up: 0 };
  const body = days.map(d => {
    const on = contracts.filter(c => c.date === d);
    const live = on.filter(c => c.dbSource === "급등" && c.status === "실시간").length;
    const old = on.filter(c => c.status === "구디비").length;
    const dl = dailies.filter(x => x.date === d);
    const calls = dl.reduce((s, x) => s + (x.callCount || 0), 0);
    const times = [...new Set(dl.map(x => x.callTime).filter(Boolean))].join(", ");
    const nw = on.reduce((s, c) => s + (c.newAmount || 0), 0);
    const up = contracts.filter(c => c.upsellDate === d).reduce((s, c) => s + (c.upsellAmount || 0), 0);
    tot.live += live; tot.old += old; tot.all += on.length; tot.calls += calls; tot.nw += nw; tot.up += up;
    return `<tr><td>${d.slice(5).replace("-", "/")}</td><td class="n">${live || ""}</td><td class="n">${old || ""}</td><td class="n">${on.length || ""}</td><td class="n">${calls || ""}</td><td>${esc(times)}</td><td class="n">${nw ? won(nw) : ""}</td><td class="n">${up ? won(up) : ""}</td><td class="n">${nw + up ? won(nw + up) : ""}</td></tr>`;
  }).join("");

  let perUser = "";
  if (isAdmin() && !filterUid) {
    const rows = users.map(u => {
      const mine = contracts.filter(c => c.ownerUid === u.uid);
      const cnt = mine.filter(c => c.ym === ym).length;
      const nw = mine.filter(c => c.ym === ym).reduce((s, c) => s + (c.newAmount || 0), 0);
      const up = mine.filter(c => c.upYm === ym).reduce((s, c) => s + (c.upsellAmount || 0), 0);
      const calls = dailies.filter(x => x.ownerUid === u.uid).reduce((s, x) => s + (x.callCount || 0), 0);
      return { u, cnt, nw, up, calls };
    });
    perUser = `<h3 style="margin:22px 0 8px">사원별 합계</h3><div class="tblwrap"><table>
      <thead><tr><th>사원</th><th class="n">건수</th><th class="n">콜량</th><th class="n">신규 금액</th><th class="n">업셀 금액</th><th class="n">총합계</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.u.name)}</td><td class="n">${r.cnt}</td><td class="n">${won(r.calls)}</td><td class="n">${won(r.nw)}</td><td class="n">${won(r.up)}</td><td class="n">${won(r.nw + r.up)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  $("#view").innerHTML = `<div class="card">${monthBar(`<button class="btn ghost" id="btnSCsv">통계 CSV 저장</button>`)}
    <div class="tblwrap"><table>
      <thead><tr><th>날짜</th><th class="n">급등 실시간 수</th><th class="n">구디비 수</th><th class="n">전체 건수</th><th class="n">콜량</th><th>콜 시간</th><th class="n">신규 금액</th><th class="n">업셀 금액</th><th class="n">총합계</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td>합계</td><td class="n">${tot.live}</td><td class="n">${tot.old}</td><td class="n">${tot.all}</td><td class="n">${won(tot.calls)}</td><td></td><td class="n">${won(tot.nw)}</td><td class="n">${won(tot.up)}</td><td class="n">${won(tot.nw + tot.up)}</td></tr></tfoot>
    </table></div>${perUser}</div>`;
  bindMonthBar();
  $("#btnSCsv").onclick = () => {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const out = [["날짜", "급등 실시간 수", "구디비 수", "전체 건수", "콜량", "콜 시간", "신규 금액", "업셀 금액", "총합계"]];
    $("#view").querySelector("table").querySelectorAll("tbody tr").forEach(tr => out.push([...tr.children].map(td => td.textContent.replace(/,/g, ""))));
    const blob = new Blob(["﻿" + out.map(r => r.map(q).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `일별통계_${ym}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
}

/* ---------- 사원 관리 (관리자) ---------- */
function renderUsers() {
  $("#view").innerHTML = `<div class="card">
    <h3 style="margin:0 0 10px">사원 계정 발급</h3>
    <form class="bar" id="uf">
      <div><label>아이디 (영문 소문자·숫자)</label><input name="id" pattern="[a-z0-9._-]{3,20}" required placeholder="예: kim01"></div>
      <div><label>이름</label><input name="name" required></div>
      <div><label>임시 비밀번호 (6자 이상)</label><input name="pw" minlength="6" required></div>
      <div><label>권한</label><select name="role"><option value="sales">영업사원</option><option value="admin">관리자</option></select></div>
      <button class="btn">계정 만들기</button>
    </form>
    <div class="err" id="uerr"></div>
    <h3 style="margin:18px 0 8px">사원 목록</h3>
    <div class="tblwrap"><table><thead><tr><th>이름</th><th>아이디</th><th>권한</th><th>상태</th><th></th></tr></thead>
    <tbody>${users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.loginId)}</td><td>${u.role === "admin" ? "관리자" : "영업사원"}</td>
      <td><span class="tag ${u.active ? "ok" : "off"}">${u.active ? "사용중" : "중지"}</span></td>
      <td>${u.uid === me.uid ? `<span class="muted">본인</span>` : `<button class="btn ghost sm" data-uid="${u.uid}" data-act="${u.active ? 0 : 1}">${u.active ? "사용 중지" : "다시 사용"}</button>`}</td></tr>`).join("")}</tbody></table></div>
    <p class="muted">사용 중지된 계정은 로그인할 수 없으며, 입력했던 데이터는 그대로 보관됩니다. 비밀번호를 잊은 사원은 새 아이디를 발급하고 기존 계정을 중지하세요.</p></div>`;

  $("#uf").onsubmit = async ev => {
    ev.preventDefault(); $("#uerr").textContent = "";
    const f = ev.target, id = f.id.value.trim().toLowerCase();
    if (users.some(u => u.loginId === id)) { $("#uerr").textContent = "이미 사용 중인 아이디입니다."; return; }
    // 관리자 로그인 상태를 유지하기 위해 별도의 앱 인스턴스로 계정을 만든다.
    const sec = initializeApp(firebaseConfig, "secondary-" + Date.now());
    const secAuth = getAuth(sec);
    try {
      const cred = await createUserWithEmailAndPassword(secAuth, emailOf(id), f.pw.value);
      await signOut(secAuth);
      await setDoc(doc(db, "users", cred.user.uid), {
        loginId: id, name: f.name.value.trim(), role: f.role.value, active: true, createdAt: serverTimestamp()
      });
      toast(`'${id}' 계정이 만들어졌습니다.`);
      await loadUsers(); renderUsers();
    } catch (er) { console.error(er); $("#uerr").textContent = authMsg(er); }
  };
  $("#view").querySelector("tbody").onclick = async e => {
    const b = e.target.closest("button[data-uid]"); if (!b) return;
    const active = b.dataset.act === "1";
    if (!active && !confirm("이 사원의 로그인을 중지할까요?")) return;
    try { await updateDoc(doc(db, "users", b.dataset.uid), { active }); await loadUsers(); renderUsers(); toast("변경되었습니다."); }
    catch (er) { toast("실패: " + (er.code || er.message)); }
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
const norm = s => String(s ?? "").replace(/\s/g, "").toLowerCase();
const HEADER_ALIASES = {
  date: ["신규날짜", "날짜"], callCount: ["콜량"], callTime: ["콜시간"], name: ["회원명", "이름"],
  phone: ["전화번호", "연락처", "휴대폰"], dbSource: ["db출처", "db"], status: ["상태"], contractType: ["계약분류"],
  grade: ["등급분류", "등급"], newAmount: ["신규금액"], upsellNote: ["업셀여부", "업셀"], upsellDate: ["업셀날짜"],
  upsellAmount: ["업셀금액"], period: ["계약기간"], voucher: ["무료바우처"], note: ["비고"]
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
  const hi = raw.slice(0, 15).findIndex(r => r.some(c => norm(c) === "회원명"));
  if (hi < 0) return { error: "'회원명' 열이 있는 머리글 행을 찾지 못했습니다. 회원 목록 시트를 선택해 주세요." };
  const col = {};
  raw[hi].forEach((h, i) => { for (const [k, al] of Object.entries(HEADER_ALIASES)) if (col[k] === undefined && al.includes(norm(h))) col[k] = i; });
  const rows = [];
  for (let r = hi + 1; r < raw.length; r++) {
    const g = k => col[k] === undefined ? "" : raw[r][col[k]];
    const t = k => col[k] === undefined ? "" : String(txt[r]?.[col[k]] ?? "").trim();
    const name = String(g("name") ?? "").trim();
    if (!name && !t("phone")) continue;
    let phone = t("phone"); const dg = phone.replace(/\D/g, "");
    phone = (dg.length === 10 && dg.startsWith("10")) ? fmtPhone("0" + dg) : fmtPhone(phone);
    const grades = String(g("grade")).split(/[,，/]/).map(x => x.trim()).filter(Boolean);
    rows.push({
      line: r + 1, name, phone, date: cellDate(g("date"), refYear),
      dbSource: t("dbSource"), status: t("status"), contractType: t("contractType"),
      grades, grade: grades.join(", "), newAmount: toNum(g("newAmount")), period: t("period"),
      upsellNote: String(g("upsellNote") ?? "").trim(), upsellDate: cellDate(g("upsellDate"), refYear), upsellAmount: toNum(g("upsellAmount")),
      voucher: t("voucher"), note: String(g("note") ?? "").trim(),
      callCount: g("callCount") === "" ? null : toNum(g("callCount")), callTime: t("callTime")
    });
  }
  return { rows };
}

function openImport() {
  const sales = users.filter(u => u.active);
  const ownerSel = isAdmin()
    ? `<div><label>저장할 담당자 *</label><select id="xowner">${sales.map(u => `<option value="${u.uid}" ${u.uid === (filterUid || me.uid) ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>` : "";
  $("#modalRoot").innerHTML = `<div class="modal"><div class="box" style="max-width:1000px">
    <h2>엑셀에서 회원 가져오기</h2>
    <div class="bar">
      <div class="grow"><label>엑셀 파일 (.xlsx)</label><input type="file" id="xf" accept=".xlsx,.xls,.csv"></div>
      <div id="xsheetWrap" class="hidden"><label>시트</label><select id="xsheet"></select></div>
      ${ownerSel}
      <div><label>날짜가 비어 있는 행에 넣을 날짜</label><input type="date" id="xdef" value="${todayStr()}"></div>
    </div>
    <p class="muted" style="margin:0 0 8px">머리글(회원명, 전화번호, 신규 금액 등)은 기존 시트 양식과 같아야 합니다. 같은 전화번호·날짜의 회원이 이미 있으면 '중복'으로 표시되고 기본적으로 제외됩니다.</p>
    <div id="xprev"></div>
    <div class="err" id="xerr"></div>
    <div class="actions"><button type="button" class="btn ghost" id="xcancel">닫기</button><button type="button" class="btn" id="xgo" disabled>선택한 행 저장</button></div>
  </div></div>`;
  let wb = null, parsed = [], existing = new Map(), seq = 0;
  const ownerUid = () => isAdmin() ? $("#xowner").value : me.uid;
  $("#xcancel").onclick = closeModal;

  async function ensureExisting(months) {
    const uid = ownerUid();
    await Promise.all([...months].filter(m => !existing.has(`${uid}|${m}`)).map(async m => {
      const s = await getDocs(query(collection(db, "contracts"), where("ownerUid", "==", uid), where("ym", "==", m)));
      existing.set(`${uid}|${m}`, new Set(s.docs.map(d => keyOf(d.data().phone, d.data().name, d.data().date))));
    }));
  }
  const keyOf = (phone, name, date) => `${String(phone).replace(/\D/g, "") || name}|${date}`;

  async function refreshPreview() {
    const my = ++seq, def = $("#xdef").value, uid = ownerUid();
    if (!parsed.length) return;
    parsed.forEach(r => r.finalDate = r.date || def);
    const months = new Set(parsed.map(r => (r.finalDate || "").slice(0, 7)).filter(m => /^\d{4}-\d{2}$/.test(m)));
    try { await ensureExisting(months); } catch (e) { $("#xerr").textContent = "기존 데이터 확인 실패: " + (e.code || e.message); }
    if (my !== seq) return;
    const seen = new Set();
    parsed.forEach(r => {
      if (!r.name) { r.st = "err"; r.msg = "회원명 없음"; return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.finalDate || "")) { r.st = "err"; r.msg = "날짜 없음"; return; }
      const k = keyOf(r.phone, r.name, r.finalDate);
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
      <div class="tblwrap" style="max-height:340px;overflow:auto"><table><thead><tr><th>저장</th><th>상태</th><th>날짜</th><th>회원명</th><th>전화번호</th><th>DB</th><th>구분</th><th>등급</th><th class="n">신규 금액</th><th>업셀 날짜</th><th class="n">업셀 금액</th><th>콜량</th></tr></thead><tbody>
      ${parsed.map((r, i) => `<tr><td><input type="checkbox" data-i="${i}" style="width:auto" ${r.use ? "checked" : ""} ${r.st === "err" ? "disabled" : ""}></td>
        <td><span class="tag ${r.st === "ok" ? "ok" : "off"}">${r.st === "ok" ? "신규" : r.st === "dup" ? "중복" : "오류"}</span> <span class="muted">${esc(r.msg)}</span></td>
        <td>${esc(r.finalDate)}</td><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${esc(r.dbSource)}</td><td>${esc(r.status)}</td><td>${esc(r.grade)}</td>
        <td class="n">${won(r.newAmount)}</td><td>${esc(r.upsellDate)}</td><td class="n">${r.upsellAmount ? won(r.upsellAmount) : ""}</td><td>${r.callCount ?? ""}</td></tr>`).join("")}
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
      wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      $("#xsheet").innerHTML = wb.SheetNames.map(n => `<option>${esc(n)}</option>`).join("");
      // '회원명' 머리글이 있는 시트를 우선 선택
      const best = wb.SheetNames.find(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" }).slice(0, 15).some(r => r.some(c => norm(c) === "회원명")));
      if (best) $("#xsheet").value = best;
      $("#xsheetWrap").classList.toggle("hidden", wb.SheetNames.length < 2);
      readSheet();
    } catch (er) { console.error(er); $("#xerr").textContent = "파일을 읽지 못했습니다: " + er.message; }
  };
  $("#xsheet").onchange = readSheet;
  $("#xdef").onchange = () => { parsed.forEach(r => { r.use = undefined; }); refreshPreview(); };
  if (isAdmin()) $("#xowner").onchange = () => { parsed.forEach(r => { r.use = undefined; }); refreshPreview(); };

  $("#xgo").onclick = async () => {
    const uid = ownerUid(), todo = parsed.filter(r => r.use && r.st !== "err");
    if (!todo.length) return;
    $("#xgo").disabled = true; $("#xerr").textContent = "";
    try {
      const ops = [];
      todo.forEach(r => {
        const data = {
          ownerUid: uid, date: r.finalDate, ym: r.finalDate.slice(0, 7), name: r.name, phone: r.phone,
          dbSource: r.dbSource, status: r.status, contractType: r.contractType, grades: r.grades, grade: r.grade,
          newAmount: r.newAmount, period: r.period, upsellNote: r.upsellNote, upsellDate: r.upsellDate,
          upYm: r.upsellDate ? r.upsellDate.slice(0, 7) : "", upsellAmount: r.upsellAmount,
          voucher: r.voucher, note: r.note, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        };
        ops.push(b => b.set(doc(collection(db, "contracts")), data));
      });
      // 일별 콜량/콜시간 (날짜별로 마지막 값 사용)
      const dmap = new Map();
      todo.forEach(r => { if (r.callCount !== null || r.callTime) { const o = dmap.get(r.finalDate) || {}; if (r.callCount !== null) o.callCount = r.callCount; if (r.callTime) o.callTime = r.callTime; dmap.set(r.finalDate, o); } });
      dmap.forEach((o, date) => ops.push(b => b.set(doc(db, "daily", `${uid}_${date}`), { ownerUid: uid, date, ym: date.slice(0, 7), ...o, updatedAt: serverTimestamp() }, { merge: true })));
      for (let i = 0; i < ops.length; i += 200) {
        const b = writeBatch(db); ops.slice(i, i + 200).forEach(f => f(b)); await b.commit();
      }
      closeModal(); toast(`${todo.length}건을 저장했습니다.`);
      const first = todo.map(r => r.finalDate).sort()[0];
      ym = first.slice(0, 7); if (isAdmin()) filterUid = uid;
      await loadMonth(); render();
    } catch (er) { console.error(er); $("#xerr").textContent = "저장 실패: " + (er.code || er.message); $("#xgo").disabled = false; }
  };
}
