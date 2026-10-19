// 카운터 알림 - 관리자 홈페이지
// 5단계: 로그인 / 자동 로그인 / 로그아웃
// 비밀번호는 이 코드에 없음. Firebase가 로그인할 때만 확인함.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = (id) => document.getElementById(id);
const screens = ["loading", "login", "home"];

function show(name) {
  for (const s of screens) $(s).classList.toggle("hidden", s !== name);
}

function setError(text) {
  $("loginError").textContent = text || "";
}

function setBusy(busy) {
  $("loginBtn").disabled = busy;
  $("loginBtn").textContent = busy ? "로그인 중…" : "로그인";
}

// 브라우저 저장소는 막혀 있을 수도 있어서 실패해도 그냥 넘어감
function remember(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* 무시 */ }
}
function recall(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function errorMessage(err) {
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

// 지난번에 쓴 아이디 미리 채우기
const lastId = recall("lastLoginId");
if (lastId) $("loginId").value = lastId;

// 로그인 버튼
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");

  const id = $("loginId").value.trim();
  const email = ACCOUNTS[id];
  if (!email) {
    setError("아이디는 '사장님' 또는 '매니저'입니다.");
    return;
  }

  setBusy(true);
  try {
    // 자동 로그인: 체크하면 브라우저를 껐다 켜도 로그인 유지, 아니면 창 닫으면 로그아웃
    await setPersistence(auth, $("autoLogin").checked ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, email, $("loginPw").value);
    remember("lastLoginId", id);
    $("loginPw").value = "";
  } catch (err) {
    setError(errorMessage(err));
  } finally {
    setBusy(false);
  }
});

// 로그아웃 버튼
$("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
});

// 로그인 상태가 바뀔 때마다 (처음 열 때 자동 로그인 포함)
onAuthStateChanged(auth, async (user) => {
  if (!user) {
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

  $("whoami").textContent = (role === "owner" ? "사장님으로" : "매니저로") + " 로그인됨";
  show("home");
});
