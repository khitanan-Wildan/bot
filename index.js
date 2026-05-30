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
                `📡 *RnBNET BOT GLOBAL*\n\n` +
                `🔍 *CEK REDAMAN (OTOMATIS ALL OLT):*\n` +
                `Format: !cek username\n` +
                `Contoh: !cek budi\n\n` +
                `⚡ *AKTIVASI (OPEN ISOLIR + ALL OLT):*\n` +
                `Format: !aktifkan username\n` +
                `Contoh: !aktifkan budi\n\n` +
                `_Sistem otomatis menyisir cabang Sukamelang, Cibarola, Perum, & Panglejar._`
            );
            return;
        }

        // ==========================================
        // 1. PERINTAH MURNI CEK REDAMAN GLOBAL
        // ==========================================
        if (text.startsWith('!cek')) {
            const args = text.split(' ');
            if (args.length < 2) {
                msg.reply('❌ Format salah\n\nGunakan: !cek username');
                return;
            }

            const username = args[1];
            msg.reply(`🔍 Memulai pencarian global untuk user "${username}" di semua MikroTik cabang...`);

            let foundServer = null;
            let foundUserObj = null;
            let mac = 'Any';

            // Looping menyisir semua server MikroTik yang terdaftar di config
            for (const key in config.servers) {
                const server = config.servers[key];
                const mtConfig = {
                    host: server.mikrotik.host,
                    port: server.mikrotik.port,
                    user: server.mikrotik.user || config.defaultMikrotik.user,
                    password: server.mikrotik.pass || config.defaultMikrotik.pass,
                    timeout: 4000 // timeout cepat agar tidak macet lama
                };

                const api = new RouterOSAPI(mtConfig);
                try {
                    await api.connect();
                    const secrets = await api.write('/ppp/secret/print');
                    const userObj = secrets.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());

                    if (userObj) {
                        foundServer = server;
                        foundUserObj = userObj;
                        mac = userObj['caller-id'] || 'Any';

                        const activeUsers = await api.write('/ppp/active/print');
                        const activeUser = activeUsers.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());
                        if (activeUser) {
                            mac = activeUser['caller-id'] || mac;
                        }
                        await api.close();
                        break; // Stop loop jika user sudah ketemu di salah satu cabang
                    }
                    await api.close();
                } catch (e) {
                    try { await api.close(); } catch (err) {}
                }
            }

            if (!foundServer) {
                msg.reply(`❌ User "${username}" tidak ditemukan di MikroTik cabang manapun.`);
                return;
            }

            if (!mac || mac === 'Any') {
                msg.reply(`⚠️ User ketemu di server *${foundServer.label}*, tetapi MAC Address tidak terbaca (Router pelanggan kemungkinan mati).`);
                return;
            }

            msg.reply(`📡 User ditemukan di *${foundServer.label}*\n🔒 MAC: *${mac}*\n_Sedang menyisir seluruh OLT di cabang tersebut..._`);

            const hasilOlt = await scanSemuaOlt(foundServer.olts, mac);
            msg.reply(`📊 *Hasil Cek Redaman OLT*\n\n👤 Pelanggan: ${username}\n💻 Server: ${foundServer.label}\n🔒 MAC Alat: ${mac}\n${hasilOlt}`);
            return;
        }

        // ==========================================
        // 2. PERINTAH AKTIVASI GLOBAL
        // ==========================================
        if (text.startsWith('!aktifkan')) {
            const args = text.split(' ');
            if (args.length < 2) {
                msg.reply('❌ Format salah\n\nGunakan: !aktifkan username');
                return;
            }

            const username = args[1];
            msg.reply(`⏳ Mencari lokasi akun "${username}" di seluruh jaringan cabang...`);

            let foundServer = null;
            let foundUserObj = null;
            let targetApi = null;

            for (const key in config.servers) {
                const server = config.servers[key];
                const mtConfig = {
                    host: server.mikrotik.host,
                    port: server.mikrotik.port,
                    user: server.mikrotik.user || config.defaultMikrotik.user,
                    password: server.mikrotik.pass || config.defaultMikrotik.pass,
                    timeout: 4000
                };

                const api = new RouterOSAPI(mtConfig);
                try {
                    await api.connect();
                    const secrets = await api.write('/ppp/secret/print');
                    const userObj = secrets.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());

                    if (userObj) {
                        foundServer = server;
                        foundUserObj = userObj;
                        targetApi = api;
                        break; 
                    }
                    await api.close();
                } catch (e) {
                    try { await api.close(); } catch (err) {}
                }
            }

            if (!foundServer || !targetApi) {
                msg.reply(`❌ User "${username}" tidak ditemukan di database cabang manapun.`);
                return;
            }

            try {
                // Aktifkan akun PPPoE yang ketemu
                await targetApi.write([
                    '/ppp/secret/set',
                    `=.id=${foundUserObj['.id']}`,
                    '=disabled=no'
                ]);

                await new Promise(resolve => setTimeout(resolve, 2000));

                const activeUsers = await targetApi.write('/ppp/active/print');
                const activeUser = activeUsers.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());

                let ip = foundUserObj['remote-address'] || 'Dynamic';
                let mac = foundUserObj['caller-id'] || 'Any';

                if (activeUser) {
                    ip = activeUser.address || ip;
                    mac = activeUser['caller-id'] || mac;
                }

                const paket = foundUserObj.profile || 'default';
                await targetApi.close();

                let reportMessage = `✨ *RnB Network Otorisasi*\n\n` +
                                    `✅ Status Mikrotik: SUKSES OPEN ISOLIR\n` +
                                    `👤 Pelanggan: ${username}\n` +
                                    `🛜 Paket: ${paket}\n` +
                                    `💻 Server Lokasi: ${foundServer.label}\n` +
                                    `🌐 IP: ${ip}\n` +
                                    `🔒 MAC: ${mac}\n`;

                if (mac && mac !== 'Any') {
                    await msg.reply(reportMessage + `\n🔍 _Menyisir jaringan OLT otomatis di cabang ${foundServer.label}..._`);
                    const hasilOlt = await scanSemuaOlt(foundServer.olts, mac);
                    msg.reply(`✨ *RnB Network Final Report*\n\n👤 Pelanggan: ${username}\n💻 Server: ${foundServer.label}\n🔒 MAC Alat: ${mac}\n${hasilOlt}`);
                } else {
                    reportMessage += `\n⚠️ Pengecekan OLT dilewati karena MAC tidak terbaca.`;
                    msg.reply(reportMessage);
                }

            } catch (err) {
                console.log(err);
                msg.reply(`❌ Kendala eksekusi jaringan:\n${err.message}`);
                try { await targetApi.close(); } catch (e) {}
            }
        }
    } catch (err) { console.log(err); }
});

process.on('unhandledRejection', err => console.error('UNHANDLED:', err));
process.on('uncaughtException', err => console.error('UNCAUGHT:', err));

client.initialize();
