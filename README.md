# UAS Algorithmic Trading: Bot Dry Run Indodax di Vercel

Denael, NIM 25120200024. Semua order disimulasikan. Hanya memakai API publik Indodax, tanpa API key dan tanpa uang sungguhan.

- Strategi lengkap: [`docs/STRATEGI.md`](docs/STRATEGI.md)
- Perubahan dari UTS: [`docs/PERUBAHAN_DARI_UTS.md`](docs/PERUBAHAN_DARI_UTS.md)
- Langkah menjalankan dan deploy: [`docs/PANDUAN_LANGKAH.md`](docs/PANDUAN_LANGKAH.md)
- Sumber tarif dan batas: [`docs/SUMBER.md`](docs/SUMBER.md)
- Refleksi: `docs/REFLEKSI.md`, dibuat oleh `npm run refleksi` setelah forward test
- Bukti freeze: `FREEZE.json`, commit bertag `freeze`, dan bagian "Catatan freeze" di bawah

## Cara kerja

```
Penjadwal luar (tiap jam) --> /api/tick (dilindungi CRON_SECRET)
                               |- API publik Indodax: waktu, pasangan, order book, candle
                               |- lib/signal.js  <-- fungsi yang sama dipakai lib/backtest.js
                               |- simulasi fill di order book
                               `- Neon Postgres: state, sinyal, order, equity, error, snapshot
Laptop: tarik_data -> backtest -> replay_forward -> hitung_ulang -> dashboard offline
```

| Folder | Isi |
|---|---|
| `api/` | Endpoint Vercel: `tick`, `kill`, `catatan`, `health`, `dashboard-data` |
| `lib/` | Sinyal, indikator, fill, portofolio, tick, backtest, metrik, laporan |
| `scripts/` | Penarikan data, seleksi universe, backtest, replay, `hitung_ulang`, dashboard |
| `config/` | Parameter, universe, tarif, biaya terukur |
| `public/` | Dashboard Vercel, sekaligus templat dashboard offline |
| `data/` | Candle asli Indodax beserta manifest SHA-256 |
| `log_mentah/` | Log forward test (JSON dan CSV) |
| `log_backtest/` | Log order dan equity backtest serta replay |
| `tests/` | Pengujian perangkat lunak. Data di dalamnya sintetis dan tidak pernah dipakai untuk hasil |

## Perintah

```
npm test                       pengujian perangkat lunak
npm run backtest               backtest >= 3 tahun
npm run replay                 backtest ulang pada jendela forward test
npm run hitung-ulang           semua angka dashboard dari log mentah
node scripts/hitung_ulang.js --cek   bandingkan dengan dashboard offline
npm run cek-freeze             aturan identik dengan saat freeze
npm run cek-rahasia            tidak ada secret di berkas proyek
```

## Jaminan kejujuran data di kode

- Candle yang masih berjalan dibuang sebelum sinyal dihitung (`closedOnly`).
- Backtest dan replay menolak data yang manifest-nya bukan dari API Indodax, kecuali flag `--data-uji`, yang membuat dashboard menampilkan peringatan merah dan membuat `catat_freeze` menolak.
- Bot menolak bertransaksi bila tarif resmi belum diisi atau, pada forward test, universe belum final.
- Dashboard tidak memuat angka tertulis tangan. Semua angka berasal dari `lib/metrics.js`.
- Sinyal yang dihitung ditulis ke `signals` bersama hash jendela candle; `replay_forward` membandingkannya baris demi baris.
- Setiap panggilan mencatat hash aturan dan commit, sehingga perubahan setelah freeze terlihat di log.
