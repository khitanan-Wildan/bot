// index.js - RnBNET BOT (Final with Admin Whitelist)
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const RouterOSAPI = require('node-routeros').RouterOSAPI;

// Import Konfigurasi & Service
const config = require('./config');
const { scanSemuaOlt } = require('./oltService');

// ==========================================
// 1. WEB SERVER (Untuk menampilkan QR Code)
// ==========================================
const app = express();
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🌐 WEB SERVER RUNNING ON PORT ${PORT}`);
});

// ==========================================
// 2. WHATSAPP CLIENT SETUP
// ==========================================
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'rnbnet',
        dataPath: './session'
    }),
    puppeteer: {
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-web-security',
            '--window-size=1280,720',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-extensions'
        ],
        timeout: 180000
    }
});

// ==========================================
// 3. KEAMANAN: DAFTAR NOMOR ADMIN (WHITELIST)
// ==========================================
// Format: 62xxxxxxxxxx@c.us (tanpa + atau 0 di depan)
const ADMIN_NUMBERS = [
    '6283873625928@c.us',
    '6283841418696@c.us',
    '6289526607288@c.us',
    '6287842861656@c.us'
];

function isAdmin(number) {
    return ADMIN_NUMBERS.includes(number);
}

// ==========================================
// 4. EVENT LISTENER WHATSAPP
// ==========================================
console.log('🤖 BOT STARTING...');

client.on('qr', async (qr) => {
    try {
        await qrcode.toFile(path.join(__dirname, 'qr.png'), qr);
        console.log('================================');
        console.log('📱 SCAN QR CODE -> qr.png');
        console.log('================================');
    } catch (err) {
        console.error('❌ Error generate QR:', err.message);
    }
});

client.on('authenticated', () => {
    console.log('✅ AUTH SUCCESS');
});

client.on('ready', () => {
    console.log('================================');
    console.log('🚀 BOT READY FOR RnBNET!');
    console.log('================================');
    console.log(`👥 Admin terdaftar: ${ADMIN_NUMBERS.length} nomor`);
    console.log('================================');
});

client.on('disconnected', (reason) => {
    console.warn('⚠️ BOT DISCONNECTED! Reason:', reason);
    console.log('🔄 Mencoba menyambung kembali dalam 5 detik...');
    setTimeout(() => {
        client.initialize().catch(err => {
            console.error('❌ Gagal reconnect:', err.message);
        });
    }, 5000);
});

client.on('auth_failure', (msg) => {
    console.error('❌ AUTH FAILURE:', msg);
});

// ==========================================
// 5. HELPER: KONEKSI MIKROTIK (ANTI CRASH)
// ==========================================
async function connectMikrotik(serverKey) {
    const targetServer = config.servers[serverKey];
    if (!targetServer) {
        throw new Error(`Server "${serverKey}" tidak ditemukan di config`);
    }

    const mtConfig = {
        host: targetServer.mikrotik.host,
        port: targetServer.mikrotik.port,
        user: targetServer.mikrotik.user || config.defaultMikrotik.user,
        password: targetServer.mikrotik.pass || config.defaultMikrotik.pass,
        timeout: config.defaultMikrotik.timeout || 15
    };

    const api = new RouterOSAPI(mtConfig);
    
    try {
        await api.connect();
        return { api, targetServer };
    } catch (err) {
        throw new Error(`Gagal konek ke MikroTik ${targetServer.label} (Port ${mtConfig.port}). Pastikan port API sudah diaktifkan.`);
    }
}

async function getUserFromMikrotik(api, username) {
    const secrets = await api.write('/ppp/secret/print');
    const userObj = secrets.find(x => 
        x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase()
    );
    
    if (!userObj) {
        throw new Error(`User "${username}" tidak ditemukan`);
    }
    
    return userObj;
}

async function getActiveUserFromMikrotik(api, username) {
    const activeUsers = await api.write('/ppp/active/print');
    return activeUsers.find(x => 
        x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase()
    );
}

// ==========================================
// 6. MESSAGE HANDLER
// ==========================================
client.on('message_create', async (msg) => {
    try {
        const text = msg.body.trim();
        const args = text.split(/\s+/);
        const command = args[0]?.toLowerCase();

        // PERINTAH PUBLIK (Bisa diakses semua orang)
        if (command === 'ping') {
            await msg.reply('pong 🏓');
            return;
        }

        if (command === '!menu') {
            await msg.reply(
                `📡 *RnBNET BOT HIGH SPEED*\n\n` +
                `🔍 *CEK REDAMAN:*\n\`!cek [mikrotik] [username]\`\n` +
                `⚡ *AKTIVASI:*\n\`!aktifkan [mikrotik] [username]\`\n\n` +
                `📍 *SERVER:* panglejar, perum, cibarola, sukamelang\n\n` +
                `⚠️ _Perintah !cek dan !aktifkan hanya untuk admin terdaftar_`
            );
            return;
        }

        // PERINTAH ADMIN (Hanya bisa diakses admin terdaftar)
        if (['!cek', '!aktifkan'].includes(command)) {
            // Cek whitelist admin
            if (!isAdmin(msg.from)) {
                await msg.reply(
                    `🚫 *Akses Ditolak*\n\n` +
                    `Anda tidak memiliki izin untuk menggunakan perintah ini.\n` +
                    `Hubungi Iyann RnB Net jika merasa ini kesalahan.`
                );
                return;
            }

            if (args.length < 3) {
                await msg.reply(`❌ *Format Salah*\n\nGunakan: \`${command} [mikrotik] [username]\`\nContoh: \`${command} cibarola liacahyani\``);
                return;
            }

            const serverKey = args[1].toLowerCase();
            const username = args[2];

            if (!config.servers[serverKey]) {
                const serverList = Object.keys(config.servers).join(', ');
                await msg.reply(`❌ *Nama MikroTik Salah!*\n\nPilihan yang tersedia:\n• ${serverList}`);
                return;
            }

            if (command === '!cek') {
                await handleCekRedaman(msg, serverKey, username);
            } else if (command === '!aktifkan') {
                await handleAktivasi(msg, serverKey, username);
            }
        }

    } catch (err) {
        console.error('❌ Error di message handler:', err);
        try {
            await msg.reply(`❌ *Terjadi Kesalahan*\n\n${err.message}`);
        } catch (e) {
            console.error('Gagal kirim error message:', e);
        }
    }
});

