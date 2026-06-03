// index.js - RnBNET BOT (Final Fix: Anti-LID WhatsApp)
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const RouterOSAPI = require('node-routeros').RouterOSAPI;

// Import Konfigurasi & Service
const config = require('./config');
const { scanSemuaOlt } = require('./oltService');

// ==========================================
// 1. WEB SERVER
// ==========================================
const app = express();
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(` WEB SERVER RUNNING ON PORT ${PORT}`));

// ==========================================
// 2. WHATSAPP CLIENT
// ==========================================
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'rnbnet', dataPath: './session' }),
    puppeteer: {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,720'],
        timeout: 180000
    }
});

// ==========================================
// 3. WHITELIST ADMIN
// ==========================================
const ADMIN_NUMBERS = [
    '6283873625928',
    '6283841418696',
    '6289526607288',
    '6287842861656'
];

// Fungsi normalisasi nomor (menghapus karakter aneh, memastikan awalan 62)
function normalizeNumber(num) {
    if (!num) return null;
    let cleaned = num.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '62' + cleaned.substring(1);
    if (!cleaned.startsWith('62')) cleaned = '62' + cleaned;
    return cleaned;
}

// FUNGSI ADMIN CHECK PINTAR (Bisa handle @lid)
async function isAdmin(msg) {
    let rawId = msg.from;
    
    // Jika di grup, ambil dari author
    if (msg.isGroup && msg.author) {
        rawId = msg.author;
    }

    //  FIX UTAMA: Jika ID berakhiran @lid, kita resolve ke nomor asli
    if (rawId.endsWith('@lid')) {
        try {
            const contact = await client.getContactById(rawId);
            if (contact && contact.number) {
                // Ganti ID lid dengan nomor asli + @c.us
                rawId = contact.number + '@c.us'; 
            }
        } catch (err) {
            console.error(`⚠️ Gagal resolve LID ${rawId}: ${err.message}`);
        }
    }

    // Ambil nomor murni (hapus @c.us atau @lid)
    const actualNumber = rawId.split('@')[0];
    const normalized = normalizeNumber(actualNumber);

    console.log(`📱 [ADMIN CHECK] Raw ID: ${msg.from} | Resolved Number: ${normalized}`);

    return ADMIN_NUMBERS.includes(normalized);
}

// ==========================================
// 4. EVENT LISTENER
// ==========================================
console.log(' BOT STARTING...');
client.on('qr', async (qr) => {
    await qrcode.toFile(path.join(__dirname, 'qr.png'), qr);
    console.log('📱 SCAN QR CODE -> qr.png');
});
client.on('authenticated', () => console.log('✅ AUTH SUCCESS'));
client.on('ready', () => {
    console.log('🚀 BOT READY FOR RnBNET!');
    console.log(`👥 Admin terdaftar: ${ADMIN_NUMBERS.length} nomor`);
});
client.on('disconnected', (reason) => {
    console.warn('⚠️ BOT DISCONNECTED:', reason);
    setTimeout(() => client.initialize().catch(console.error), 5000);
});

// ==========================================
// 5. HELPER MIKROTIK
// ==========================================
async function connectMikrotik(serverKey) {
    const targetServer = config.servers[serverKey];
    if (!targetServer) throw new Error(`Server "${serverKey}" tidak ditemukan`);
    
    const api = new RouterOSAPI({
        host: targetServer.mikrotik.host,
        port: targetServer.mikrotik.port,
        user: targetServer.mikrotik.user,
        password: targetServer.mikrotik.pass,
        timeout: 15
    });
    
    try {
        await api.connect();
        return { api, targetServer };
    } catch (err) {
        throw new Error(`Gagal konek MikroTik ${targetServer.label}. Cek port API.`);
    }
}

async function getUserFromMikrotik(api, username) {
    const secrets = await api.write('/ppp/secret/print');
    const userObj = secrets.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());
    if (!userObj) throw new Error(`User "${username}" tidak ditemukan`);
    return userObj;
}

async function getActiveUserFromMikrotik(api, username) {
    const activeUsers = await api.write('/ppp/active/print');
    return activeUsers.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());
}

