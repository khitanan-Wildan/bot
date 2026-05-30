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
        // Konfigurasi otomatis untuk mendeteksi Chrome bawaan Railway
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
                `📡 *RnBNET BOT*\n\n` +
                `FORMAT:\n` +
                `!aktifkan server username\n\n` +
                `SERVER:\n` +
                `- panglejar\n- perum\n- cibarola\n- sukamelang\n\n` +
                `CONTOH:\n` +
                `!aktifkan sukamelang budi`
            );
            return;
        }

        if (text.startsWith('!aktifkan')) {
            const args = text.split(' ');
            if (args.length < 3) {
                msg.reply('❌ Format salah\n\nGunakan: !aktifkan server username');
                return;
            }

            const serverKey = args[1].toLowerCase();
            const username = args[2];

            const targetServer = config.servers[serverKey];
            if (!targetServer) {
                msg.reply('❌ Server tidak ditemukan\n\nPilihan: panglejar, perum, cibarola, sukamelang');
                return;
            }

            msg.reply(`⏳ Memproses "${username}" di server *${targetServer.label}*...`);

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
                    msg.reply(`❌ User "${username}" tidak terdaftar di MikroTik ${targetServer.label}`);
                    await api.close();
                    return;
                }

                await api.write([
                    '/ppp/secret/set',
                    `=.id=${userObj['.id']}`,
                    '=disabled=no'
                ]);

                await new Promise(resolve => setTimeout(resolve, 2000));

                const activeUsers = await api.write('/ppp/active/print');
                const activeUser = activeUsers.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());

                let ip = userObj['remote-address'] || 'Dynamic';
                let mac = userObj['caller-id'] || 'Any';

                if (activeUser) {
                    ip = activeUser.address || ip;
                    mac = activeUser['caller-id'] || mac;
                }

                const paket = userObj.profile || 'default';
                await api.close();

                let reportMessage = `✨ *RnB Network*\n\n` +
                                    `✅ Status Mikrotik: SUKSES\n` +
                                    `👤 Pelanggan: ${username}\n` +
                                    `🛜 Paket: ${paket}\n` +
                                    `💻 Server: ${targetServer.label}\n` +
                                    `🌐 IP: ${ip}\n` +
                                    `🔒 MAC: ${mac}\n`;

                if (mac && mac !== 'Any') {
                    await msg.reply(reportMessage + `\n🔍 _Menghubungi OLT Cabang untuk memindai Rx Power (Redaman)..._`);

                    const hasilOlt = await scanSemuaOlt(targetServer.olts, mac);

                    msg.reply(`✨ *RnB Network Final Report*\n\n👤 Pelanggan: ${username}\n💻 Server: ${targetServer.label}\n🔒 MAC Alat: ${mac}\n${hasilOlt}`);
                } else {
                    reportMessage += `\n⚠️ Pengecekan OLT dilewati karena MAC tidak terbaca (Kemungkinan router pelanggan mati/tidak dial-up).`;
                    msg.reply(reportMessage);
                }

            } catch (err) {
                console.log(err);
                msg.reply(`❌ Kendala Jaringan Terdeteksi:\n${err.message}`);
                try { await api.close(); } catch (e) {}
            }
        }
    } catch (err) { console.log(err); }
});

process.on('unhandledRejection', err => console.error('UNHANDLED:', err));
process.on('uncaughtException', err => console.error('UNCAUGHT:', err));

client.initialize();
