// oltService.js
const axios = require('axios');
const crypto = require('crypto');

// ==========================================
// 1. FUNGSI AUTO-LOGIN HSairpo
// ==========================================
async function getHSAirpoToken(oltConfig) {
    const username = oltConfig.user || 'root';
    const password = oltConfig.pass || 'admin';

    // 1. Generate 'key' (MD5 dari "username:password")
    const keyString = `${username}:${password}`;
    const key = crypto.createHash('md5').update(keyString).digest('hex');

    // 2. Generate 'value' (Base64 dari password)
    const value = Buffer.from(password).toString('base64');

    // 3. Susun payload login
    const payload = {
        method: "set",
        param: {
            name: username,
            key: key,
            value: value,
            captcha_v: "",
            captcha_f: ""
        }
    };

    // 4. Tembak endpoint login
    const url = `http://${oltConfig.ip}:${oltConfig.port}/userlogin?form=login`;
    const response = await axios.post(url, payload, {
        headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'x-token': 'null'
        },
        timeout: 10000
    });

    // 5. Cek apakah login sukses (code === 1)
    if (response.data.code === 1) {
        const newToken = response.headers['x-token'];
        if (newToken) {
            return newToken;
        } else {
            throw new Error('Login sukses tapi header x-token tidak ditemukan.');
        }
    } else {
        throw new Error(`Login gagal: (${response.data.code}) ${response.data.message}`);
    }
}

// ==========================================
// 2. FUNGSI CEK REDAMAN HSairpo
// ==========================================
async function cekRedamanHSAirpo(oltConfig, mac) {
    try {
        // 1. Login otomatis untuk dapat token segar
        const token = await getHSAirpoToken(oltConfig);

        // 2. Scan port 1 sampai 16 untuk mencari MAC address
        for (let port = 1; port <= 16; port++) {
            const url = `http://${oltConfig.ip}:${oltConfig.port}/onu_allow_list?port_id=${port}`;
            
            const response = await axios.get(url, {
                headers: { 'x-token': token },
                timeout: 5000
            });

            const onuList = response.data.data || [];
            
            // Cari MAC Address
            const found = onuList.find(x => {
                const macAddr = x.macaddr || x.mac || '';
                return macAddr.toLowerCase().startsWith(mac.toLowerCase());
            });

            // Jika ONU ditemukan di port ini!
            if (found) {
                // ✅ AMBIL NILAI REDAMAN DARI KEY "receive_power"
                let redaman = found.receive_power || 'N/A';
                
                // Tambahkan satuan dBm jika belum ada
                if (redaman !== 'N/A' && !String(redaman).toLowerCase().includes('dbm')) {
                    redaman = `${redaman} dBm`;
                }

                return {
                    olt_name: `${oltConfig.label} (Port PON ${port})`,
                    mac_onu: found.macaddr,
                    redaman: redaman,
                    status: found.status || 'Online',
                    dev_type: found.dev_type || 'Unknown'
                };
            }
        }

        // Jika loop selesai dan tidak ada yang cocok di semua port
        return null; 

    } catch (error) {
        console.error(`[ERROR HSairpo ${oltConfig.label}]:`, error.message);
        return { error: `Gagal koneksi: ${error.message}` };
    }
}

// ==========================================
// 3. FUNGSI SCAN SEMUA OLT (Looping ke semua OLT di config)
// ==========================================
async function scanSemuaOlt(oltList, mac) {
    let hasilAkhir = '';
    
    for (const olt of oltList) {
        let hasil = null;
        
        // Panggil fungsi yang sesuai berdasarkan tipe OLT
        if (olt.type === 'HSAirpo') {
            hasil = await cekRedamanHSAirpo(olt, mac);
        } 
        // else if (olt.type === 'ZTE') {
        //     hasil = await cekRedamanZTE(olt, mac);
        // } 
        // else if (olt.type === 'Huawei') {
        //     hasil = await cekRedamanHuawei(olt, mac);
        // }

        // Format output untuk WhatsApp
        if (hasil && hasil.error) {
            hasilAkhir += `\n❌ *${olt.label}*: ${hasil.error}`;
        } else if (hasil) {
            hasilAkhir += `\n✅ *${hasil.olt_name}*` +
                          `\n   📉 Redaman: *${hasil.redaman}*` +
                          `\n   📡 Status: ${hasil.status}` +
                          `\n   📦 Tipe: ${hasil.dev_type}`;
        }
    }
    
    return hasilAkhir || '⚠️ ONU tidak ditemukan di OLT manapun pada cabang ini.';
}

module.exports = { scanSemuaOlt };
