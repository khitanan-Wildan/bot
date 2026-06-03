// index.js - RnBNET BOT (Public Access Version)
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
// 3. EVENT LISTENER WHATSAPP
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
});

// Auto-reconnect jika terputus
client.on('disconnected', (reason) => {
    console.warn('⚠️  BOT DISCONNECTED! Reason:', reason);
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
// 4. HELPER: KONEKSI MIKROTIK
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
        timeout: config.defaultMikrotik.timeout
    };

    const api = new RouterOSAPI(mtConfig);
    await api.connect();
    
    return { api, targetServer };
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
// 5. MESSAGE HANDLER (PUBLIC ACCESS - SEMUA BISA PAKAI)
// ==========================================
client.on('message_create', async (msg) => {
    try {
        const text = msg.body.trim();
        const args = text.split(/\s+/);
        const command = args[0]?.toLowerCase();

        // ==========================================
        // PERINTAH PUBLIK
        // ==========================================
        if (command === 'ping') {
            await msg.reply('pong 🏓');
            return;
        }

        if (command === '!menu') {
            await msg.reply(
                `📡 *RnBNET BOT HIGH SPEED*\n\n` +
                `🔍 *PERINTAH CEK REDAMAN:*\n` +
                `Format: \`!cek [nama_mikrotik] [username]\`\n` +
                `Contoh: \`!cek sukamelang budi\`\n\n` +
                `⚡ *PERINTAH AKTIVASI:*\n` +
                `Format: \`!aktifkan [nama_mikrotik] [username]\`\n` +
                `Contoh: \`!aktifkan sukamelang budi\`\n\n` +
                `📍 *PILIHAN MIKROTIK:*\n` +
                `• panglejar\n• perum\n• cibarola\n• sukamelang`
            );
            return;
        }

        // ==========================================
        // PERINTAH !CEK & !AKTIFKAN (BEBAS DIAKSES)
        // ==========================================
        if (['!cek', '!aktifkan'].includes(command)) {
            // Validasi format
            if (args.length < 3) {
                await msg.reply(`❌ *Format Salah*\n\nGunakan: \`${command} [nama_mikrotik] [username]\`\n\nContoh: \`${command} sukamelang budi\``);
                return;
            }

            const serverKey = args[1].toLowerCase();
            const username = args[2];

            // Validasi server
            if (!config.servers[serverKey]) {
                const serverList = Object.keys(config.servers).join(', ');
                await msg.reply(`❌ *Nama MikroTik Salah!*\n\nPilihan yang tersedia:\n• ${serverList}`);
                return;
            }

            // Eksekusi perintah
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
// 6. HANDLER: CEK REDAMAN
// ==========================================
async function handleCekRedaman(msg, serverKey, username) {
    const { api, targetServer } = await connectMikrotik(serverKey);

    try {
        await msg.reply(`🔍 Mencari user *${username}* di MikroTik *${targetServer.label}*...`);

        // Ambil data user
        const userObj = await getUserFromMikrotik(api, username);
        
        // Ambil MAC address (prioritas dari active user)
        let rawMac = userObj['caller-id'] || 'Any';
        const activeUser = await getActiveUserFromMikrotik(api, username);
        
        if (activeUser) {
            rawMac = activeUser['caller-id'] || rawMac;
        }

        if (!rawMac || rawMac === 'Any') {
            await msg.reply(`⚠️ *MAC Address tidak terbaca*\n\nUser "${username}" ditemukan, tetapi MAC address tidak tersedia.\nPastikan user sedang online atau MAC sudah terdaftar.`);
            return;
        }

        // Format MAC (sesuai kebutuhan OLT)
        const mac = rawMac.trim().toLowerCase().substring(0, 16);
        await msg.reply(`📡 *MAC Ditemukan:*\n\`${mac}\`\n\n_Menyisir OLT di cabang ${targetServer.label}..._`);

        // Scan semua OLT
        const hasilOlt = await scanSemuaOlt(targetServer.olts, mac);
        
        await msg.reply(
            `📊 *Hasil Cek Redaman OLT*\n\n` +
            `👤 *Pelanggan:* ${username}\n` +
            `💻 *Server:* ${targetServer.label}\n` +
            `🔒 *MAC OLT:* \`${mac}\`\n\n` +
            `${hasilOlt}`
        );

    } catch (err) {
        console.error('Error handleCekRedaman:', err);
        await msg.reply(`❌ *Gagal Cek Redaman*\n\n${err.message}`);
    } finally {
        // Pastikan koneksi selalu ditutup
        try { await api.close(); } catch (e) { /* ignore */ }
    }
}

// ==========================================
// 7. HANDLER: AKTIVASI (OPEN ISOLIR)
// ==========================================
async function handleAktivasi(msg, serverKey, username) {
    const { api, targetServer } = await connectMikrotik(serverKey);

    try {
        await msg.reply(`⏳ *Memproses Open Isolir*\n\n👤 User: ${username}\n💻 Server: ${targetServer.label}\n\n_Mohon tunggu..._`);

        // Ambil data user
        const userObj = await getUserFromMikrotik(api, username);

        // Nyalakan secret PPPoE (Open Isolir)
        await api.write([
            '/ppp/secret/set',
            `=.id=${userObj['.id']}`,
            '=disabled=no'
        ]);

        // Tunggu 2 detik agar user reconnect
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Ambil data terbaru setelah aktivasi
        const activeUser = await getActiveUserFromMikrotik(api, username);

        let ip = userObj['remote-address'] || 'Dynamic';
        let rawMac = userObj['caller-id'] || 'Any';
        const paket = userObj.profile || 'default';

        if (activeUser) {
            ip = activeUser.address || ip;
            rawMac = activeUser['caller-id'] || rawMac;
        }

        // Susun laporan
        let reportMessage = 
            `✨ *RnB Network - Aktivasi Sukses*\n\n` +
            `✅ *Status:* BERHASIL\n` +
            `👤 *Pelanggan:* ${username}\n` +
            `🛜 *Paket:* ${paket}\n` +
            `💻 *Server:* ${targetServer.label}\n` +
            `🌐 *IP:* ${ip}\n` +
            `🔒 *MAC Asli:* \`${rawMac}\`\n`;

        // Jika MAC terbaca, lanjut cek OLT
        if (rawMac && rawMac !== 'Any') {
            const mac = rawMac.trim().toLowerCase().substring(0, 16);
            reportMessage += `✂️ *MAC OLT:* \`${mac}\`\n\n🔍 _Menyisir OLT otomatis..._`;

            await msg.reply(reportMessage);

            // Scan OLT
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
        // Pastikan koneksi selalu ditutup
        try { await api.close(); } catch (e) { /* ignore */ }
    }
}

// ==========================================
// 8. ERROR HANDLING GLOBAL
// ==========================================
process.on('unhandledRejection', (err) => {
    console.error('❌ UNHANDLED REJECTION:', err);
});

process.on('uncaughtException', (err) => {
    console.error('❌ UNCAUGHT EXCEPTION:', err);
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await client.destroy();
    process.exit(0);
});

// ==========================================
// 9. INITIALIZE BOT
// ==========================================
client.initialize().catch(err => {
    console.error('❌ Gagal initialize bot:', err);
});
