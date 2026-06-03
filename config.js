module.exports = {
    // ... config mikrotik dll ...
    
    servers: {
        panglejar: {
            label: 'Panglejar',
            mikrotik: { host: '192.168.x.x', port: 8728, user: 'admin', pass: 'xxx' },
            olts: [
                // ... OLT lain (ZTE/Huawei) ...
                
                // TAMBAHKAN INI UNTUK HSairpo:
                {
                    type: 'HSAirpo',
                    label: 'HSAirpo Panglejar',
                    ip: '103.191.165.115',
                    port: 710,
                    token: 'b382a637a81aa7b873b162cc1e59aacc',
                    port_id: 1 // Sesuaikan jika OLT memiliki banyak port PON (1, 2, 3, dst)
                }
            ]
        },
        // ... server lain ...
    }
};
