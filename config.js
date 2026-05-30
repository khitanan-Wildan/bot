// config.js
module.exports = {
    // Kredensial default MikroTik (jika di cabang tidak ditentukan, akan pakai ini)
    defaultMikrotik: {
        user: 'berry',
        pass: 'subang21',
        timeout: 10
    },
    
    // Database Infrastruktur Seluruh Cabang RnB Network
    servers: {
        sukamelang: {
            label: 'Sukamelang',
            mikrotik: {
                host: '103.191.165.126',
                port: 8728,
                pass: 'Subang21' 
            },
            olts: [
                { id: 'hioso_4pon_sukamelang', merk: 'hioso_web', url: 'http://103.191.165.126:670' },
                { id: 'hioso_8pon_sukamelang', merk: 'hioso_web_2x', url: 'http://103.191.165.126:680' },
                { id: 'hsairpo_sukamelang', merk: 'hsairpo_api', url: 'http://103.191.165.126:9900', token: '452425a8aeba60657b49343e3a184707' }
            ]
        },
        cibarola: {
            label: 'Cibarola',
            mikrotik: { 
                host: '103.191.165.115', 
                port: 3155 
            },
            olts: [
                { id: 'hioso_cibarola', merk: 'hioso_web_2x', url: 'http://103.191.165.115:655' },
                { id: 'hsairpo_cibarola', merk: 'hsairpo_web_loop', url: 'http://103.191.165.115:704' }
            ]
        },
        perum: {
            label: 'Perum',
            mikrotik: { 
                host: '103.191.165.38', 
                port: 8725 
            },
            olts: [
                { id: 'hioso_perum', merk: 'hioso_web', url: 'http://103.191.165.38:8422' }
            ]
        },
        panglejar: {
            label: 'Panglejar',
            mikrotik: { 
                host: '103.191.165.115', 
                port: 705 
            },
            olts: [
                { id: 'hsairpo_panglejar', merk: 'hsairpo_api', url: 'http://103.191.165.115:710', token: 'b382a637a81aa7b873b162cc1e59aacc' }
            ]
        }
    }
};
