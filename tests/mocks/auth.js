// テスト用：firebase-auth.js（モジュール版）の代わり
// localStorage「mockAuth」= { users: { メール: { uid, password } }, current: ログイン中の uid }
const read = () => JSON.parse(localStorage.getItem("mockAuth") || '{"users":{},"current":null}');
const write = (state) => localStorage.setItem("mockAuth", JSON.stringify(state));
const authError = (code) => Object.assign(new Error(code), { code });
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));

const auth = {
    languageCode: null,
    get currentUser() {
        const state = read();
        if (!state.current) return null;
        const email = Object.keys(state.users).find((key) => state.users[key].uid === state.current);
        return { uid: state.current, email, getIdToken: async () => "test-token" };
    },
    async authStateReady() {}
};

export function getAuth() { return auth; }

export async function signInWithEmailAndPassword(_auth, email, password) {
    await wait();
    const state = read();
    const user = state.users[email];
    if (!user || user.password !== password) throw authError("auth/invalid-credential");
    state.current = user.uid;
    write(state);
    return { user: { uid: user.uid, email } };
}

export async function createUserWithEmailAndPassword(_auth, email, password) {
    await wait();
    const state = read();
    if (state.users[email]) throw authError("auth/email-already-in-use");
    if (password.length < 6) throw authError("auth/weak-password");
    const uid = "uid" + (Object.keys(state.users).length + 1);
    state.users[email] = { uid, password };
    state.current = uid;
    write(state);
    return { user: { uid, email } };
}

export async function signOut() {
    const state = read();
    state.current = null;
    write(state);
}

export async function sendPasswordResetEmail(au, email) {
    const sent = JSON.parse(localStorage.getItem("mockResets") || "[]");
    sent.push({ email, lang: au.languageCode });
    localStorage.setItem("mockResets", JSON.stringify(sent));
}
