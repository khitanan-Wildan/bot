// oltService.js
const puppeteer = require('puppeteer');
const axios = require('axios');

// Argumen Puppeteer standar agar hemat RAM di VPS / Railway
const puppeteerArgs = {
    headless: 'new',
    defaultViewport: null,
    args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage', 
        '--disable-gpu',
        '--disable-web-security'
    ]
};

/** 1. OLT HIOSO 4 PON (Sukamelang / Perum) */
async function cekHioso4Pon(baseUrl, targetMac) {
    const browser = await puppeteer.launch(puppeteerArgs);
    try {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'networkidle2' });

        const isLoginPage = await page.$('#a');
        if (isLoginPage) {
            await page.type('#a', 'admin');
            await page.type('#b', 'admin');
            await page.click('input[type="button"]');
            await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
        }

        await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { waitUntil: 'networkidle2' });
        
        let targetFrame = page;
        const frames = page.frames();
        if (frames.length > 1) {
            targetFrame = frames.find(f => f.url().includes('onu')) || frames[1];
        }

        await targetFrame.waitForSelector('table', { timeout: 10000 });

        return await targetFrame.evaluate((macToFind) => {
            const cleanTarget = macToFind.replace(/[:-]/g, '').toLowerCase();
            const rows = Array.from(document.querySelectorAll('table tr'));
            
            for (let row of rows) {
                const rowText = row.innerText.replace(/[:-]/g, '').toLowerCase();
                if (rowText.includes(cleanTarget)) {
                    const cleanRowText = row.innerText.replace(/\s+/g, ' ').trim();
                    const rxPattern = /\s(-\d+\.\d+)\s/;
                    const match = cleanRowText.match(rxPattern);
                    return match ? match[1] : null;
                }
            }
            return null;
        }, targetMac);
    } catch (e) { return null; } 
    finally { await browser.close(); }
}

/** 2. OLT HIOSO 8 PON / Cibarola (Bypass Login 2x & Bypass Pagination) */
async function cekHioso8Pon(baseUrl, targetMac) {
    const browser = await puppeteer.launch(puppeteerArgs);
    try {
        const page = await browser.newPage();
        await page.authenticate({ username: 'admin', password: 'admin' });
        await page.goto(baseUrl, { waitUntil: 'networkidle2' });

        for (let i = 0; i < 2; i++) {
            const isLoginPage = await page.$('#a');
            if (isLoginPage) {
                await page.type('#a', 'admin');
                await page.type('#b', 'admin');
                await page.click('input[type="button"]');
                await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        const leftFrame = page.frames().find(f => f.name() === 'leftFrame');
        if (!leftFrame) return null;

        await leftFrame.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const allOnuLink = links.find(link => link.innerText.trim() === 'All ONU');
            if (allOnuLink) allOnuLink.click();
        });

        await new Promise(r => setTimeout(r, 3000));
        const mainFrame = page.frames().find(f => f.name() === 'mainFrame');
        if (!mainFrame) return null;

        await mainFrame.evaluate(() => {
            if (typeof setNumPerPage === 'function') setNumPerPage(300);
            else if (typeof OnPageSizeChange === 'function') OnPageSizeChange(300);
        });

        await new Promise(r => setTimeout(r, 4000));

        return await mainFrame.evaluate((macToFind) => {
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
        }, targetMac);
    } catch (e) { return null; } 
    finally { await browser.close(); }
}

/** 3. OLT ISO HSAIRPO API AXIOS (Sukamelang / Panglejar) */
async function cekHsairpoApi(baseUrl, token, targetMac) {
    try {
        const response = await axios.get(`${baseUrl}/onu_allow_list?port_id=1`, {
            headers: { 'x-token': token },
            timeout: 7000
        });
        const onuList = response.data.data || [];
        const cleanTarget = targetMac.toLowerCase().replace(/[:.-]/g, '');

        const found = onuList.find(x => {
            const cleanOnuMac = x.macaddr.toLowerCase().replace(/[:.-]/g, '');
            return cleanOnuMac.startsWith(cleanTarget.substring(0, 10));
        });

        if (found) {
            return found.rxpower ? `${found.rxpower} dBm` : 'Terdeteksi (Rx N/A)';
        }
        return null;
    } catch (e) { return null; }
}