// ==========================================
// 6. MESSAGE HANDLER
// ==========================================
client.on('message_create', async (msg) => {
    try {
        const text = msg.body.trim();
        const args = text.split(/\s+/);
        const command = args[0]?.toLowerCase();

        // Perintah Publik
        if (command === 'ping') { await msg.reply('pong 🏓'); return; }
        if (command === '!menu') {
            await msg.reply(`📡 *RnBNET BOT HIGH SPEED*\n\n🔍 *CEK:* \`!cek [mikrotik] [username]\`\n *AKTIFKAN:* \`!aktifkan [mikrotik] [username]\`\n\n📍 panglejar, perum, cibarola, sukamelang`);
            return;
        }

        // Perintah Admin (Cek, Aktifkan)
        if (['!cek', '!aktifkan'].includes(command)) {
            
            // 🔑 PENTING: await isAdmin karena harus fetch data dari WhatsApp
            if (!await isAdmin(msg)) {
                await msg.reply(` *Akses Ditolak*\n\nNomor Anda tidak terdaftar.\n_Hubungi admin RnBNET._`);
                return;
            }

            if (args.length < 3) {
                await msg.reply(`❌ Format salah!\nGunakan: \`${command} [mikrotik] [username]\``);
                return;
            }

            const serverKey = args[1].toLowerCase();
            const username = args[2];

            if (!config.servers[serverKey]) {
                await msg.reply(`❌ Server tidak ditemukan.\nPilihan: ${Object.keys(config.servers).join(', ')}`);
                return;
            }

            if (command === '!cek') await handleCekRedaman(msg, serverKey, username);
            else if (command === '!aktifkan') await handleAktivasi(msg, serverKey, username);
        }

    } catch (err) {
        console.error('Handler Error:', err);
        try { await msg.reply(`❌ Error: ${err.message}`); } catch (e) {}
    }
});

// ==========================================
// 7. HANDLER CEK REDAMAN
// ==========================================
async function handleCekRedaman(msg, serverKey, username) {
    let api;
    try {
        const { api: mikrotikApi, targetServer } = await connectMikrotik(serverKey);
        api = mikrotikApi;

        await msg.reply(`🔍 Mencari *${username}* di *${targetServer.label}*...`);
        const userObj = await getUserFromMikrotik(api, username);
        
        let rawMac = userObj['caller-id'] || 'Any';
        const activeUser = await getActiveUserFromMikrotik(api, username);
        if (activeUser) rawMac = activeUser['caller-id'] || rawMac;

        if (!rawMac || rawMac === 'Any') {
            await msg.reply(`⚠️ MAC Address tidak terbaca.`);
            return;
        }

        const mac = rawMac.trim().toLowerCase();
        await msg.reply(`📡 MAC: \`${mac}\`\n_Menyisir OLT..._`);

        const hasilOlt = await scanSemuaOlt(targetServer.olts, mac);
        await msg.reply(`📊 *Hasil Cek Redaman*\n\n👤 ${username}\n💻 ${targetServer.label}\n🔒 MAC: \`${mac}\`\n\n${hasilOlt}`);

    } catch (err) {
        await msg.reply(`❌ Gagal: ${err.message}`);
    } finally {
        try { if (api) await api.close(); } catch (e) {}
    }
}

// ==========================================
// 8. HANDLER AKTIVASI
// ==========================================
async function handleAktivasi(msg, serverKey, username) {
    let api;
    try {
        const { api: mikrotikApi, targetServer } = await connectMikrotik(serverKey);
        api = mikrotikApi;

        await msg.reply(`⏳ *Open Isolir*\n👤 ${username} | 💻 ${targetServer.label}\n_Mohon tunggu..._`);
        
        const userObj = await getUserFromMikrotik(api, username);
        await api.write(['/ppp/secret/set', `=.id=${userObj['.id']}`, '=disabled=no']);
        await new Promise(r => setTimeout(r, 2000));

        const activeUser = await getActiveUserFromMikrotik(api, username);
        let ip = userObj['remote-address'] || 'Dynamic';
        let rawMac = userObj['caller-id'] || 'Any';
        const paket = userObj.profile || 'default';

        if (activeUser) {
            ip = activeUser.address || ip;
            rawMac = activeUser['caller-id'] || rawMac;
        }

        let report = `✨ *Aktivasi Sukses*\n\n✅ Status: BERHASIL\n👤 ${username}\n🛜 ${paket}\n💻 ${targetServer.label}\n🌐 ${ip}\n🔒 MAC: \`${rawMac}\`\n`;

        if (rawMac && rawMac !== 'Any') {
            const mac = rawMac.trim().toLowerCase();
            report += `✂️ MAC OLT: \`${mac}\`\n\n🔍 _Menyisir OLT..._`;
            await msg.reply(report);
            
            const hasilOlt = await scanSemuaOlt(targetServer.olts, mac);
            await msg.reply(`✨ *Final Report*\n\n👤 ${username}\n ${targetServer.label}\n🔒 MAC: \`${mac}\`\n\n${hasilOlt}`);
        } else {
            report += `\n⚠️ _Cek OLT dilewati._`;
            await msg.reply(report);
        }
    } catch (err) {
        await msg.reply(`❌ Gagal: ${err.message}`);
    } finally {
        try { if (api) await api.close(); } catch (e) {}
    }
}

// ==========================================
// 9. ERROR HANDLING
// ==========================================
process.on('unhandledRejection', err => console.error('❌ UNHANDLED:', err));
process.on('uncaughtException', err => {
    if (err.name === 'RosException' && err.message.includes('Timed out')) return;
    console.error('❌ UNCAUGHT:', err);
});

client.initialize().catch(console.error);