// ==========================================
// 7. HANDLER: CEK REDAMAN
// ==========================================
async function handleCekRedaman(msg, serverKey, username) {
    let api;
    try {
        const { api: mikrotikApi, targetServer } = await connectMikrotik(serverKey);
        api = mikrotikApi;

        await msg.reply(`🔍 Mencari user *${username}* di MikroTik *${targetServer.label}*...`);

        const userObj = await getUserFromMikrotik(api, username);
        
        let rawMac = userObj['caller-id'] || 'Any';
        const activeUser = await getActiveUserFromMikrotik(api, username);
        if (activeUser) {
            rawMac = activeUser['caller-id'] || rawMac;
        }

        if (!rawMac || rawMac === 'Any') {
            await msg.reply(`⚠️ *MAC Address tidak terbaca*\n\nUser "${username}" ditemukan, tetapi MAC address tidak tersedia.`);
            return;
        }

        // Kirim MAC mentah FULL TANPA dipotong
        const mac = rawMac.trim().toLowerCase();
        
        await msg.reply(`📡 *MAC Ditemukan:*\n\`${mac}\`\n\n_Menyisir OLT di cabang ${targetServer.label}..._`);

        const hasilOlt = await scanSemuaOlt(targetServer.olts, mac);
        
        await msg.reply(
            `📊 *Hasil Cek Redaman OLT*\n\n` +
            `👤 *Pelanggan:* ${username}\n` +
            `💻 *Server:* ${targetServer.label}\n` +
            `🔒 *MAC:* \`${mac}\`\n\n` +
            `${hasilOlt}`
        );

    } catch (err) {
        console.error('Error handleCekRedaman:', err);
        await msg.reply(`❌ *Gagal Cek Redaman*\n\n${err.message}`);
    } finally {
        try { if (api) await api.close(); } catch (e) { /* ignore */ }
    }
}

