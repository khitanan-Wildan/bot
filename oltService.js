// oltService.js
const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

// ==========================================
// 1. FUNGSI CEK REDAMAN HSairpo (Metode API - Untuk Panglejar & Sukamelang)
// ==========================================
async function cekRedamanHSAirpoAPI(oltConfig, mac) {
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
        console.error(`[ERROR HSAirpo API ${oltConfig.label}]:`, error.message);
        return { error: `Gagal: ${error.message}` };
    }
}

// ==========================================
// 2. FUNGSI CEK REDAMAN HSairpo (Metode Web/Puppeteer - KHUSUS CIBAROLA)
// Berdasarkan file OLT_HSAirpo_Cibarola.js yang sudah terbukti sempurna
// ==========================================
async function cekRedamanHSAirpoWeb(oltConfig, mac) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    const baseUrl = `http://${oltConfig.ip}:${oltConfig.port}`;

    try {
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000));

        // 1. PROSES LOGIN
        const inputs = await page.$$('input');
        if (inputs.length >= 2) {
            await inputs[0].click({ clickCount: 3 });
            await inputs[0].type(oltConfig.user || 'admin');
            await inputs[1].click({ clickCount: 3 });
            await inputs[1].type(oltConfig.pass || 'admin');

            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
                const loginBtn = buttons.find(b => {
                    const txt = (b.innerText || b.value || '').toLowerCase().trim();
                    return txt.includes('log') || txt.includes('sign') || txt.includes('masuk') || txt === '确定';
                });
                if (loginBtn) loginBtn.click();
                else if (buttons.length > 0) buttons[0].click();
            });
            await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
        }
        await new Promise(r => setTimeout(r, 3000));

        // 2. NAVIGASI KE TAB OPTICAL
        await page.goto(`${baseUrl}/index.html#/pon/onu/optical`, { waitUntil: 'networkidle2' });
        const searchInputSelector = 'input[placeholder*="MAC "]';
        await page.waitForSelector(searchInputSelector, { timeout: 10000 }).catch(() => {});

        let rxPowerResult = null;
        const totalPonPorts = oltConfig.total_pon || 4;

        // 3. LOOPING SCANNING PORT PON
        for (let i = 1; i <= totalPonPorts; i++) {
            const currentPon = `pon${i}`;

            // A. Klik dropdown PON
            await page.evaluate(() => {
                const dropdownInput = document.querySelector('.el-input__inner') || document.querySelector('input[readonly]');
                if (dropdownInput) dropdownInput.click();
            });
            await new Promise(r => setTimeout(r, 500));

            // B. Pilih opsi PON dari daftar
            await page.evaluate((ponName) => {
                const items = Array.from(document.querySelectorAll('.el-select-dropdown__item, li'));
                const targetItem = items.find(el => el.innerText.trim().toLowerCase() === ponName);
                if (targetItem) targetItem.click();
            }, currentPon);
            await new Promise(r => setTimeout(r, 500));

            // C. Masukkan MAC ke kolom pencarian
            await page.$eval(searchInputSelector, el => el.value = ''); 
            await page.type(searchInputSelector, mac);

            // D. Klik ikon kaca pembesar (Search)
            await page.evaluate(() => {
                const searchIcon = document.querySelector('input[placeholder*="MAC "]').nextElementSibling;
                if (searchIcon) {
                    searchIcon.click();
                } else {
                    const btns = Array.from(document.querySelectorAll('button, i, span'));
                    const searchBtn = btns.find(b => b.className && b.className.includes('search'));
                    if (searchBtn) searchBtn.click();
                }
            });
            await new Promise(r => setTimeout(r, 2000));

            // E. Cek apakah MAC ada di tabel
            rxPowerResult = await page.evaluate((macToFind) => {
                const cleanTarget = macToFind.replace(/[:.-]/g, '').toLowerCase();
                const rows = Array.from(document.querySelectorAll('table tr'));

                for (let row of rows) {
                    const cleanRowText = row.innerText.replace(/[:.-]/g, '').toLowerCase();
                    if (cleanRowText.includes(cleanTarget)) {
                        const cells = Array.from(row.querySelectorAll('td'));
                        // Ambil Kolom ke-5 (Rx-power(dBm))
                        if (cells.length >= 6) {
                            const val = cells[5].innerText.trim();
                            if (val && val !== '-') return val;
                        }
                    }
                }
                return null;
            }, mac);

            // F. Jika ketemu, hentikan loop
            if (rxPowerResult) break;
        }

        if (rxPowerResult) {
            return {
                olt_name: oltConfig.label,
                mac_onu: mac,
                redaman: `${rxPowerResult} dBm`,
                status: 'Online'
            };
        }
        return null;

    } catch (error) {
        console.error(`[ERROR HSAirpo Web ${oltConfig.label}]:`, error.message);
        return { error: `Gagal: ${error.message}` };
    } finally {
        await browser.close();
    }
}