/** 4. OLT HSAIRPO WEB LOOPING PORT PON (Cibarola) */
async function cekHsairpoWebLoop(baseUrl, targetMac) {
    const browser = await puppeteer.launch(puppeteerArgs);
    try {
        const page = await browser.newPage();
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 2000));

        const inputs = await page.$$('input');
        if (inputs.length >= 2) {
            await inputs[0].click({ clickCount: 3 });
            await inputs[0].type('admin');
            await inputs[1].click({ clickCount: 3 });
            await inputs[1].type('admin');

            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, input[type="button"]'));
                const loginBtn = buttons.find(b => {
                    const txt = (b.innerText || b.value || '').toLowerCase().trim();
                    return txt.includes('log') || txt.includes('sign') || txt === '确定';
                });
                if (loginBtn) loginBtn.click();
            });
            await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
        }

        await new Promise(r => setTimeout(r, 2000));
        await page.goto(`${baseUrl}/index.html#/pon/onu/optical`, { waitUntil: 'networkidle2' });
        
        const searchInputSelector = 'input[placeholder*="MAC"]';
        await page.waitForSelector(searchInputSelector, { timeout: 10000 });

        let rxPowerResult = null;
        const totalPonPorts = 4;

        for (let i = 1; i <= totalPonPorts; i++) {
            const currentPon = `pon${i}`;

            await page.evaluate(() => {
                const dropdownInput = document.querySelector('.el-input__inner') || document.querySelector('input[readonly]');
                if (dropdownInput) dropdownInput.click();
            });
            await new Promise(r => setTimeout(r, 500));

            const ponSelected = await page.evaluate((ponName) => {
                const items = Array.from(document.querySelectorAll('.el-select-dropdown__item, li'));
                const targetItem = items.find(el => el.innerText.trim().toLowerCase() === ponName);
                if (targetItem) {
                    targetItem.click();
                    return true;
                }
                return false;
            }, currentPon);

            if (!ponSelected) continue;
            await new Promise(r => setTimeout(r, 500));

            await page.$eval(searchInputSelector, el => el.value = ''); 
            await page.type(searchInputSelector, targetMac);

            await page.evaluate(() => {
                const searchIcon = document.querySelector('input[placeholder*="MAC"]').nextElementSibling;
                if (searchIcon) searchIcon.click();
            });

            await new Promise(r => setTimeout(r, 1500));

            rxPowerResult = await page.evaluate((macToFind) => {
                const cleanTarget = macToFind.replace(/[:.-]/g, '').toLowerCase();
                const rows = Array.from(document.querySelectorAll('table tr'));
                for (let row of rows) {
                    const cleanRowText = row.innerText.replace(/[:.-]/g, '').toLowerCase();
                    if (cleanRowText.includes(cleanTarget)) {
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

        return rxPowerResult;
    } catch (e) { return null; } 
    finally { await browser.close(); }
}

/** ENGINE RUNNER SCANNER OLT */
async function scanSemuaOlt(olts, targetMac) {
    if (!olts || olts.length === 0) return "\n⚠️ Data OLT belum terkonfigurasi di cabang ini.";
    
    let laporanOlt = "\n📊 *HASIL MONITORING OLT:*";
    let ditemukanSamaSekali = false;

    for (const olt of olts) {
        let hasil = null;
        
        if (olt.merk === 'hioso_web') {
            hasil = await cekHioso4Pon(olt.url, targetMac);
        } else if (olt.merk === 'hioso_web_2x') {
            hasil = await cekHioso8Pon(olt.url, targetMac);
        } else if (olt.merk === 'hsairpo_api') {
            hasil = await cekHsairpoApi(olt.url, olt.token, targetMac);
        } else if (olt.merk === 'hsairpo_web_loop') {
            hasil = await cekHsairpoWebLoop(olt.url, targetMac);
        }

        if (hasil && hasil !== 'Tidak Terdeteksi') {
            laporanOlt += `\n✅ *[${olt.id.toUpperCase()}]* Redaman: *${hasil}*`;
            ditemukanSamaSekali = true;
        } else {
            laporanOlt += `\n❌ *[${olt.id.toUpperCase()}]* Tidak Ditemukan / Offline`;
        }
    }
    return laporanOlt;
}

module.exports = { scanSemuaOlt };
