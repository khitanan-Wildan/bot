// oltService.js - STABLE VERSION
// Mengikuti PERSIS logika script asli yang sudah terbukti berhasil
const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

// ==========================================
// 1. HSAirpo API (Panglejar & Sukamelang)
// ==========================================
async function cekRedamanHSAirpoAPI(oltConfig, mac) {
    console.log(`\n🔍 [${oltConfig.label}] Mulai cek (API)...`);
    try {
        // POTONG 1 KARAKTER (panjang 16) - SESUAI SCRIPT ASLI
        const searchMac = mac.substring(0, 16);
        console.log(`   MAC dicari: ${searchMac}`);

        const username = oltConfig.user || 'root';
        const password = oltConfig.pass || 'admin';
        const key = crypto.createHash('md5').update(`${username}:${password}`).digest('hex');
        const value = Buffer.from(password).toString('base64');

        const loginRes = await axios.post(
            `http://${oltConfig.ip}:${oltConfig.port}/userlogin?form=login`,
            { method: "set", param: { name: username, key, value, captcha_v: "", captcha_f: "" } },
            { headers: { 'Content-Type': 'application/json;charset=UTF-8', 'x-token': 'null' }, timeout: 10000 }
        );

        if (loginRes.data.code !== 1) throw new Error(`Login gagal: ${loginRes.data.message}`);
        const token = loginRes.headers['x-token'];

        // Scan port 1-16
        for (let port = 1; port <= 16; port++) {
            const res = await axios.get(
                `http://${oltConfig.ip}:${oltConfig.port}/onu_allow_list?port_id=${port}`,
                { headers: { 'x-token': token }, timeout: 5000 }
            );
            const onuList = res.data.data || [];
            
            // PERSIS SEPERTI SCRIPT ASLI: startsWith
            const found = onuList.find(x => 
                x.macaddr && x.macaddr.toLowerCase().startsWith(searchMac.toLowerCase())
            );

            if (found) {
                console.log(`   ✅ Ditemukan di PON ${port}: ${found.macaddr}`);
                let redaman = found.receive_power || 'N/A';
                if (redaman !== 'N/A' && !String(redaman).includes('dBm')) redaman = `${redaman} dBm`;
                return { olt_name: `${oltConfig.label} (PON ${port})`, mac_onu: found.macaddr, redaman, status: found.status || 'Online' };
            }
        }
        console.log(`   ❌ Tidak ditemukan di semua port`);
        return null;
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        return { error: error.message };
    }
}

// ==========================================
// 2. HSAirpo CIBAROLA (Axios API)
// ==========================================
async function cekRedamanHSAirpoCibarola(oltConfig, mac) {
    console.log(`\n🔍 [${oltConfig.label}] Mulai cek (Cibarola API)...`);
    try {
        // MAC FULL - PERSIS SEPERTI SCRIPT ASLI
        const cleanTargetMac = mac.replace(/[:.\-]/g, '').toLowerCase();
        const matchTarget = cleanTargetMac.substring(0, 11);
        console.log(`   MAC dicari: ${matchTarget}...`);

        // Login
        const passwordBase64 = Buffer.from(oltConfig.pass || 'admin').toString('base64');
        const loginRes = await axios.post(
            `http://${oltConfig.ip}:${oltConfig.port}/login/Auth`,
            { userName: oltConfig.user || 'admin', password: passwordBase64 },
            { headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, timeout: 10000 }
        );

        if (loginRes.data.errCode !== 'success') throw new Error('Login gagal');

        const cookies = loginRes.headers['set-cookie'];
        let sessionCookie = '';
        if (cookies) {
            cookies.forEach(c => { if (c.includes('_:USERNAME:_=')) sessionCookie = c.split(';')[0]; });
        }

        // Scan PON 1-4
        const totalPon = oltConfig.total_pon || 4;
        for (let i = 1; i <= totalPon; i++) {
            const ponPort = `pon${i}`;
            const opticalRes = await axios.get(
                `http://${oltConfig.ip}:${oltConfig.port}/goform/getPortOnuOptical?${Math.random()}&PonPortName=${ponPort}`,
                { headers: { 'Cookie': sessionCookie, 'X-Requested-With': 'XMLHttpRequest' }, timeout: 8000 }
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
                    console.log(`   ✅ Ditemukan di ${ponPort.toUpperCase()}: ${found.mac}`);
                    let redaman = found.rxpower || 'N/A';
                    if (redaman !== 'N/A' && !String(redaman).includes('dBm')) redaman = `${redaman} dBm`;
                    return { olt_name: `${oltConfig.label} (${ponPort.toUpperCase()})`, mac_onu: found.mac, redaman, status: 'Online' };
                }
            }
        }
        console.log(`   ❌ Tidak ditemukan di semua PON`);
        return null;
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        return { error: error.message };
    }
}

