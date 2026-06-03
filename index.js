// index.js - RnBNET BOT (Final Resilient Version)
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const RouterOSAPI = require('node-routeros').RouterOSAPI;

const config = require('./config');
const { scanSemuaOlt } = require('./oltService');

const app = express();
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🌐 WEB SERVER RUNNING ON PORT ${PORT}`));

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'rnbnet', dataPath: './session' }),
    puppeteer: {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    }
});

console.log('🤖 BOT STARTING...');

client.on('qr', async (qr) => {
    try {
        await qrcode.toFile(path.join(__dirname, 'qr.png'), qr);
        console.log('📱 SCAN QR CODE -> qr.png');
    } catch (err) { console.error('❌ QR Error:', err.message); }
});

client.on('authenticated', () => console.log('✅ AUTH SUCCESS'));
client.on('ready', () => console.log('🚀 BOT READY FOR RnBNET!'));

client.on('disconnected', (reason) => {
    console.warn('⚠️ BOT DISCONNECTED:', reason);
    setTimeout(() => client.initialize().catch(console.error), 5000);
});

// ==========================================
// HELPER: KONEKSI MIKROTIK (ANTI CRASH)
// ==========================================
async function connectMikrotik(serverKey) {
    const targetServer = config.servers[serverKey];
    if (!targetServer) throw new Error(`Server "${serverKey}" tidak ditemukan`);

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
        // Tangkap error timeout RosException agar tidak crash
        throw new Error(`Gagal konek ke MikroTik ${targetServer.label} (Port ${mtConfig.port}): ${err.message}`);
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
// MESSAGE HANDLER
// ==========================================
client.on('message_create', async (msg) => {
    try {
        const text = msg.body.trim();
        const args = text.split(/\s+/);
        const command = args[0]?.toLowerCase();

        if (command === 'ping') { await msg.reply('pong 🏓'); return; }

        if (command === '!menu') {
            await msg.reply(`📡 *RnBNET BOT HIGH SPEED*\n\n` +
                `🔍 *CEK REDAMAN:*\n\`!cek [mikrotik] [username]\`\n` +
                `⚡ *AKTIVASI:*\n\`!aktifkan [mikrotik] [username]\`\n\n` +
                `📍 *SERVER:* panglejar, perum, cibarola, sukamelang`);
            return;
        }

        if (['!cek', '!aktifkan'].includes(command)) {
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
        console.error('❌ Handler Error:', err);
        try { await msg.reply(`❌ *Error*\n\n${err.message}`); } catch (e) {}
    }
});

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
            await msg.reply(`⚠️ MAC Address tidak terbaca untuk user "${username}".`);
            return;
        }

        const mac = rawMac.trim().toLowerCase().substring(0, 16);
        await msg.reply(`📡 MAC: \`${mac}\`\n_Menyisir OLT..._`);

        const hasilOlt = await scanSemuaOlt(targetServer.olts, mac);
        await msg.reply(`📊 *Hasil Cek Redaman*\n\n👤 ${username}\n💻 ${targetServer.label}\n🔒 MAC: \`${mac}\`\n\n${hasilOlt}`);

    } catch (err) {
        console.error('CekRedaman Error:', err);
        await msg.reply(`❌ *Gagal*\n\n${err.message}`);
    } finally {
        try { if (api) await api.close(); } catch (e) {}
    }
}

async function handleAktivasi(msg, serverKey, username) {
    let api;
    try {
        const { api: mikrotikApi, targetServer } = await connectMikrotik(serverKey);
        api = mikrotikApi;

        await msg.reply(`⏳ *Open Isolir*\n👤 ${username}\n💻 ${targetServer.label}\n_Mohon tunggu..._`);
        
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
            const mac = rawMac.trim().toLowerCase().substring(0, 16);
            report += `✂️ MAC OLT: \`${mac}\`\n\n🔍 _Menyisir OLT..._`;
            await msg.reply(report);
            
            const hasilOlt = await scanSemuaOlt(targetServer.olts, mac);
            await msg.reply(`✨ *Final Report*\n\n👤 ${username}\n💻 ${targetServer.label}\n🔒 MAC: \`${mac}\`\n\n${hasilOlt}`);
        } else {
            report += `\n⚠️ _Cek OLT dilewati (MAC tidak terbaca)._`;
            await msg.reply(report);
        }
    } catch (err) {
        console.error('Aktivasi Error:', err);
        await msg.reply(`❌ *Gagal*\n\n${err.message}`);
    } finally {
        try { if (api) await api.close(); } catch (e) {}
    }
}

process.on('unhandledRejection', err => console.error('❌ UNHANDLED:', err));
process.on('uncaughtException', err => console.error('❌ UNCAUGHT:', err));

client.initialize().catch(console.error);
