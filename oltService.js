// oltService.js - FAST & OPTIMIZED VERSION
const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

// ==========================================
// 1. HSairpo API (Panglejar & Sukamelang) - TIDAK DIUBAH
// ==========================================
async function cekRedamanHSAirpoAPI(oltConfig, mac) {
    try {
        const searchMac = mac.substring(0, 16); // POTONG 1 KARAKTER
        const username = oltConfig.user || 'root';
        const password = oltConfig.pass || 'admin';
        const key = crypto.createHash('md5').update(`${username}:${password}`).digest('hex');
        const value = Buffer.from(password).toString('base64');

        const loginRes = await axios.post(`http://${oltConfig.ip}:${oltConfig.port}/userlogin?form=login`, {
            method: "set", param: { name: username, key, value, captcha_v: "", captcha_f: "" }
        }, { headers: { 'Content-Type': 'application/json;charset=UTF-8', 'x-token': 'null' }, timeout: 8000 });

        if (loginRes.data.code !== 1) throw new Error(`Login Gagal`);
        const token = loginRes.headers['x-token'];
        if (!token) throw new Error('Token tidak ditemukan');

        for (let port = 1; port <= 16; port++) {
            const res = await axios.get(`http://${oltConfig.ip}:${oltConfig.port}/onu_allow_list?port_id=${port}`, {
                headers: { 'x-token': token }, timeout: 4000
            });
            const found = (res.data.data || []).find(x => (x.macaddr || x.mac || '').toLowerCase().startsWith(searchMac.toLowerCase()));
            if (found) {
                let redaman = found.receive_power || 'N/A';
                if (redaman !== 'N/A' && !String(redaman).toLowerCase().includes('dbm')) redaman = `${redaman} dBm`;
                return { olt_name: `${oltConfig.label} (PON ${port})`, mac_onu: found.macaddr, redaman, status: found.status || 'Online' };
            }
        }
        return null;
    } catch (error) {
        return { error: `Timeout/Gagal` };
    }
}

// ==========================================
// 2. HSairpo CIBAROLA - TIDAK DIUBAH (Paling Cepat)
// ==========================================
async function cekRedamanHSAirpoCibarola(oltConfig, mac) {
    try {
        const cleanTargetMac = mac.replace(/[:.\-]/g, '').toLowerCase();
        const matchTarget = cleanTargetMac.substring(0, 11); // MAC Full dicocokkan 11 karakter depan

        const passwordBase64 = Buffer.from(oltConfig.pass || 'admin').toString('base64');
        const loginRes = await axios.post(
            `http://${oltConfig.ip}:${oltConfig.port}/login/Auth`,
            { userName: oltConfig.user || 'admin', password: passwordBase64 },
            { headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, timeout: 8000 }
        );

        if (loginRes.data.errCode !== 'success') throw new Error('Login Gagal');

        const cookies = loginRes.headers['set-cookie'];
        let sessionCookie = '';
        if (cookies) {
            cookies.forEach(cookie => {
                if (cookie.includes('_:USERNAME:_=')) sessionCookie = cookie.split(';')[0];
            });
        }
        if (!sessionCookie) throw new Error('Cookie tidak ditemukan');

        const totalPon = oltConfig.total_pon || 4;
        for (let i = 1; i <= totalPon; i++) {
            const ponPort = `pon${i}`;
            const timestamp = Math.random();
            
            const opticalRes = await axios.get(
                `http://${oltConfig.ip}:${oltConfig.port}/goform/getPortOnuOptical?${timestamp}&PonPortName=${ponPort}`,
                { headers: { 'Cookie': sessionCookie, 'X-Requested-With': 'XMLHttpRequest' }, timeout: 5000 }
            );

            let jsonData = opticalRes.data;
            if (typeof jsonData === 'string') {
                try { jsonData = JSON.parse(jsonData); } catch (e) {}
            }

            if (jsonData && jsonData.list) {
                const found = jsonData.list.find(onu => {
                    const onuMac = (onu.mac || '').replace(/\./g, '').toLowerCase();
                    return onuMac.startsWith(matchTarget);
                });

                if (found) {
                    let redaman = found.rxpower || 'N/A';
                    if (redaman !== 'N/A' && !String(redaman).toLowerCase().includes('dbm')) redaman = `${redaman} dBm`;
                    return {
                        olt_name: `${oltConfig.label} (${ponPort.toUpperCase()})`,
                        mac_onu: found.mac,
                        redaman: redaman,
                        status: 'Online'
                    };
                }
            }
        }
        return null;
    } catch (error) {
        return { error: `Timeout/Gagal` };
    }
}

