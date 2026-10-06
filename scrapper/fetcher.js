const { execFile } = require("child_process");
require("dotenv").config();

/* ==== FETCHER Cloudflare-aware (curl + RACE paralel) ====
   IP server/Vercel diblokir Cloudflare lk21 → wajib lewat proxy residensial.
   Pendekatan lama: mencoba proxy SATU-SATU (25s per proxy) → request bisa
   >100s dan mati di batas waktu Vercel.
   Solusi: RACE — semua jalur (direct + beberapa proxy) ditembak BERSAMAAN
   dengan timeout pendek; yang pertama sukses (HTTP 200, bukan halaman
   challenge) langsung dipakai, sisanya dibiarkan. Hasilnya <15s. */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || "12000", 10);
const MAKS_BERSAMAAN = parseInt(process.env.FETCH_MAKS_BERSAMAAN || "12", 10);

let daftarProxy = [];
try {
    if (process.env.PROXY_LIST) {
        daftarProxy = process.env.PROXY_LIST.split(",").map(s => s.trim()).filter(Boolean);
    } else if (process.env.PROXY_FILE) {
        daftarProxy = require("fs").readFileSync(process.env.PROXY_FILE, "utf8")
            .split("\n").map(s => s.trim()).filter(Boolean);
    }
} catch (e) { daftarProxy = []; }

/* Urutkan acak supaya tiap request mencoba kombinasi proxy berbeda */
function acak(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function isChallenge(body) {
    const cek = (body || "").slice(0, 3000);
    return /just a moment|tunggu sebentar|cf-chl|challenge-platform/i.test(cek);
}

/* curl 1x → { status, body } */
function curlOnce(url, proxy) {
    return new Promise((resolve, reject) => {
        const args = [
            "-s", "-L", "--max-redirs", "4",
            "-m", String(Math.ceil(TIMEOUT_MS / 1000)),
            "-w", "\n__CURL_CODE__%{http_code}",
            "-H", "User-Agent: " + UA,
            "-H", "Accept-Language: id-ID,id;q=0.9,en;q=0.8",
            "-H", "X-Requested-With: XMLHttpRequest",
            "-H", "Referer: https://tv12.lk21official.cc/",
        ];
        if (proxy) args.unshift("-x", proxy);
        args.push(url);
        execFile("curl", args, { maxBuffer: 20 * 1024 * 1024, timeout: TIMEOUT_MS + 3000 }, (err, stdout) => {
            if (err && !stdout) return reject(err);
            const idx = stdout.lastIndexOf("__CURL_CODE__");
            if (idx < 0) return reject(new Error("curl: output tidak terbaca"));
            const m = /(\d{3})\s*$/.exec(stdout.slice(idx));
            const status = m ? parseInt(m[1], 10) : 0;
            const body = stdout.slice(0, idx).replace(/\n$/, "");
            resolve({ status, body });
        });
    });
}

/* Race semua jalur; resolve pada pemenang pertama, reject kalau semua gagal */
async function ambil(url) {
    /* Normalisasi: buang trailing slash (kecuali root) — /latest/ -> /latest
       menghindari 301 http<->https yang memicu challenge */
    try {
        const u = new URL(url);
        if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
            u.pathname = u.pathname.slice(0, -1);
            url = u.toString();
        }
    } catch (e) {}
    const jalur = [null, ...acak(daftarProxy).slice(0, MAKS_BERSAMAAN)];

    return new Promise((resolve, reject) => {
        let selesai = false;
        let gagal = 0;
        const total = jalur.length;
        const catat = [];

        jalur.forEach((proxy) => {
            curlOnce(url, proxy).then((r) => {
                if (selesai) return;
                if (r.status === 200 && !isChallenge(r.body)) {
                    selesai = true;
                    /* proxy pemenang didahulukan untuk request berikutnya */
                    if (proxy) {
                        daftarProxy = [proxy, ...daftarProxy.filter(p => p !== proxy)];
                    }
                    resolve({ status: r.status, data: r.body, proxy: proxy || "direct" });
                } else {
                    gagal++;
                    catat.push((proxy || "direct") + "=" + r.status);
                    if (gagal === total) {
                        const e = new Error("Semua jalur gagal (" + catat.join(",") + ") untuk " + url);
                        e.status = 502;
                        reject(e);
                    }
                }
            }).catch(() => {
                if (selesai) return;
                gagal++;
                if (gagal === total) {
                    const e = new Error("Semua jalur gagal (timeout/error) untuk " + url);
                    e.status = 502;
                    reject(e);
                }
            });
        });
    });
}

module.exports = { ambil, UA };
