// oltService.js
const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

// ==========================================
// 1. HSairpo API (Panglejar & Sukamelang)
// ATURAN: Hapus 1 karakter terakhir (panjang 16)
// ==========================================
async function cekRedamanHSAirpoAPI(oltConfig, mac) {
    try {
        // POTONG 1 KARAKTER TERAKHIR (Panjang 16)
        const searchMac = mac.substring(0, 16);

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
            
            // Cari menggunakan searchMac yang sudah dipotong 1 karakter
            const found = (res.data.data || []).find(x => 
                (x.macaddr || x.mac || '').toLowerCase().startsWith(searchMac.toLowerCase())
            );
            
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
// 2. HSairpo WEB (KHUSUS CIBAROLA)
// ATURAN: MAC FULL tanpa dipotong, format jadi 1111.1111.1111
// ==========================================
async function cekRedamanHSAirpoWeb(oltConfig, mac) {
    // === TAMBAHKAN 4 BARIS INI UNTUK DEBUG ===
    console.log('=========================================');
    console.log('🔍 [DEBUG CIBAROLA] MAC Mentah dari Bot:', mac);
    const cleanMac = mac.replace(/[:.\-]/g, '').toLowerCase();
    const targetMac = cleanMac.match(/.{1,4}/g)?.join('.') || cleanMac;
    console.log('⌨️ [DEBUG CIBAROLA] MAC yang akan diketik ke OLT:', targetMac);
    console.log('=========================================');
    // ================================================

    const browser = await puppeteer.launch({
        headless: 'new',
        defaultViewport: { width: 1280, height: 720 },
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    const baseUrl = `http://${oltConfig.ip}:${oltConfig.port}`;

    try {
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000));

        const inputs = await page.$$('input');
        if (inputs.length >= 2) {
            await inputs[0].click({ clickCount: 3 }); await inputs[0].type(oltConfig.user || 'admin');
            await inputs[1].click({ clickCount: 3 }); await inputs[1].type(oltConfig.pass || 'admin');
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

        await page.goto(`${baseUrl}/index.html#/pon/onu/optical`, { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000)); 

        const possibleSelectors = ['input[placeholder*="MAC" i]', 'input[placeholder*="mac" i]', 'input[placeholder*="ONU" i]', '.el-input__inner'];
        let searchInput = null;
        let usedSelector = '';
        
        for (const selector of possibleSelectors) {
            try {
                searchInput = await page.waitForSelector(selector, { timeout: 5000 });
                usedSelector = selector;
                break;
            } catch (e) {}
        }
        if (!searchInput) throw new Error('Kolom pencarian MAC tidak ditemukan.');

        let rxPowerResult = null;
        const totalPonPorts = oltConfig.total_pon || 4;

        for (let i = 1; i <= totalPonPorts; i++) {
            const currentPon = `pon${i}`;

            await page.evaluate(() => {
                const dropdownInput = document.querySelector('.el-input__inner') || document.querySelector('input[readonly]');
                if (dropdownInput) dropdownInput.click();
            });
            await new Promise(r => setTimeout(r, 800));

            await page.evaluate((ponName) => {
                const items = Array.from(document.querySelectorAll('.el-select-dropdown__item, li'));
                const targetItem = items.find(el => el.innerText.trim().toLowerCase() === ponName);
                if (targetItem) targetItem.click();
            }, currentPon);
            await new Promise(r => setTimeout(r, 500));

            await page.$eval(usedSelector, el => el.value = '');
            // KETIK MAC FULL YANG SUDAH DI-FORMAT (contoh: a031.db00.dbf1)
            await page.type(usedSelector, targetMac); 

            await page.evaluate(() => {
                const searchIcon = document.querySelector('input[placeholder*="MAC" i]')?.nextElementSibling;
                if (searchIcon) searchIcon.click();
                else {
                    const btns = Array.from(document.querySelectorAll('button, i, span'));
                    const searchBtn = btns.find(b => b.className && b.className.includes('search'));
                    if (searchBtn) searchBtn.click();
                }
            });
            await new Promise(r => setTimeout(r, 2500));

            rxPowerResult = await page.evaluate((macToFind) => {
                const cleanTarget = macToFind.replace(/[:.-]/g, '').toLowerCase();
                for (let row of Array.from(document.querySelectorAll('table tr'))) {
                    if (row.innerText.replace(/[:.-]/g, '').toLowerCase().includes(cleanTarget)) {
                        const cells = Array.from(row.querySelectorAll('td'));
                        if (cells.length >= 6) {
                            const val = cells[5].innerText.trim();
                            if (val && val !== '-') return val;
                        }
                    }
                }
                return null;
            }, targetMac);

            if (rxPowerResult) break;
        }

        return rxPowerResult ? { olt_name: oltConfig.label, mac_onu: targetMac, redaman: `${rxPowerResult} dBm`, status: 'Online' } : null;
    } catch (error) {
        return { error: `Gagal: ${error.message}` };
    } finally {
        await browser.close();
    }
}

// ==========================================
// 3. Hioso (Cibarola, Perum, Sukamelang)
// ATURAN: Hapus 1 karakter terakhir (panjang 16)
// ==========================================
async function cekRedamanHioso(oltConfig, mac) {
    // POTONG 1 KARAKTER TERAKHIR (Panjang 16)
    const searchMac = mac.substring(0, 16);

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

        // Cari di tabel menggunakan searchMac yang sudah dipotong 1 karakter
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
            hasil = olt.method === 'puppeteer' ? await cekRedamanHSAirpoWeb(olt, mac) : await cekRedamanHSAirpoAPI(olt, mac);
        } else if (olt.type === 'Hioso') {
            hasil = await cekRedamanHioso(olt, mac);
        }

        if (hasil && hasil.error) {
            hasilAkhir += `\n❌ *${olt.label}*: ${hasil.error}`;
        } else if (hasil) {
            hasilAkhir += `\n✅ *${hasil.olt_name}*\n   📉 Redaman: *${hasil.redaman}*\n   📡 Status: ${hasil.status}`;
        }
    }
    return hasilAkhir || '⚠️ ONU tidak ditemukan di OLT manapun pada cabang ini.';
}

module.exports = { scanSemuaOlt };
