// index.js
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const RouterOSAPI = require('node-routeros').RouterOSAPI;

// Import File Konfigurasi & Service OLT
const config = require('./config');
const { scanSemuaOlt } = require('./oltService');

const app = express();
app.use(express.static(path.join(__dirname)));

app.listen(process.env.PORT || 8080, () => {
    console.log('WEB SERVER RUNNING ON PORT 8080');
});

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
            '--window-size=1280,720'
        ],
        timeout: 120000
    }
});

console.log('BOT STARTING...');

client.on('qr', async (qr) => {
    try {
        await qrcode.toFile(path.join(__dirname, 'qr.png'), qr);
        console.log('================================\nSCAN QR -> qr.png\n================================');
    } catch (err) { console.log(err); }
});

client.on('authenticated', () => console.log('AUTH SUCCESS'));
client.on('ready', () => console.log('================================\nBOT READY FOR RnBNET!\n================================'));

client.on('message_create', async (msg) => {
    try {
        const text = msg.body.trim();

        if (text.toLowerCase() === 'ping') {
            msg.reply('pong');
            return;
        }

        if (text === '!menu') {
            msg.reply(
                `📡 *RnBNET BOT HIGH SPEED*\n\n` +
                `🔍 *PERINTAH CEK REDAMAN:*\n` +
                `Format: !cek [nama_mikrotik] [username]\n` +
                `Contoh: !cek sukamelang budi\n\n` +
                `⚡ *PERINTAH AKTIVASI:*\n` +
                `Format: !aktifkan [nama_mikrotik] [username]\n` +
                `Contoh: !aktifkan sukamelang budi\n\n` +
                `📍 *PILIHAN MIKROTIK:* panglejar, perum, cibarola, sukamelang`
            );
            return;
        }

        // ==========================================
        // 1. PERINTAH CEK REDAMAN (TEMBAK LANGSUNG KE MIKROTIK TARGET)
        // ==========================================
        if (text.startsWith('!cek')) {
            const args = text.split(' ');
            if (args.length < 3) {
                msg.reply('❌ Format salah\n\nGunakan: !cek [nama_mikrotik] [username]');
                return;
            }

            const serverKey = args[1].toLowerCase();
            const username = args[2];

            const targetServer = config.servers[serverKey];
            if (!targetServer) {
                msg.reply('❌ Nama MikroTik salah!\nPilihan: panglejar, perum, cibarola, sukamelang');
                return;
            }

            msg.reply(`🔍 Langsung menuju MikroTik *${targetServer.label}* untuk ambil data "${username}"...`);

            const mtConfig = {
                host: targetServer.mikrotik.host,
                port: targetServer.mikrotik.port,
                user: targetServer.mikrotik.user || config.defaultMikrotik.user,
                password: targetServer.mikrotik.pass || config.defaultMikrotik.pass,
                timeout: config.defaultMikrotik.timeout
            };

            const api = new RouterOSAPI(mtConfig);

            try {
                await api.connect();
                const secrets = await api.write('/ppp/secret/print');
                const userObj = secrets.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());

                if (!userObj) {
                    msg.reply(`❌ User "${username}" tidak ditemukan di MikroTik ${targetServer.label}`);
                    await api.close();
                    return;
                }

                let rawMac = userObj['caller-id'] || 'Any';
                
                const activeUsers = await api.write('/ppp/active/print');
                const activeUser = activeUsers.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());
                if (activeUser) {
                    rawMac = activeUser['caller-id'] || rawMac;
                }
                await api.close();

                if (!rawMac || rawMac === 'Any') {
                    msg.reply(`⚠️ MAC Address untuk user "${username}" di MikroTik ${targetServer.label} tidak terbaca.`);
                    return;
                }

                // FORMAT SAKTI: Huruf kecil + potong 16 karakter (Sesuai testing CMD)
                const mac = rawMac.trim().toLowerCase().substring(0, 16);

                msg.reply(`📡 MAC Sukses Ditarik: *${mac}*\n_Sedang menyisir OLT di cabang ${targetServer.label}..._`);

                const hasilOlt = await scanSemuaOlt(targetServer.olts, mac);
                msg.reply(`📊 *Hasil Cek Redaman OLT*\n\n👤 Pelanggan: ${username}\n💻 Server: ${targetServer.label}\n🔒 MAC OLT: ${mac}\n${hasilOlt}`);

            } catch (err) {
                console.log(err);
                msg.reply(`❌ Gagal terhubung ke MikroTik ${targetServer.label}:\n${err.message}`);
                try { await api.close(); } catch (e) {}
            }
            return;
        }

        // ==========================================
        // 2. PERINTAH AKTIVASI (TEMBAK LANGSUNG KE MIKROTIK TARGET)
        // ==========================================
        if (text.startsWith('!aktifkan')) {
            const args = text.split(' ');
            if (args.length < 3) {
                msg.reply('❌ Format salah\n\nGunakan: !aktifkan [nama_mikrotik] [username]');
                return;
            }

            const serverKey = args[1].toLowerCase();
            const username = args[2];

            const targetServer = config.servers[serverKey];
            if (!targetServer) {
                msg.reply('❌ Nama MikroTik salah!\nPilihan: panglejar, perum, cibarola, sukamelang');
                return;
            }

            msg.reply(`⏳ Memproses Open Isolir "${username}" langsung di MikroTik *${targetServer.label}*...`);

            const mtConfig = {
                host: targetServer.mikrotik.host,
                port: targetServer.mikrotik.port,
                user: targetServer.mikrotik.user || config.defaultMikrotik.user,
                password: targetServer.mikrotik.pass || config.defaultMikrotik.pass,
                timeout: config.defaultMikrotik.timeout
            };

            const api = new RouterOSAPI(mtConfig);

            try {
                await api.connect();

                const secrets = await api.write('/ppp/secret/print');
                const userObj = secrets.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());

                if (!userObj) {
                    msg.reply(`❌ User "${username}" tidak ditemukan di MikroTik ${targetServer.label}`);
                    await api.close();
                    return;
                }

                // Nyalakan secret PPPoE
                await api.write([
                    '/ppp/secret/set',
                    `=.id=${userObj['.id']}`,
                    '=disabled=no'
                ]);

                await new Promise(resolve => setTimeout(resolve, 2000));

                const activeUsers = await api.write('/ppp/active/print');
                const activeUser = activeUsers.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());

                let ip = userObj['remote-address'] || 'Dynamic';
                let rawMac = userObj['caller-id'] || 'Any';

                if (activeUser) {
                    ip = activeUser.address || ip;
                    rawMac = activeUser['caller-id'] || rawMac;
                }

                const paket = userObj.profile || 'default';
                await api.close();

                let reportMessage = `✨ *RnB Network*\n\n` +
                                    `✅ Status Mikrotik: SUKSES\n` +
                                    `👤 Pelanggan: ${username}\n` +
                                    `🛜 Paket: ${paket}\n` +
                                    `💻 Server: ${targetServer.label}\n` +
                                    `🌐 IP: ${ip}\n` +
                                    `🔒 MAC Asli: ${rawMac}\n`;

                if (rawMac && rawMac !== 'Any') {
                    // FORMAT SAKTI: Huruf kecil + potong 16 karakter
                    const mac = rawMac.trim().toLowerCase().substring(0, 16);
                    reportMessage += `✂️ MAC OLT: ${mac}\n`;

                    await msg.reply(reportMessage + `\n🔍 _Menyisir OLT otomatis di cabang ${targetServer.label}..._`);
                    
                    const hasilOlt = await scanSemuaOlt(targetServer.olts, mac);
                    msg.reply(`✨ *RnB Network Final Report*\n\n👤 Pelanggan: ${username}\n💻 Server: ${targetServer.label}\n🔒 MAC OLT: ${mac}\n${hasilOlt}`);
                } else {
                    reportMessage += `\n⚠️ Pengecekan OLT dilewati karena MAC tidak terbaca.`;
                    msg.reply(reportMessage);
                }

            } catch (err) {
                console.log(err);
                msg.reply(`❌ Kendala Jaringan MikroTik ${targetServer.label}:\n${err.message}`);
                try { await api.close(); } catch (e) {}
            }
        }
    } catch (err) { console.log(err); }
});

process.on('unhandledRejection', err => console.error('UNHANDLED:', err));
process.on('uncaughtException', err => console.error('UNCAUGHT:', err));

client.initialize();
