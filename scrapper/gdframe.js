// Resolver gdframe/sharer — fallback sumber untuk judul yang host vidara lambat/gagal.
// Chain: POST sharer.link/data.php -> play.php/gdframe.php -> gdriveplayer embed2.php
//        -> dekrip JS (atob + XOR key dinamis) -> hlsplaylist.php -> .m3u8 final
const UA_BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function _b64decodeKeepSlashes(s) {
    // JS atob dengan escape "\/" pada JSON-ish string: pulihkan '/' lalu decode latin-1
    return Buffer.from(s.replace(/\\\//g, "/"), "base64").toString("latin1");
}

async function gdframeResolve(slug, log = () => {}) {
    const H = { "User-Agent": UA_BROWSER, "Referer": "https://terbit21.org/" };
    // 1) daftar provider
    const r1 = await fetch("https://sharer.link/data.php", {
        method: "POST",
        headers: { ...H, "Content-Type": "application/x-www-form-urlencoded" },
        body: "movie=" + encodeURIComponent(slug)
    });
    if (!r1.ok) throw new Error("data.php " + r1.status);
    const prov = await r1.text();
    if (/NOT FOUND|not-found\.html/.test(prov)) throw new Error("NOT_FOUND");
    // pilih gdframe dulu, lalu g-hydrax
    const pick = /iframe=gdframe/.test(prov) ? "gdframe" : (/iframe=g-hydrax/.test(prov) ? "g-hydrax" : null);
    if (!pick) throw new Error("NO_PROVIDER");

    // 2) halaman play (berisi iframe gdframe.php)
    const r2 = await fetch(`https://sharer.link/play.php?movie=${encodeURIComponent(slug)}&iframe=${pick}`, { headers: H });
    if (!r2.ok) throw new Error("play.php " + r2.status);
    const playHtml = await r2.text();
    const m2 = playHtml.match(/iframe\s+src="([^"]*gdframe\.php\?[^"]+)"/);
    if (!m2) throw new Error("gdframe iframe tidak ditemukan");
    let gdUrl = m2[1].startsWith("//") ? "https:" + m2[1] : m2[1];

    // 3) gdframe.php -> iframe gdriveplayer embed2
    const r3 = await fetch(gdUrl, { headers: { ...H, "Referer": "https://sharer.link/play.php" } });
    if (!r3.ok) throw new Error("gdframe " + r3.status);
    const gdHtml = await r3.text();
    const m3 = gdHtml.match(/<iframe src="([^"]+)"/);
    if (!m3) throw new Error("embed iframe tidak ditemukan");
    let embedUrl = m3[1].startsWith("//") ? "https:" + m3[1] : m3[1];

    // 4) embed2.php -> JS obfuskasi (atob + XOR)
    const r4 = await fetch(embedUrl, { headers: { ...H, "Referer": "https://sharer.link/" } });
    if (!r4.ok) throw new Error("embed2 " + r4.status);
    const embHtml = await r4.text();
    const mk = embHtml.match(/var\s+k="([A-Za-z0-9]+)"/);
    const mb = embHtml.match(/atob\("([^"]+)"\)/);
    if (!mk || !mb) throw new Error("obfuskasi tidak dikenali");
    const key = mk[1];
    const b = _b64decodeKeepSlashes(mb[1]);
    let o = "";
    for (let i = 0; i < b.length; i++) o += String.fromCharCode(b.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    // 5) HLS path di config jwplayer
    const mh = o.match(/HLS="([^"]+)"/);
    if (!mh) throw new Error("HLS path tidak ditemukan di dekripsi");
    let hlsPath = mh[1];
    if (hlsPath.startsWith("//")) hlsPath = "https:" + hlsPath;
    else if (!/^https?:\/\//.test(hlsPath)) hlsPath = "https://gdriveplayer.to/" + hlsPath.replace(/^\//, "");
    log("gdframe HLS:", hlsPath.slice(0, 90));
    return { hlsFinal: hlsPath, provider: pick };
}

module.exports = { gdframeResolve, UA_BROWSER };
