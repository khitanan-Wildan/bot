// config.js
module.exports = {
    // Konfigurasi default (fallback jika tidak diisi di server spesifik)
    defaultMikrotik: {
        timeout: 15 // Timeout koneksi dalam detik
    },

    servers: {
        // ==========================================
        // 1. PANGLEJAR
        // ==========================================
        panglejar: {
            label: 'Panglejar',
            mikrotik: {
                host: '103.191.165.115',
                port: 705,
                user: 'berry',
                pass: 'subang21'
            },
            olts: [
                {
                    type: 'HSAirpo',
                    label: 'HSAirpo Panglejar',
                    ip: '103.191.165.115',
                    port: 710,
                    user: 'root',      // Username login web HSAirpo (sesuaikan jika bukan 'root')
                    pass: 'admin'      // Password login web HSAirpo (sesuaikan jika bukan 'admin')
                }
            ]
        },

        // ==========================================
        // 2. PERUM (Contoh, silakan diisi jika ada)
        // ==========================================
        perum: {
            label: 'Perum',
            mikrotik: {
                host: 'IP_MIKROTIK_PERUM',
                port: 8728,
                user: 'user_perum',
                pass: 'pass_perum'
            },
            olts: [
                // Tambahkan daftar OLT di Perum di sini
            ]
        },

        // ==========================================
        // 3. CIBAROLA (Contoh, silakan diisi jika ada)
        // ==========================================
        cibarola: {
            label: 'Cibarola',
            mikrotik: {
                host: 'IP_MIKROTIK_CIBAROLA',
                port: 8728,
                user: 'user_cibarola',
                pass: 'pass_cibarola'
            },
            olts: [
                // Tambahkan daftar OLT di Cibarola di sini
            ]
        },

        // ==========================================
        // 4. SUKAMELANG (Contoh, silakan diisi jika ada)
        // ==========================================
        sukamelang: {
            label: 'Sukamelang',
            mikrotik: {
                host: 'IP_MIKROTIK_SUKAMELANG',
                port: 8728,
                user: 'user_sukamelang',
                pass: 'pass_sukamelang'
            },
            olts: [
                // Tambahkan daftar OLT di Sukamelang di sini
            ]
        }
    }
};
