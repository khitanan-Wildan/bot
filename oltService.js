// oltService.js
const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

// ==========================================
// 1. FUNGSI CEK REDAMAN HSairpo (Metode API / Axios)
// ==========================================
async function cekRedamanHSAirpo(oltConfig, mac) {
    try {
        const username = oltConfig.user || 'root';
        const password = oltConfig.pass || 'admin';
        const keyString = `${username}:${password}`;
        const key = crypto.createHash('md5').update(keyString).digest('hex');
        const value = Buffer.from(password).toString('base64');

        const payload = {
            method: "set",
            param: { name: username, key: key, value: value, captcha_v: "", captcha_f: "" }
        };

        // Auto-Login
        const loginUrl = `http://${oltConfig.ip}:${oltConfig.port}/userlogin?form=login`;
        const loginRes = await axios.post(loginUrl, payload, {
            headers: { 'Content-Type': 'application/json;charset=UTF-8', 'x-token': 'null' },
            timeout: 10000
        });

        if (loginRes.data.code !== 1) {
            throw new Error(`Login Gagal: ${loginRes.data.message}`);
        }

        const token = loginRes.headers['x-token'];
        if (!token) throw new Error('Token tidak ditemukan setelah login.');

        // Scan Port 1 - 16
        for (let port = 1; port <= 16; port++) {
            const url = `http://${oltConfig.ip}:${oltConfig.port}/onu_allow_list?port_id=${port}`;
            const response = await axios.get(url, { headers: { 'x-token': token }, timeout: 5000 });
            const onuList = response.data.data || [];
            
            const found = onuList.find(x => {
                const macAddr = x.macaddr || x.mac || '';
                return macAddr.toLowerCase().startsWith(mac.toLowerCase());
            });

            if (found) {
                let redaman = found.receive_power || 'N/A';
                if (redaman !== 'N/A' && !String(redaman).toLowerCase().includes('dbm')) {
                    redaman = `${redaman} dBm`;
                }
                return {
                    olt_name: `${oltConfig.label} (Port PON ${port})`,
                    mac_onu: found.macaddr,
                    redaman: redaman,
                    status: found.status || 'Online'
                };
            }
        }
        return null;
    } catch (error) {
        console.error(`[ERROR HSAirpo ${oltConfig.label}]:`, error.message);
        return { error: `Gagal: ${error.message}` };
    }
}

// ==========================================
// 2. FUNGSI CEK REDAMAN Hioso (Metode Puppeteer)
// ==========================================
async function cekRedamanHioso(oltConfig, mac) {
    const browser = await puppeteer.launch({ 
        headless: 'new', 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });

    try {
        const page = await browser.newPage();
        const baseUrl = `http://${oltConfig.ip}:${oltConfig.port}`;
        const user = oltConfig.user || 'admin';
        const pass = oltConfig.pass || 'admin';

        await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });

        // 1. Proses Login Form
        const isLoginPage = await page.$('#a');
        if (isLoginPage) {
            await page.type('#a', user);
            await page.type('#b', pass);
            await page.click('input[type="button"]');
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
        }
        await new Promise(r => setTimeout(r, 2000));

        let targetFrame = page;

        // 2. Navigasi ke Halaman All ONU
        if (oltConfig.iframe) {
            // Metode untuk OLT dengan Iframe (Cibarola, Sukamelang 8Pon)
            const leftFrame = page.frames().find(f => f.name() === 'leftFrame');
            if (leftFrame) {
                await leftFrame.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const allOnuLink = links.find(link => link.innerText.trim() === 'All ONU');
                    if (allOnuLink) allOnuLink.click();
                });
                await new Promise(r => setTimeout(r, 4000));
                
                targetFrame = page.frames().find(f => f.name() === 'mainFrame') || page;
                
                // Paksa tampilkan 300 baris sekaligus
                await targetFrame.evaluate(() => {
                    if (typeof setNumPerPage === 'function') setNumPerPage(300);
                }).catch(() => {});
                await new Promise(r => setTimeout(r, 5000));
            }
        } else {
            // Metode Langsung (Perum)
            await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { waitUntil: 'networkidle2', timeout: 15000 });
            await targetFrame.waitForSelector('table', { timeout: 10000 });
        }

        // 3. Ekstraksi Data Redaman dari Tabel
        const rxPowerResult = await targetFrame.evaluate((macToFind) => {
            const cleanTarget = macToFind.replace(/[:.-]/g, '').toLowerCase();
            const rows = Array.from(document.querySelectorAll('table tr'));
            
            for (let row of rows) {
                const rowText = row.innerText.replace(/[:.-]/g, '').toLowerCase();
                if (rowText.includes(cleanTarget)) {
                    const cleanRowText = row.innerText.replace(/\s+/g, ' ').trim();
                    // Regex untuk mencari angka minus desimal (contoh: -18.66)
                    const rxPattern = /-\d+\.\d+/;
                    const match = cleanRowText.match(rxPattern);
                    return match ? match[0] : 'Tidak Terdeteksi';
                }
            }
            return null;
        }, mac);

        if (rxPowerResult) {
            return {
                olt_name: oltConfig.label,
                mac_onu: mac,
                redaman: `${rxPowerResult} dBm`,
                status: 'Online'
            };
        }
        
        return null; // Tidak ditemukan di OLT ini

    } catch (error) {
        console.error(`[ERROR Hioso ${oltConfig.label}]:`, error.message);
        return { error: `Gagal: ${error.message}` };
    } finally {
        await browser.close(); // Pastikan browser selalu ditutup
    }
}

// ==========================================
// 3. FUNGSI SCAN SEMUA OLT (Router Utama)
// ==========================================
async function scanSemuaOlt(oltList, mac) {
    let hasilAkhir = '';
    
    for (const olt of oltList) {
        let hasil = null;
        
        if (olt.type === 'HSAirpo') {
            hasil = await cekRedamanHSAirpo(olt, mac);
        } else if (olt.type === 'Hioso') {
            hasil = await cekRedamanHioso(olt, mac);
        }

        if (hasil && hasil.error) {
            hasilAkhir += `\n❌ *${olt.label}*: ${hasil.error}`;
        } else if (hasil) {
            hasilAkhir += `\n✅ *${hasil.olt_name}*` +
                          `\n   📉 Redaman: *${hasil.redaman}*` +
                          `\n   📡 Status: ${hasil.status}`;
        }
    }
    
    return hasilAkhir || '⚠️ ONU tidak ditemukan di OLT manapun pada cabang ini.';
}

module.exports = { scanSemuaOlt };