// ==========================================
// 8. HANDLER: AKTIVASI (OPEN ISOLIR)
// ==========================================
async function handleAktivasi(msg, serverKey, username) {
    let api;
    try {
        const { api: mikrotikApi, targetServer } = await connectMikrotik(serverKey);
        api = mikrotikApi;

        await msg.reply(`⏳ *Memproses Open Isolir*\n\n👤 User: ${username}\n💻 Server: ${targetServer.label}\n\n_Mohon tunggu..._`);

        const userObj = await getUserFromMikrotik(api, username);

        await api.write([
            '/ppp/secret/set',
            `=.id=${userObj['.id']}`,
            '=disabled=no'
        ]);

        await new Promise(resolve => setTimeout(resolve, 2000));

        const activeUser = await getActiveUserFromMikrotik(api, username);

        let ip = userObj['remote-address'] || 'Dynamic';
        let rawMac = userObj['caller-id'] || 'Any';
        const paket = userObj.profile || 'default';

        if (activeUser) {
            ip = activeUser.address || ip;
            rawMac = activeUser['caller-id'] || rawMac;
        }

        let reportMessage = 
            `✨ *RnB Network - Aktivasi Sukses*\n\n` +
            `✅ *Status:* BERHASIL\n` +
            `👤 *Pelanggan:* ${username}\n` +
            `🛜 *Paket:* ${paket}\n` +
            `💻 *Server:* ${targetServer.label}\n` +
            `🌐 *IP:* ${ip}\n` +
            `🔒 *MAC Asli:* \`${rawMac}\`\n`;

        if (rawMac && rawMac !== 'Any') {
            const mac = rawMac.trim().toLowerCase();
            reportMessage += `✂️ *MAC OLT:* \`${mac}\`\n\n🔍 _Menyisir OLT otomatis..._`;

            await msg.reply(reportMessage);

            const hasilOlt = await scanSemuaOlt(targetServer.olts, mac);
            
            await msg.reply(
                `✨ *RnB Network - Final Report*\n\n` +
                `👤 *Pelanggan:* ${username}\n` +
                `💻 *Server:* ${targetServer.label}\n` +
                `🔒 *MAC OLT:* \`${mac}\`\n\n` +
                `${hasilOlt}`
            );
        } else {
            reportMessage += `\n⚠️ _Pengecekan OLT dilewati karena MAC tidak terbaca._`;
            await msg.reply(reportMessage);
        }

    } catch (err) {
        console.error('Error handleAktivasi:', err);
        await msg.reply(`❌ *Gagal Aktivasi*\n\n${err.message}`);
    } finally {
        try { if (api) await api.close(); } catch (e) { /* ignore */ }
    }
}

// ==========================================
// 9. ERROR HANDLING GLOBAL (ANTI CRASH)
// ==========================================
process.on('unhandledRejection', (err) => {
    console.error('❌ UNHANDLED REJECTION:', err);
});

process.on('uncaughtException', (err) => {
    // Abaikan error timeout dari node-routeros
    if (err.name === 'RosException' && err.message.includes('Timed out')) {
        return; 
    }
    console.error('❌ UNCAUGHT EXCEPTION:', err);
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await client.destroy();
    process.exit(0);
});

// ==========================================
// 10. INITIALIZE BOT
// ==========================================
client.initialize().catch(err => {
    console.error('❌ Gagal initialize bot:', err);
});