// ==========================================
// 3. Hioso (Puppeteer) - FIXED: CIBAROLA leftFrame
// ==========================================
async function cekRedamanHioso(oltConfig, mac) {
    const searchMac = mac.substring(0, 16);
    console.log(`\n🔍 [${oltConfig.label}] Mulai cek (Puppeteer)...`);
    console.log(`   MAC dicari: ${searchMac}`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(20000);
        page.setDefaultNavigationTimeout(20000);

        const baseUrl = `http://${oltConfig.ip}:${oltConfig.port}`;
        const user = oltConfig.user || 'admin';
        const pass = oltConfig.pass || 'admin';

        if (oltConfig.iframe) {
            // ==========================================
            // MODE A: CIBAROLA & 8PON SUKAMELANG
            // (HTTP Auth + Login 2x + Iframe)
            // ==========================================
            console.log(`   Mode: Double Login + Iframe`);
            
            // HTTP Basic Auth
            await page.authenticate({ username: user, password: pass });
            
            // Buka halaman utama - WAJIB networkidle2 karena iframe butuh full load
            await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 20000 });

            // Login Form 1
            if (await page.$('#a')) {
                await page.type('#a', user);
                await page.type('#b', pass);
                await page.click('input[type="button"]');
                await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
            }
            await new Promise(r => setTimeout(r, 2000));

            // Login Form 2
            if (await page.$('#a')) {
                await page.type('#a', user);
                await page.type('#b', pass);
                await page.click('input[type="button"]');
                await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
            }
            await new Promise(r => setTimeout(r, 3000));

            // 🔑 RETRY LOOP: Cari leftFrame hingga 10 detik
            let leftFrame = null;
            for (let attempt = 1; attempt <= 5; attempt++) {
                const frames = page.frames();
                console.log(`   [Attempt ${attempt}] Frames tersedia: ${frames.length}`);
                
                leftFrame = frames.find(f => f.name() === 'leftFrame');
                
                // Fallback: cari frame dengan nama mengandung 'left' atau URL mengandung 'menu'
                if (!leftFrame) {
                    leftFrame = frames.find(f => 
                        (f.name() && f.name().toLowerCase().includes('left')) ||
                        (f.url() && (f.url().includes('menu') || f.url().includes('left')))
                    );
                }
                
                if (leftFrame) {
                    console.log(`   ✅ leftFrame ditemukan di attempt ${attempt}`);
                    break;
                }
                
                console.log(`   ⏳ Menunggu 2 detik...`);
                await new Promise(r => setTimeout(r, 2000));
            }

            if (!leftFrame) {
                // Debug: tampilkan semua frame untuk analisis
                const allFrames = page.frames();
                const frameInfo = allFrames.map(f => `name="${f.name()}" url="${f.url()}"`).join('\n      ');
                throw new Error(`leftFrame tidak ditemukan setelah 10 detik.\n   Frame yang ada:\n      ${frameInfo}`);
            }

            // Klik "All ONU" di leftFrame
            await leftFrame.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const allOnuLink = links.find(link => link.innerText.trim() === 'All ONU');
                if (allOnuLink) allOnuLink.click();
            }).catch(err => console.log(`   ⚠️ Klik All ONU error: ${err.message}`));
            
            await new Promise(r => setTimeout(r, 4000));

            // Cari mainFrame
            let mainFrame = page.frames().find(f => f.name() === 'mainFrame');
            if (!mainFrame) {
                mainFrame = page.frames().find(f => 
                    (f.name() && f.name().toLowerCase().includes('main')) ||
                    (f.url() && f.url().includes('onu'))
                );
            }
            
            if (!mainFrame) throw new Error('mainFrame tidak ditemukan');

            // Bypass pagination
            await mainFrame.evaluate(() => {
                if (typeof setNumPerPage === 'function') setNumPerPage(300);
                else if (typeof OnPageSizeChange === 'function') OnPageSizeChange(300);
                else {
                    const sel = document.querySelector('select');
                    if (sel) {
                        sel.value = sel.options[sel.options.length - 1].value;
                        sel.dispatchEvent(new Event('change'));
                    }
                }
            }).catch(() => {});
            await new Promise(r => setTimeout(r, 5000));

            // Ekstraksi data - PERSIS SCRIPT ASLI
            const rxPowerResult = await mainFrame.evaluate((macToFind) => {
                const cleanTarget = macToFind.replace(/[:.-]/g, '').toLowerCase();
                const rows = Array.from(document.querySelectorAll('table tr'));
                
                for (let row of rows) {
                    const cleanRowText = row.innerText.replace(/[:.-]/g, '').toLowerCase();
                    if (cleanRowText.includes(cleanTarget)) {
                        const rowTextClean = row.innerText.replace(/\s+/g, ' ').trim();
                        const rxPattern = /-\d+\.\d+/;
                        const match = rowTextClean.match(rxPattern);
                        return match ? match[0] : null;
                    }
                }
                return null;
            }, searchMac);

            if (rxPowerResult) {
                console.log(`   ✅ Ditemukan! Redaman: ${rxPowerResult} dBm`);
                return { olt_name: oltConfig.label, mac_onu: searchMac, redaman: `${rxPowerResult} dBm`, status: 'Online' };
            }

        } else {
            // ==========================================
            // MODE B: PERUM & 4PON SUKAMELANG
            // (Login 1x + Direct URL)
            // PERSIS SEPERTI SCRIPT ASLI
            // ==========================================
            console.log(`   Mode: Single Login + Direct URL`);
            
            await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });

            // Login 1x
            if (await page.$('#a')) {
                await page.type('#a', user);
                await page.type('#b', pass);
                await page.click('input[type="button"]');
                await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
            }

            // Langsung ke halaman ONU - PERSIS SCRIPT ASLI
            await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { waitUntil: 'networkidle2', timeout: 15000 });
            
            // Antisipasi iframe - PERSIS SCRIPT ASLI
            let targetFrame = page;
            const frames = page.frames();
            if (frames.length > 1) {
                targetFrame = frames.find(f => f.url().includes('onu')) || frames[1];
            }

            await targetFrame.waitForSelector('table', { timeout: 10000 });

            // Ekstraksi - PERSIS SCRIPT ASLI (regex dengan spasi, TIDAK hapus titik)
            const rxPowerResult = await targetFrame.evaluate((macToFind) => {
                const cleanTarget = macToFind.replace(/[:-]/g, '').toLowerCase();
                const rows = Array.from(document.querySelectorAll('table tr'));
                
                for (let row of rows) {
                    const rowText = row.innerText.replace(/[:-]/g, '').toLowerCase();
                    if (rowText.includes(cleanTarget)) {
                        const cleanRowText = row.innerText.replace(/\s+/g, ' ').trim();
                        const rxPattern = /\s(-\d+\.\d+)\s/;
                        const match = cleanRowText.match(rxPattern);
                        if (match) return match[1];
                    }
                }
                return null;
            }, searchMac);

            if (rxPowerResult) {
                console.log(`   ✅ Ditemukan! Redaman: ${rxPowerResult} dBm`);
                return { olt_name: oltConfig.label, mac_onu: searchMac, redaman: `${rxPowerResult} dBm`, status: 'Online' };
            }
        }

        console.log(`   ❌ Tidak ditemukan`);
        return null;

    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        return { error: error.message };
    } finally {
        await browser.close();
    }
}