// ==========================================
// 3. Hioso (Perum, 4Pon, 8Pon) - OPTIMIZED CEPAT
// ==========================================
async function cekRedamanHioso(oltConfig, mac) {
    const searchMac = mac.substring(0, 16); // POTONG 1 KARAKTER SESUAI PERMINTAAN
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    
    try {
        const page = await browser.newPage();
        // Set timeout ketat agar tidak macet & cepat
        page.setDefaultTimeout(8000);
        page.setDefaultNavigationTimeout(8000);

        const baseUrl = `http://${oltConfig.ip}:${oltConfig.port}`;
        const user = oltConfig.user || 'admin';
        const pass = oltConfig.pass || 'admin';
        let targetFrame = page;

        if (oltConfig.iframe) {
            // === LOGIKA 8 PON SUKAMELANG (Double Login + Iframe) ===
            await page.authenticate({ username: user, password: pass }).catch(() => {});
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

            // Login 1
            if (await page.$('#a')) {
                await page.type('#a', user).catch(()=>{});
                await page.type('#b', pass).catch(()=>{});
                await page.click('input[type="button"]').catch(()=>{});
                await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
            }
            await new Promise(r => setTimeout(r, 800)); // Jeda singkat

            // Login 2
            if (await page.$('#a')) {
                await page.type('#a', user).catch(()=>{});
                await page.type('#b', pass).catch(()=>{});
                await page.click('input[type="button"]').catch(()=>{});
                await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
            }
            await new Promise(r => setTimeout(r, 800));

            // Navigasi Iframe
            let leftFrame = page.frames().find(f => f.name() === 'leftFrame' || f.name()?.toLowerCase().includes('left'));
            if (leftFrame) {
                await leftFrame.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const link = links.find(l => l.innerText.trim() === 'All ONU' || l.innerText.trim() === 'All ONUs');
                    if (link) link.click();
                }).catch(() => {});
                await new Promise(r => setTimeout(r, 1500));
            }

            targetFrame = page.frames().find(f => f.name() === 'mainFrame' || f.name()?.toLowerCase().includes('main')) || page;
            
            // Bypass Pagination
            await targetFrame.evaluate(() => {
                if (typeof setNumPerPage === 'function') setNumPerPage(300);
            }).catch(() => {});
            await new Promise(r => setTimeout(r, 1500));

        } else {
            // === LOGIKA PERUM & 4 PON SUKAMELANG (Single Login + Direct URL) ===
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

            // Login 1x Saja
            if (await page.$('#a')) {
                await page.type('#a', user).catch(()=>{});
                await page.type('#b', pass).catch(()=>{});
                await page.click('input[type="button"]').catch(()=>{});
                await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
            }
            await new Promise(r => setTimeout(r, 800));

            // Langsung ke halaman ONU (Tanpa Iframe)
            await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { waitUntil: 'domcontentloaded' }).catch(() => {});
            targetFrame = page; 
        }

        // Ekstraksi Data Redaman
        const rxPowerResult = await targetFrame.evaluate((macToFind) => {
            const cleanTarget = macToFind.replace(/[:.\-]/g, '').toLowerCase();
            const rows = Array.from(document.querySelectorAll('table tr'));
            for (let row of rows) {
                if (row.innerText.replace(/[:.\-]/g, '').toLowerCase().includes(cleanTarget)) {
                    const match = row.innerText.replace(/\s+/g, ' ').trim().match(/-\d+\.\d+/);
                    return match ? match[0] : null;
                }
            }
            return null;
        }, searchMac).catch(() => null);

        if (rxPowerResult) {
            return { olt_name: oltConfig.label, mac_onu: searchMac, redaman: `${rxPowerResult} dBm`, status: 'Online' };
        }
        return null;

    } catch (error) {
        return { error: `Timeout/Gagal` };
    } finally {
        // WAJIB: Tutup browser agar memori lega & bot cepat
        await browser.close().catch(() => {});
    }
}

// ==========================================
// 4. SCAN PARALLEL (Agar Bot Sangat Cepat)
// ==========================================
async function scanSemuaOlt(oltList, mac) {
    // Jalankan semua OLT secara PARALLEL (Bersamaan)
    const promises = oltList.map(async (olt) => {
        let hasil = null;
        
        if (olt.type === 'HSAirpo') {
            if (olt.method === 'cibarola') hasil = await cekRedamanHSAirpoCibarola(olt, mac);
            else hasil = await cekRedamanHSAirpoAPI(olt, mac);
        } else if (olt.type === 'Hioso') {
            hasil = await cekRedamanHioso(olt, mac);
        }

        if (hasil && !hasil.error) {
            return `\n✅ *${hasil.olt_name}*\n   📉 Redaman: *${hasil.redaman}*\n   📡 Status: ${hasil.status}`;
        } else if (hasil && hasil.error) {
            return `\n️ *${olt.label}*: ${hasil.error}`;
        }
        return null;
    });

    const results = await Promise.allSettled(promises);
    const hasilAkhir = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);

    if (hasilAkhir.length === 0) return '⚠️ ONU tidak ditemukan di OLT manapun pada cabang ini.';
    return hasilAkhir.join('\n');
}

module.exports = { scanSemuaOlt };
