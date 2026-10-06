const { execFile } = require("child_process");
require("dotenv").config();

/* ==== FETCHER Cloudflare-aware (berbasis curl) ====
   IP server/Vercel diblokir Cloudflare lk21. Solusi: rotasi proxy.
   Kita pakai curl (bukan axios) karena curl handal menangani CONNECT
   https lewat proxy publik dan redirect http<->https. */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || "25000", 10);

let daftarProxy = [];
try {
    if (process.env.PROXY_LIST) {
        daftarProxy = process.env.PROXY_LIST.split(",").map(s => s.trim()).filter(Boolean);
    } else if (process.env.PROXY_FILE) {
        daftarProxy = require("fs").readFileSync(process.env.PROXY_FILE, "utf8")
            .split("\n").map(s => s.trim()).filter(Boolean);
    }
} catch (e) { /* daftar kosong */ }

let proxyAktif = null;
let indeks = 0;

function proxyBerikut() {
    if (!daftarProxy.length) return null;
    const p = daftarProxy[indeks % daftarProxy.length];
    indeks++;
    return p;
}

/* curl 1x -> { status, body } | throw */
function curlOnce(url, proxy) {
    return new Promise((resolve, reject) => {
        const args = [
            "-s", "-L", "--max-redirs", "4",
            "-m", String(Math.ceil(TIMEOUT_MS / 1000)),
            "-w", "\n__CURL_CODE__%{http_code}",
            "-H", "User-Agent: " + UA,
            "-H", "Accept-Language: id-ID,id;q=0.9,en;q=0.8",
            url
        ];
        if (proxy) args.unshift("-x", proxy);
        execFile("curl", args, { maxBuffer: 20 * 1024 * 1024, timeout: TIMEOUT_MS + 5000 }, (err, stdout, stderr) => {
            if (err && !stdout) return reject(err);
            const idx = stdout.lastIndexOf("\n__CURL_CODE__");
            if (idx < 0) return reject(new Error("curl: output tidak terbaca"));
            const status = parseInt(stdout.slice(idx + 15).trim(), 10);
            const body = stdout.slice(0, idx);
            resolve({ status, body });
        });
    });
}

async function ambil(url) {
    // 1) proxy yang terakhir berhasil
    if (proxyAktif) {
        try {
            const r = await curlOnce(url, proxyAktif);
            if (r.status === 200 && !isChallenge(r.body)) return { status: r.status, data: r.body };
        } catch (e) { proxyAktif = null; }
    }
    // 2) tanpa proxy
    try {
        const r = await curlOnce(url, null);
        if (r.status === 200 && !isChallenge(r.body)) return { status: r.status, data: r.body };
    } catch (e) { /* lanjut */ }
    // 3) rotasi daftar proxy (maks 15 percobaan)
    for (let i = 0; i < daftarProxy.length && i < 15; i++) {
        const p = proxyBerikut();
        if (!p) break;
        try {
            const r = await curlOnce(url, p);
            if (r.status === 200 && !isChallenge(r.body)) {
                proxyAktif = p;
                return { status: r.status, data: r.body };
            }
        } catch (e) { /* coba berikutnya */ }
    }
    const err = new Error("Semua jalur gagal (direct + proxy) untuk " + url);
    err.status = 502;
    throw err;
}

function isChallenge(body) {
    const cek = (body || "").slice(0, 3000);
    return /just a moment|tunggu sebentar|cf-chl|challenge-platform/i.test(cek);
}

module.exports = { ambil, UA };
