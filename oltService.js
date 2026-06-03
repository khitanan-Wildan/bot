// oltService.js - OPTIMIZED VERSION (Parallel Processing)
const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

// ==========================================
// 1. HSairpo API (Panglejar & Sukamelang) - FAST
// ==========================================
async function cekRedamanHSAirpoAPI(oltConfig, mac) {
    const timeout = 10000; // 10 detik timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const searchMac = mac.substring(0, 16);
        const username = oltConfig.user || 'root';
        const password = oltConfig.pass || 'admin';
        const key = crypto.createHash('md5').update(`${username}:${password}`).digest('hex');
        const value = Buffer.from(password).toString('base64');

        const loginRes = await axios.post(
            `http://${oltConfig.ip}:${oltConfig.port}/userlogin?form=login`,
            { method: "set", param: { name: username, key, value, captcha_v: "", captcha_f: "" } },
            { headers: { 'Content-Type': 'application/json;charset=UTF-8', 'x-token': 'null' }, timeout: 5000 }
        );

        if (loginRes.data.code !== 1) throw new Error(`Login Gagal`);
        const token = loginRes.headers['x-token'];
        if (!token) throw new Error('Token tidak ditemukan');

        for (let port = 1; port <= 16; port++) {
            const res = await axios.get(
                `http://${oltConfig.ip}:${oltConfig.port}/onu_allow_list?port_id=${port}`,
                { headers: { 'x-token': token }, timeout: 3000 }
            );
            const found = (res.data.data || []).find(x => 
                (x.macaddr || x.mac || '').toLowerCase().startsWith(searchMac.toLowerCase())
            );
            if (found) {
                let redaman = found.receive_power || 'N/A';
                if (redaman !== 'N/A' && !String(redaman).toLowerCase().includes('dbm')) 
                    redaman = `${redaman} dBm`;
                return { 
                    olt_name: `${oltConfig.label} (PON ${port})`, 
                    mac_onu: found.macaddr, 
                    redaman, 
                    status: found.status || 'Online' 
                };
            }
        }
        return null;
    } catch (error) {
        clearTimeout(timeoutId);
        return { error: `Timeout/Gagal` };
    }
}

