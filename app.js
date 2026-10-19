// 카운터 알림 - 관리자 홈페이지
// 5단계: 로그인 / 자동 로그인 / 로그아웃
// 6단계: 메시지 보내기 (크리드PC / FangPC / 둘 다), 보낸 메시지 확인 상태 실시간 보기, 취소
// 비밀번호는 이 코드에 없음. Firebase가 로그인할 때만 확인함.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, get, push, update, remove, onValue,
  query, orderByChild, limitToLast, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Firebase 설정 (공개돼도 되는 값. 실제 보안은 Firebase 규칙이 맡음)
const firebaseConfig = {
  apiKey: "AIzaSyCHiuEtWsyHC8speANPFjZ0TgN-BBxloUY",
  authDomain: "pcbang-counter.firebaseapp.com",
  databaseURL: "https://pcbang-counter-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "pcbang-counter",
};

// 화면에서 입력하는 아이디 → Firebase 계정 이메일
const ACCOUNTS = {
  "사장님": "owner@code.com",
  "매니저": "manager@code.com",
};

// 홈페이지를 쓸 수 있는 역할 (카운터 계정은 못 들어옴)
const ROLE_NAMES = { owner: "사장님", manager: "매니저" };

// 매장 코드 → 화면 이름 (3번째 매장은 여기에 한 줄 추가)
const STORES = { creed: "크리드PC", fang: "FangPC" };

const LIST_LIMIT = 30;   // 매장마다 최근 몇 개까지 보여줄지

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = (id) => document.getElementById(id);
const screens = ["loading", "login", "home"];

let currentRole = null;
let unsubscribers = [];
let lists = {};

function show(name) {
  for (const s of screens) $(s).classList.toggle("hidden", s !== name);
}

// ---------- 공통 ----------

// 브라우저 저장소는 막혀 있을 수도 있어서 실패해도 그냥 넘어감
function remember(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* 무시 */ }
}
function recall(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

// 오늘이면 "22:58", 아니면 "10/19 22:58"
function timeText(ms) {
  if (typeof ms !== "number" || ms <= 0) return "";
  const d = new Date(ms);
  const now = new Date();
  const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return hm;
  return (d.getMonth() + 1) + "/" + d.getDate() + " " + hm;
}

// ---------- 로그인 ----------

function setError(text) {
  $("loginError").textContent = text || "";
}

function setLoginBusy(busy) {
  $("loginBtn").disabled = busy;
  $("loginBtn").textContent = busy ? "로그인 중…" : "로그인";
}

function loginErrorMessage(err) {
  switch (err && err.code) {
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "아이디 또는 비밀번호가 맞지 않습니다.";
    case "auth/too-many-requests":
      return "로그인 시도가 너무 많습니다. 잠시 후 다시 해주세요.";
    case "auth/network-request-failed":
      return "인터넷 연결을 확인해주세요.";
    default:
      return "로그인에 실패했습니다. (" + ((err && (err.code || err.message)) || "알 수 없음") + ")";
  }
}

const lastId = recall("lastLoginId");
if (lastId) $("loginId").value = lastId;

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");

  const id = $("loginId").value.trim();
  const email = ACCOUNTS[id];
  if (!email) {
    setError("아이디는 '사장님' 또는 '매니저'입니다.");
    return;
  }

  setLoginBusy(true);
  try {
    // 자동 로그인: 체크하면 브라우저를 껐다 켜도 로그인 유지, 아니면 창 닫으면 로그아웃
    await setPersistence(auth, $("autoLogin").checked ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, email, $("loginPw").value);
    remember("lastLoginId", id);
    $("loginPw").value = "";
  } catch (err) {
    setError(loginErrorMessage(err));
  } finally {
    setLoginBusy(false);
  }
});

$("logoutBtn").addEventListener("click", async () => {
  stopList();
  await signOut(auth);
});

// ---------- 메시지 보내기 ----------

function setNote(text, bad) {
  $("sendNote").textContent = text || "";
  $("sendNote").classList.toggle("bad", !!bad);
}

// 지난번에 고른 매장 기억
const lastTarget = recall("lastTarget");
if (lastTarget) {
  const radio = document.querySelector('input[name="target"][value="' + lastTarget + '"]');
  if (radio) radio.checked = true;
}