// ==========================================
// 3. FUNGSI CEK REDAMAN Hioso (Metode Puppeteer - Double Login & Iframe)
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

        await page.authenticate({ username: user, password: pass });
        await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });

        // Login Form 1
        const isLoginPage = await page.$('#a');
        if (isLoginPage) {
            await page.type('#a', user);
            await page.type('#b', pass);
            await page.click('input[type="button"]');
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
        }
        await new Promise(r => setTimeout(r, 2000));

        // Login Form 2 (Double Login Bypass)
        const isLogin2Page = await page.$('#a');
        if (isLogin2Page) {
            await page.type('#a', user);
            await page.type('#b', pass);
            await page.click('input[type="button"]');
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
        }
        await new Promise(r => setTimeout(r, 2000));

        let targetFrame = page;

        // Navigasi Iframe (Khusus Cibarola & Sukamelang 8Pon)
        if (oltConfig.iframe) {
            const leftFrame = page.frames().find(f => f.name() === 'leftFrame');
            if (!leftFrame) throw new Error('leftFrame tidak ditemukan.');

            await leftFrame.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const allOnuLink = links.find(link => link.innerText.trim() === 'All ONU');
                if (allOnuLink) allOnuLink.click();
            });
            await new Promise(r => setTimeout(r, 4000));

            targetFrame = page.frames().find(f => f.name() === 'mainFrame');
            if (!targetFrame) throw new Error('mainFrame tidak ditemukan.');

            await targetFrame.evaluate(() => {
                if (typeof setNumPerPage === 'function') setNumPerPage(300);
                else if (typeof OnPageSizeChange === 'function') OnPageSizeChange(300);
            }).catch(() => {});
            await new Promise(r => setTimeout(r, 5000));
        } else {
            await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { waitUntil: 'networkidle2', timeout: 15000 });
            await targetFrame.waitForSelector('table', { timeout: 10000 });
        }

        const rxPowerResult = await targetFrame.evaluate((macToFind) => {
            const cleanTarget = macToFind.replace(/[:.-]/g, '').toLowerCase();
            const rows = Array.from(document.querySelectorAll('table tr'));
            
            for (let row of rows) {
                const cleanRowText = row.innerText.replace(/[:.-]/g, '').toLowerCase();
                if (cleanRowText.includes(cleanTarget)) {
                    const rowTextClean = row.innerText.replace(/\s+/g, ' ').trim();
                    const rxPattern = /-\d+\.\d+/;
                    const match = rowTextClean.match(rxPattern);
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
        return null;

    } catch (error) {
        console.error(`[ERROR Hioso ${oltConfig.label}]:`, error.message);
        return { error: `Gagal: ${error.message}` };
    } finally {
        await browser.close();
    }
}

// ==========================================
// 4. FUNGSI SCAN SEMUA OLT (Router Utama)
// ==========================================
async function scanSemuaOlt(oltList, mac) {
    let hasilAkhir = '';
    
    for (const olt of oltList) {
        let hasil = null;
        
        if (olt.type === 'HSAirpo') {
            // Gunakan metode Web/Puppeteer jika di-flag di config, jika tidak gunakan API
            if (olt.method === 'puppeteer') {
                hasil = await cekRedamanHSAirpoWeb(olt, mac);
            } else {
                hasil = await cekRedamanHSAirpoAPI(olt, mac);
            }
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
