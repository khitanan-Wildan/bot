// oltService.js
const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

// ==========================================
// 1. HSairpo API (Panglejar & Sukamelang)
// ==========================================
async function cekRedamanHSAirpoAPI(oltConfig, mac) {
    try {
        const searchMac = mac.substring(0, 16); // Potong 1 karakter terakhir (16 char)
        const username = oltConfig.user || 'root';
        const password = oltConfig.pass || 'admin';
        const key = crypto.createHash('md5').update(`${username}:${password}`).digest('hex');
        const value = Buffer.from(password).toString('base64');

        const loginRes = await axios.post(`http://${oltConfig.ip}:${oltConfig.port}/userlogin?form=login`, {
            method: "set", param: { name: username, key, value, captcha_v: "", captcha_f: "" }
        }, { headers: { 'Content-Type': 'application/json;charset=UTF-8', 'x-token': 'null' }, timeout: 10000 });

        if (loginRes.data.code !== 1) throw new Error(`Login Gagal: ${loginRes.data.message}`);
        const token = loginRes.headers['x-token'];
        if (!token) throw new Error('Token tidak ditemukan');

        for (let port = 1; port <= 16; port++) {
            const res = await axios.get(`http://${oltConfig.ip}:${oltConfig.port}/onu_allow_list?port_id=${port}`, {
                headers: { 'x-token': token }, timeout: 5000
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
        return { error: `Gagal: ${error.message}` };
    }
}

// ==========================================
// 2. HSairpo CIBAROLA (Metode Axios Super Cepat - TANPA PUPPETEER)
// ==========================================
async function cekRedamanHSAirpoCibarola(oltConfig, mac) {
    try {
        // Ambil MAC utuh, hapus semua tanda baca
        const cleanTargetMac = mac.replace(/[:.\-]/g, '').toLowerCase();
        // Ambil 11 karakter pertama untuk pencocokan (antisipasi jika ada 1 karakter berbeda di akhir)
        const matchTarget = cleanTargetMac.substring(0, 11);

        // 1. LOGIN
        const passwordBase64 = Buffer.from(oltConfig.pass || 'admin').toString('base64');
        const loginRes = await axios.post(
            `http://${oltConfig.ip}:${oltConfig.port}/login/Auth`,
            { userName: oltConfig.user || 'admin', password: passwordBase64 },
            { headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, timeout: 10000 }
        );

        if (loginRes.data.errCode !== 'success') {
            throw new Error(`Login Gagal: ${loginRes.data.errCode || 'Unknown'}`);
        }

        const cookies = loginRes.headers['set-cookie'];
        let sessionCookie = '';
        if (cookies) {
            cookies.forEach(cookie => {
                if (cookie.includes('_:USERNAME:_=')) sessionCookie = cookie.split(';')[0];
            });
        }
        if (!sessionCookie) throw new Error('Cookie session tidak ditemukan.');

        // 2. LOOP PON PORTS
        const totalPon = oltConfig.total_pon || 4;
        for (let i = 1; i <= totalPon; i++) {
            const ponPort = `pon${i}`;
            const timestamp = Math.random();
            
            const opticalRes = await axios.get(
                `http://${oltConfig.ip}:${oltConfig.port}/goform/getPortOnuOptical?${timestamp}&PonPortName=${ponPort}`,
                { headers: { 'Cookie': sessionCookie, 'X-Requested-With': 'XMLHttpRequest' }, timeout: 10000 }
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
                    if (redaman !== 'N/A' && !String(redaman).toLowerCase().includes('dbm')) {
                        redaman = `${redaman} dBm`;
                    }
                    return {
                        olt_name: `${oltConfig.label} (${ponPort.toUpperCase()})`,
                        mac_onu: found.mac,
                        redaman: redaman,
                        status: found.status || 'Online'
                    };
                }
            }
        }
        return null;
    } catch (error) {
        console.error(`[ERROR HSAirpo Cibarola ${oltConfig.label}]:`, error.message);
        return { error: `Gagal: ${error.message}` };
    }
}

// ==========================================
// 3. Hioso (Cibarola, Perum, Sukamelang)
// ==========================================
async function cekRedamanHioso(oltConfig, mac) {
    const searchMac = mac.substring(0, 16); // Potong 1 karakter terakhir (16 char)
    const browser = await puppeteer.launch({ 
        headless: 'new', 
        defaultViewport: null, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    try {
        const page = await browser.newPage();
        const baseUrl = `http://${oltConfig.ip}:${oltConfig.port}`;
        const user = oltConfig.user || 'admin';
        const pass = oltConfig.pass || 'admin';

        await page.authenticate({ username: user, password: pass });
        await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });

        const isLoginPage = await page.$('#a');
        if (isLoginPage) {
            await page.type('#a', user); await page.type('#b', pass);
            await page.click('input[type="button"]');
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
        }
        await new Promise(r => setTimeout(r, 2000));

        const isLogin2Page = await page.$('#a');
        if (isLogin2Page) {
            await page.type('#a', user); await page.type('#b', pass);
            await page.click('input[type="button"]');
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
        }
        await new Promise(r => setTimeout(r, 3000));

        let targetFrame = page;
        if (oltConfig.iframe) {
            let leftFrame = null;
            for (let i = 0; i < 5; i++) {
                leftFrame = page.frames().find(f => 
                    f.name() === 'leftFrame' || 
                    (f.name() && f.name().toLowerCase().includes('left')) ||
                    (f.url() && f.url().toLowerCase().includes('left'))
                );
                if (leftFrame) break;
                await new Promise(r => setTimeout(r, 2000));
            }

            if (!leftFrame) {
                console.warn(`[WARNING] leftFrame tidak ditemukan di ${oltConfig.label}, menggunakan halaman utama.`);
                targetFrame = page;
            } else {
                await leftFrame.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const allOnuLink = links.find(link => link.innerText.trim() === 'All ONU' || link.innerText.trim() === 'All ONUs');
                    if (allOnuLink) allOnuLink.click();
                    else {
                        const onuLink = links.find(link => link.innerText.toLowerCase().includes('onu'));
                        if (onuLink) onuLink.click();
                    }
                });
                await new Promise(r => setTimeout(r, 4000));

                targetFrame = page.frames().find(f => 
                    f.name() === 'mainFrame' || 
                    (f.name() && f.name().toLowerCase().includes('main')) ||
                    (f.url() && f.url().toLowerCase().includes('onu'))
                ) || page;

                await targetFrame.evaluate(() => {
                    if (typeof setNumPerPage === 'function') setNumPerPage(300);
                    else if (typeof OnPageSizeChange === 'function') OnPageSizeChange(300);
                    else {
                        const sel = document.querySelector('select');
                        if (sel) { sel.value = sel.options[sel.options.length - 1].value; sel.dispatchEvent(new Event('change')); }
                    }
                }).catch(() => {});
                await new Promise(r => setTimeout(r, 5000));
            }
        } else {
            await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { waitUntil: 'networkidle2', timeout: 15000 });
            await targetFrame.waitForSelector('table', { timeout: 10000 });
        }

        const rxPowerResult = await targetFrame.evaluate((macToFind) => {
            const cleanTarget = macToFind.replace(/[:.\-]/g, '').toLowerCase();
            for (let row of Array.from(document.querySelectorAll('table tr'))) {
                if (row.innerText.replace(/[:.\-]/g, '').toLowerCase().includes(cleanTarget)) {
                    const match = row.innerText.replace(/\s+/g, ' ').trim().match(/-\d+\.\d+/);
                    return match ? match[0] : 'Tidak Terdeteksi';
                }
            }
            return null;
        }, searchMac);

        return rxPowerResult ? { olt_name: oltConfig.label, mac_onu: searchMac, redaman: `${rxPowerResult} dBm`, status: 'Online' } : null;
    } catch (error) {
        return { error: `Gagal: ${error.message}` };
    } finally {
        await browser.close();
    }
}

// ==========================================
// 4. ROUTER UTAMA
// ==========================================
async function scanSemuaOlt(oltList, mac) {
    let hasilAkhir = '';
    for (const olt of oltList) {
        let hasil = null;
        if (olt.type === 'HSAirpo') {
            // Jika method-nya 'cibarola', gunakan Axios. Jika tidak, gunakan API standar.
            if (olt.method === 'cibarola') {
                hasil = await cekRedamanHSAirpoCibarola(olt, mac);
            } else {
                hasil = await cekRedamanHSAirpoAPI(olt, mac);
            }
        } else if (olt.type === 'Hioso') {
            hasil = await cekRedamanHioso(olt, mac);
        }

        if (hasil && hasil.error) hasilAkhir += `\n❌ *${olt.label}*: ${hasil.error}`;
        else if (hasil) hasilAkhir += `\n✅ *${hasil.olt_name}*\n   📉 Redaman: *${hasil.redaman}*\n   📡 Status: ${hasil.status}`;
    }
    return hasilAkhir || '⚠️ ONU tidak ditemukan di OLT manapun pada cabang ini.';
}

module.exports = { scanSemuaOlt };
