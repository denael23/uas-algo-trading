# Sumber dan tanggal akses

## Sudah diperiksa pada 2 November 2026

| Hal | Temuan | Sumber |
|---|---|---|
| Format API | `Time` dalam detik pada contoh OHLC; `server_time` dalam milidetik; batas 180 request/menit; daftar `tf` termasuk 240 | [Public-RestAPI.md](https://github.com/btcid/indodax-official-api-docs/blob/master/Public-RestAPI.md) |
| Biaya CFX pasar IDR | Turun dari 0,0111% ke 0,00555%, berlaku 1 Oktober 2026 00.00 WIB. Rincian all-in ada di Profil > Pengaturan > Biaya Trading | [Blog Indodax, 29 Sep 2026](https://blog.indodax.com/penurunan-biaya-cfx-1-okt-2026) |
| Durasi fungsi Hobby | Maksimum 300 detik | [Vercel Hobby](https://vercel.com/docs/plans/hobby) |

## Wajib Anda isi sendiri

Halaman `help.indodax.com` dan API Indodax tidak bisa dibuka dari lingkungan pengerjaan, jadi tarif berikut **belum terverifikasi** dan bot menolak bertransaksi sampai `config/fees.json` diisi:

- Tarif taker beli dan jual all-in dari [Rincian Biaya Transaksi](https://help.indodax.com/hc/id/articles/4416646599705-Rincian-Biaya-Transaksi-di-INDODAX), beserta tanggal akses. Bandingkan dengan Profil > Pengaturan > Biaya Trading.
- `trade_fee_percent_taker` dan minimum order dari `/api/pairs`: dicatat otomatis oleh `npm run cek-sumber`.
- Batas cron dan durasi di dokumentasi Vercel: [cron](https://vercel.com/docs/cron-jobs/usage-and-pricing), [fungsi](https://vercel.com/docs/functions/limitations), [storage](https://vercel.com/docs/storage).

**Hanya untuk mengecek kewajaran, bukan untuk dipakai:** artikel pihak ketiga per Maret 2026 menyebut taker pasar IDR 0,2111% (beli) dan 0,4211% (jual) ([Blockchainmedia](https://blockchainmedia.id/biaya-transaksi-di-crypto-exchange-indonesia/)). Dikurangi penurunan CFX, kira-kira 0,206% dan 0,416%. Bila angka resmi jauh berbeda, percayai halaman resmi. Perhatikan bahwa tarif jual lebih tinggi daripada beli, jadi `config/fees.json` memisahkan kedua sisi.

## Asumsi yang perlu dicek pada data asli

| Asumsi | Cara pengecekan |
|---|---|
| Satuan `Volume` pada `history_v2` | Terdeteksi otomatis oleh `pilih_universe.js`, tercetak di layar |
| `tf=240` mengembalikan seluruh jendela 500 bar per request | Lihat `celah` dan `bar` per pasangan di `data/candles/manifest.json`. Sekitar 6.600 bar + pemanasan 212 bar diharapkan untuk 3 tahun |
| Batas candle 4 jam Indodax | Lihat jam pada `bar_pertama` di manifest. Kode mengikuti `Time` apa adanya, jadi tidak perlu diubah |
| Bar bervolume nol pada pasangan terpilih | `bar_volume_nol` di manifest, dan `Blokir entry` di dashboard |