// ==========================================
// 4. SCAN SEMUA OLT - HYBRID (Cepat & Stabil)
// ==========================================
async function scanSemuaOlt(oltList, mac) {
    console.log(`\n========================================`);
    console.log(`🚀 MULAI SCAN ${oltList.length} OLT...`);
    console.log(`========================================`);

    const hasilAkhir = [];

    // Pisahkan OLT berdasarkan tipe
    const axiosOlts = oltList.filter(o => o.type === 'HSAirpo');
    const puppeteerOlts = oltList.filter(o => o.type === 'Hioso');

    // 1. Jalankan HSAirpo (Axios) secara PARALEL - CEPAT
    if (axiosOlts.length > 0) {
        console.log(`\n⚡ Menjalankan ${axiosOlts.length} HSAirpo secara paralel...`);
        const axiosPromises = axiosOlts.map(async (olt) => {
            let hasil = null;
            if (olt.method === 'cibarola') {
                hasil = await cekRedamanHSAirpoCibarola(olt, mac);
            } else {
                hasil = await cekRedamanHSAirpoAPI(olt, mac);
            }
            return { olt, hasil };
        });

        const axiosResults = await Promise.all(axiosPromises);
        axiosResults.forEach(({ olt, hasil }) => {
            if (hasil && !hasil.error) {
                hasilAkhir.push(`\n✅ *${hasil.olt_name}*\n   📉 Redaman: *${hasil.redaman}*\n   📡 Status: ${hasil.status}`);
            } else if (hasil && hasil.error) {
                hasilAkhir.push(`\n⚠️ *${olt.label}*: ${hasil.error}`);
            }
        });
    }

    // 2. Jalankan Hioso (Puppeteer) secara SEQUENTIAL - STABIL
    if (puppeteerOlts.length > 0) {
        console.log(`\n🐢 Menjalankan ${puppeteerOlts.length} Hioso secara berurutan...`);
        for (const olt of puppeteerOlts) {
            const hasil = await cekRedamanHioso(olt, mac);
            if (hasil && !hasil.error) {
                hasilAkhir.push(`\n✅ *${hasil.olt_name}*\n   📉 Redaman: *${hasil.redaman}*\n   📡 Status: ${hasil.status}`);
            } else if (hasil && hasil.error) {
                hasilAkhir.push(`\n⚠️ *${olt.label}*: ${hasil.error}`);
            }
        }
    }

    console.log(`\n========================================`);
    console.log(`✅ SCAN SELESAI!`);
    console.log(`========================================\n`);

    if (hasilAkhir.length === 0) {
        return '⚠️ ONU tidak ditemukan di OLT manapun pada cabang ini.';
    }
    return hasilAkhir.join('\n');
}

module.exports = { scanSemuaOlt };
