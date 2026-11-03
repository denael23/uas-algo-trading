# Perubahan dari strategi UTS

Sumber: dashboard UTS `REVISI - 25120200024 - Denael.html`. Selesai sebelum freeze date.

## Yang tetap sama

Semua nilai berikut, dalam satuan bar: `trend_len` 150, kemiringan SMA 20 bar, `rsi_len` 3, `rsi_entry` 50, `stop_atr` 6,0, ATR 14, Mom 126, `max_hold` 120 bar, `wcap` 25%, posisi 10%, maksimal 10 posisi, order ≤ 5% ADTV20, ADTV minimum Rp1 miliar, modal Rp100.000.000, long-only, urutan kandidat Mom126, tanpa exit RSI, tanpa pyramiding.

## Yang berubah

| Aspek | UTS | UAS | Alasan |
|---|---|---|---|
| Pasar | Saham BEI Kompas100 | Pasangan kripto IDR Indodax | Ketentuan UAS |
| Timeframe | Harian | Candle 4 jam, nilai parameter tetap dalam satuan bar | Soal menyarankan 1 atau 4 jam agar forward test punya cukup trade; 1 jam ditolak karena biaya taker lebih berat |
| Stop trailing | Stop-order, terisi di level atau di Open saat gap | Dipicu `Low(t) ≤ level` saat candle tertutup, dijual di bid live | Soal melarang sinyal dari candle berjalan dan mewajibkan fill di order book |
| Level stop awal | Open masuk − 6 × ATR | Close sinyal − 6 × ATR | Agar sinyal keluar tidak bergantung pada fill dan identik dengan backtest |
| Harga eksekusi | Open t+1 ± 1 fraksi | Bid/ask live. Backtest: Open bar berikutnya + spread dan slippage terukur | Ketentuan UAS |
| Biaya | Fee 0,15% / 0,25%, spread 1 fraksi | Fee taker Indodax yang lebih mahal, spread dan slippage terukur | Ketentuan UAS |
| Satuan order | Lot 100 lembar | `quantity_increment` per pasangan | Tidak ada lot di kripto |
| ARA/ARB | Ada | Dihapus | Tidak berlaku di kripto |
| Rentang waktu indikator | SMA150 sekitar 7 bulan, batas waktu 120 hari bursa | SMA150 = 25 hari, Mom126 = 21 hari, batas waktu = 20 hari | Akibat candle 4 jam dan pasar 24 jam |
| ADTV20 | 20 hari | 20 bar, disetarakan per hari (× 6); ambang tetap Rp1 miliar per hari | Agar ambang tetap bermakna per hari |
| Daily loss limit | Tidak ada | −3% dari awal hari WIB | Wajib UAS |
| Kill switch, idempotency, retry | Tidak ada | Ada | Wajib UAS |
| Validasi data | Pembersihan offline | Validasi tiap panggilan sesuai soal | Wajib UAS |
| Jendela indikator | Seluruh riwayat | 200 candle tertutup terakhir | Agar nilai indikator bot dan backtest identik |
| Universe | 100 saham Kompas100 | 3 sampai 10 pasangan IDR | Ketentuan UAS |

## Catatan

Parameter dipilih pada saham BEI harian dan tidak dioptimasi ulang untuk kripto maupun candle 4 jam. Horizon strategi menjadi sekitar enam kali lebih pendek, sehingga frekuensi transaksi dan porsi biaya bisa lebih tinggi daripada UTS. Dashboard UTS mencatat uji di aset lain belum dilakukan; UAS ini mengisinya.

Dashboard UAS memakai desain dashboard UTS, dengan bagian yang disesuaikan untuk ketentuan UAS. Uji validitas khusus UTS (walk-forward, peta panas, bootstrap, entri acak) tidak dibawa karena tidak diminta UAS dan tidak dijalankan pada data kripto.