$("sendForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("msgText").value.trim();
  if (!text) return;

  const user = auth.currentUser;
  if (!user || !currentRole) return;

  const target = document.querySelector('input[name="target"]:checked').value;
  const stores = target === "both" ? Object.keys(STORES) : [target];

  // "둘 다"면 매장마다 한 건씩, 한 번에 저장 (둘 중 하나만 들어가는 일 없게)
  const updates = {};
  for (const store of stores) {
    const key = push(ref(db, "inbox/" + store)).key;
    updates["inbox/" + store + "/" + key] = {
      text: text,
      fromName: ROLE_NAMES[currentRole],
      fromUid: user.uid,
      status: "pending",
      createdAt: serverTimestamp(),
    };
  }

  $("sendBtn").disabled = true;
  setNote("보내는 중…");
  try {
    await update(ref(db), updates);
    $("msgText").value = "";
    setNote("보냈습니다. 몇 초 안에 카운터에 뜹니다.");
    remember("lastTarget", target);
  } catch (err) {
    setNote("보내지 못했습니다: " + (err.code || err.message), true);
  } finally {
    $("sendBtn").disabled = false;
  }
});

// ---------- 보낸 메시지 목록 (실시간) ----------

function startList() {
  stopList();
  for (const store of Object.keys(STORES)) {
    lists[store] = [];
    const q = query(ref(db, "inbox/" + store), orderByChild("createdAt"), limitToLast(LIST_LIMIT));
    const unsub = onValue(q, (snap) => {
      const items = [];
      snap.forEach((child) => {
        items.push({ id: child.key, store: store, ...child.val() });
      });
      lists[store] = items;
      renderList();
    }, (err) => {
      setNote("목록을 불러오지 못했습니다: " + (err.code || err.message), true);
    });
    unsubscribers.push(unsub);
  }
}

function stopList() {
  for (const unsub of unsubscribers) unsub();
  unsubscribers = [];
  lists = {};
  $("msgList").replaceChildren();
}

function renderList() {
  const all = Object.values(lists).flat()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  $("emptyList").classList.toggle("hidden", all.length > 0);
  $("msgList").replaceChildren(...all.map(renderItem));
}

// 글자는 textContent로만 넣음 (메시지 안에 코드가 있어도 실행되지 않게)
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderItem(m) {
  const li = el("li", "msg");

  const top = el("div", "msg-top");
  top.appendChild(el("span", "store", STORES[m.store] || m.store));
  if (m.status === "confirmed") {
    top.appendChild(el("span", "badge confirmed", "확인됨 " + timeText(m.confirmedAt)));
  } else {
    top.appendChild(el("span", "badge pending", "대기중"));
  }
  li.appendChild(top);

  li.appendChild(el("p", "msg-text", m.text || ""));

  const bottom = el("div", "msg-bottom");
  bottom.appendChild(el("span", "meta", (m.fromName || "") + " · " + timeText(m.createdAt)));

  // 아직 확인 안 된 메시지는 취소 가능 → 카운터 창에서도 사라짐
  if (m.status !== "confirmed") {
    const cancel = el("button", "link", "취소");
    cancel.type = "button";
    cancel.addEventListener("click", async () => {
      if (!confirm("이 메시지를 취소할까요?\n카운터 창에서도 사라집니다.")) return;
      try {
        await remove(ref(db, "inbox/" + m.store + "/" + m.id));
      } catch (err) {
        setNote("취소하지 못했습니다: " + (err.code || err.message), true);
      }
    });
    bottom.appendChild(cancel);
  }
  li.appendChild(bottom);

  return li;
}

// ---------- 로그인 상태가 바뀔 때마다 (처음 열 때 자동 로그인 포함) ----------

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentRole = null;
    stopList();
    show("login");
    return;
  }

  // members 명단에서 역할 확인 → 사장님/매니저만 통과
  let role = null;
  try {
    const snap = await get(ref(db, "members/" + user.uid));
    role = snap.val();
  } catch (e) {
    role = null;   // 명단을 못 읽으면 명단에 없는 계정
  }

  if (!ROLE_NAMES[role]) {
    await signOut(auth);
    setError("이 계정은 관리자 페이지를 쓸 수 없습니다.");
    return;
  }

  currentRole = role;
  $("whoami").textContent = (role === "owner" ? "사장님으로" : "매니저로") + " 로그인됨";
  setNote("");
  show("home");
  startList();
});
