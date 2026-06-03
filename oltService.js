async function scanSemuaOlt(oltList, mac) {
    let hasilAkhir = '';
    
    for (const olt of oltList) {
        let hasil = null;
        
        // Cek tipe OLT dari config
        if (olt.type === 'HSAirpo') {
            hasil = await cekRedamanHSAirpo(olt, mac);
        } 
        else if (olt.type === 'ZTE') {
            // hasil = await cekRedamanZTE(olt, mac);
        } 
        else if (olt.type === 'Huawei') {
            // hasil = await cekRedamanHuawei(olt, mac);
        }

        // Format output ke WhatsApp
        if (hasil && hasil.error) {
            hasilAkhir += `\n❌ *${olt.label}*: ${hasil.error}`;
        } else if (hasil) {
            hasilAkhir += `\n✅ *${hasil.olt_name}*` +
                          `\n   📉 Redaman: ${hasil.redaman}` +
                          `\n   📡 Status: ${hasil.status}`;
        }
    }
    
    return hasilAkhir || '⚠️ ONU tidak ditemukan di OLT manapun pada cabang ini.';
}
