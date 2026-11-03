# Strategi tertulis

**Nama:** Pullback Searah Tren (Trend Following + Mean Reversion). Strategi dari UTS, dengan aturan dan nilai parameter yang sama dalam satuan bar.
**Pasar:** pasangan IDR di Indodax (universe di `config/universe.json`). Long-only, tanpa margin dan leverage.
**Timeframe:** candle 4 jam (`tf=240`); UTS memakai harian. Bot dipanggil tiap jam untuk snapshot, equity, dan pengecekan risiko, tetapi sinyal dihitung sekali per candle tertutup.
**Modal virtual:** Rp100.000.000, compounding.
**Parameter:** `config/strategy.json`. Tidak dioptimasi ulang untuk kripto.

## Indikator

Dihitung dari **200 candle tertutup terakhir** per pasangan. Ukuran jendela sama di bot dan backtest. Kode: `lib/signal.js`.

| Indikator | Definisi |
|---|---|
| SMA150 | Rata-rata Close 150 bar (25 hari) |
| RSI3 | RSI Wilder periode 3 |
| ATR14 | Rata-rata Wilder dari True Range |
| ADTV20 | Rata-rata nilai transaksi IDR 20 bar terakhir, dikali 6 agar setara per hari |
| Mom126 | Close(t) ÷ Close(t−126) − 1 (21 hari) |

## Aturan masuk (dievaluasi tiap candle t tertutup)

1. Tren naik: `Close(t) > SMA150(t)` dan `SMA150(t) > SMA150(t−20)`.
2. Koreksi jangka pendek: `RSI3(t) < 50`.
3. Likuid: `ADTV20(t) ≥ Rp1.000.000.000` dan `Volume(t) > 0`; semua indikator terdefinisi.
4. Belum dipegang, dan masih ada slot dari 10 posisi.
5. Bila kandidat melebihi slot: Mom126 tertinggi dulu; seri menurut abjad.

## Aturan keluar

1. **Stop trailing:** level awal = Close sinyal − 6 × ATR14. Tiap candle dinaikkan menjadi maks(level lama, HC − 6 × ATR14), HC = Close tertinggi sejak masuk. Level baru berlaku mulai candle berikutnya. Terpicu bila `Low(t) ≤ level`.
2. **Trend patah:** `Close(t) < SMA150(t)`.
3. **Batas waktu:** ≥ 120 bar sejak masuk (20 hari).
4. **Batas bobot:** kuantitas × Close(t) > 25% ekuitas: jual seluruh posisi.

Tanpa exit berbasis RSI, tanpa pyramiding, tanpa jual sebagian kecuali order book tidak cukup dalam (sisanya menjadi exit tertunda).

## Sizing

Nilai order = terkecil dari: 10% × ekuitas, 5% × ADTV20, dan kas. Fee sudah termasuk. Kuantitas dibulatkan ke bawah mengikuti `quantity_increment`.

## Risk management

| Aturan | Nilai | Perilaku |
|---|---|---|
| Posisi terbuka maksimum | 10 | Dibatasi juga oleh ukuran universe |
| Ukuran per posisi | 10% saat masuk, keluar bila > 25% | Lihat sizing dan batas bobot |
| Daily loss limit | −3% dari equity awal hari WIB | Entry diblok sampai 00.00 WIB berikutnya, meski equity pulih; exit tetap berjalan |
| Kill switch | Flag di storage, `POST /api/kill` | Entry diblok tanpa deploy ulang; exit tetap berjalan; tercatat |
| Minimum order | Terbesar dari Rp25.000 dan `trade_min_base_currency`; juga `trade_min_traded_currency` | Order dilewati |
| Data tidak valid | Lihat `lib/candles.js`, `lib/orderbook.js` | Tidak membuka posisi, alasan tercatat |

## Eksekusi

**Bot:** beli di ask dan jual di bid dari `/api/depth` live pada panggilan pertama setelah candle tertutup, menghabiskan level berurutan, memakai harga rata-rata.

**Backtest:** keputusan dari candle tertutup, eksekusi di Open bar berikutnya, ditambah setengah median spread dan median slippage dari snapshot.

**Fee:** taker all-in per sisi, yang lebih mahal antara `/api/pairs` dan halaman resmi.

**Penilaian equity:** posisi terbuka pada best bid. Di backtest: Close × (1 − setengah spread) sebagai pendekatan best bid.

## Definisi metrik

- **Laba kotor** = laba bersih trade selesai + fee + spread + slippage.
- **Porsi biaya** = (fee + spread + slippage) ÷ laba kotor. Ditampilkan "–" bila laba kotor ≤ 0.
- **Spread cost** per fill = kuantitas × |harga terbaik − mid|. **Slippage cost** per fill = kuantitas × |harga fill rata-rata − harga terbaik|.
- **Uptime** = jumlah slot jam dengan panggilan berstatus `ok` atau `ok_with_errors` ÷ 240 slot (10 hari × 24 jam).

## Universe dan survivorship bias

`scripts/pilih_universe.js` memeringkat semua pasangan IDR (kecuali stablecoin) berdasarkan **median volume IDR harian 90 hari sebelum awal backtest**. Lolos bila: riwayat ≥ 85 hari, ≥ 95% hari aktif, ≤ 1% bar bervolume nol pada periode itu, serta masih bisa diperdagangkan dengan spread ≤ 2% saat seleksi. Diambil 6 teratas.

Keterbatasan yang diakui: `/api/pairs` hanya memuat pasangan yang masih terdaftar, sehingga pasangan yang sudah delisting tidak otomatis ikut. Syarat "masih bisa diperdagangkan" diperlukan agar forward test bisa berjalan, tetapi syarat ini sendiri mengandung sedikit survivorship bias. Hasil lengkap termasuk yang ditolak tersimpan di `hasil/seleksi_universe.json`. Simbol delisted yang diketahui bisa ditambahkan di `config/kandidat_tambahan.json`.