// ==========================================
// 2. HSairpo CIBAROLA (Axios - SUPER FAST)
// ==========================================
async function cekRedamanHSAirpoCibarola(oltConfig, mac) {
    try {
        const cleanTargetMac = mac.replace(/[:.\-]/g, '').toLowerCase();
        const matchTarget = cleanTargetMac.substring(0, 11);

        const passwordBase64 = Buffer.from(oltConfig.pass || 'admin').toString('base64');
        const loginRes = await axios.post(
            `http://${oltConfig.ip}:${oltConfig.port}/login/Auth`,
            { userName: oltConfig.user || 'admin', password: passwordBase64 },
            { headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, timeout: 5000 }
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
                    if (redaman !== 'N/A' && !String(redaman).toLowerCase().includes('dbm')) 
                        redaman = `${redaman} dBm`;
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
// 3. Hioso (Puppeteer - OPTIMIZED dengan Timeout Ketat)
// ==========================================
async function cekRedamanHioso(oltConfig, mac) {
    const searchMac = mac.substring(0, 16);
    let browser = null;
    
    try {
        // Launch browser dengan timeout
        browser = await puppeteer.launch({
            headless: 'new',
            defaultViewport: null,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
            timeout: 15000
        });

        const page = await browser.newPage();
        
        // Set timeout global untuk page
        page.setDefaultTimeout(10000);
        page.setDefaultNavigationTimeout(10000);

        const baseUrl = `http://${oltConfig.ip}:${oltConfig.port}`;
        const user = oltConfig.user || 'admin';
        const pass = oltConfig.pass || 'admin';

        // HTTP Auth (jika ada)
        await page.authenticate({ username: user, password: pass }).catch(() => {});
        
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});

        // Login Form 1
        const isLoginPage = await page.$('#a').catch(() => null);
        if (isLoginPage) {
            await page.type('#a', user).catch(() => {});
            await page.type('#b', pass).catch(() => {});
            await page.click('input[type="button"]').catch(() => {});
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
        }
        await new Promise(r => setTimeout(r, 1000));

        // Login Form 2 (jika ada)
        const isLogin2Page = await page.$('#a').catch(() => null);
        if (isLogin2Page) {
            await page.type('#a', user).catch(() => {});
            await page.type('#b', pass).catch(() => {});
            await page.click('input[type="button"]').catch(() => {});
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
        }
        await new Promise(r => setTimeout(r, 1000));

        let targetFrame = page;
        
        if (oltConfig.iframe) {
            // Cari leftFrame dengan timeout singkat
            let leftFrame = null;
            for (let i = 0; i < 3; i++) {
                leftFrame = page.frames().find(f => 
                    f.name() === 'leftFrame' || 
                    (f.name() && f.name().toLowerCase().includes('left'))
                );
                if (leftFrame) break;
                await new Promise(r => setTimeout(r, 1000));
            }

            if (leftFrame) {
                await leftFrame.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const allOnuLink = links.find(link => 
                        link.innerText.trim() === 'All ONU' || link.innerText.trim() === 'All ONUs'
                    );
                    if (allOnuLink) allOnuLink.click();
                }).catch(() => {});
                
                await new Promise(r => setTimeout(r, 2000));

                targetFrame = page.frames().find(f => 
                    f.name() === 'mainFrame' || 
                    (f.name() && f.name().toLowerCase().includes('main'))
                ) || page;

                // Set jumlah baris (tanpa menunggu terlalu lama)
                await targetFrame.evaluate(() => {
                    if (typeof setNumPerPage === 'function') setNumPerPage(300);
                    else if (typeof OnPageSizeChange === 'function') OnPageSizeChange(300);
                }).catch(() => {});
                
                await new Promise(r => setTimeout(r, 2000));
            }
        } else {
            await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { 
                waitUntil: 'domcontentloaded', 
                timeout: 8000 
            }).catch(() => {});
        }

        // Cari MAC dan redaman
        const rxPowerResult = await targetFrame.evaluate((macToFind) => {
            const cleanTarget = macToFind.replace(/[:.\-]/g, '').toLowerCase();
            for (let row of Array.from(document.querySelectorAll('table tr'))) {
                if (row.innerText.replace(/[:.\-]/g, '').toLowerCase().includes(cleanTarget)) {
                    const match = row.innerText.replace(/\s+/g, ' ').trim().match(/-\d+\.\d+/);
                    return match ? match[0] : null;
                }
            }
            return null;
        }, searchMac).catch(() => null);

        if (rxPowerResult) {
            return {
                olt_name: oltConfig.label,
                mac_onu: searchMac,
                redaman: `${rxPowerResult} dBm`,
                status: 'Online'
            };
        }
        return null;

    } catch (error) {
        return { error: `Timeout/Gagal` };
    } finally {
        // Pastikan browser selalu ditutup
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
}

// ==========================================
// 4. SCAN SEMUA OLT (PARALLEL - SUPER FAST!)
// ==========================================
async function scanSemuaOlt(oltList, mac) {
    const hasilAkhir = [];
    
    // Buat array promise untuk semua OLT
    const promises = oltList.map(async (olt) => {
        let hasil = null;
        
        if (olt.type === 'HSAirpo') {
            if (olt.method === 'cibarola') {
                hasil = await cekRedamanHSAirpoCibarola(olt, mac);
            } else {
                hasil = await cekRedamanHSAirpoAPI(olt, mac);
            }
        } else if (olt.type === 'Hioso') {
            hasil = await cekRedamanHioso(olt, mac);
        }

        // Format hasil
        if (hasil && !hasil.error) {
            return `\n✅ *${hasil.olt_name}*\n   📉 Redaman: *${hasil.redaman}*\n   📡 Status: ${hasil.status}`;
        } else if (hasil && hasil.error) {
            return `\n⚠️ *${olt.label}*: ${hasil.error}`;
        }
        return null;
    });

    // Jalankan semua OLT secara PARALLEL dengan timeout global
    const results = await Promise.allSettled(promises);
    
    // Kumpulkan hasil yang berhasil
    results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
            hasilAkhir.push(result.value);
        }
    });

    if (hasilAkhir.length === 0) {
        return '⚠️ ONU tidak ditemukan di OLT manapun pada cabang ini.';
    }
    
    return hasilAkhir.join('\n');
}

module.exports = { scanSemuaOlt };
