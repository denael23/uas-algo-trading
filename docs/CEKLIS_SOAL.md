# Ceklis terhadap soal

Status: **Kode** = sudah dibuat dan diuji. **Anda** = perlu dijalankan atau diisi oleh Anda.

| Butir soal | Status | Letak |
|---|---|---|
| Strategi tertulis lengkap | Kode | `docs/STRATEGI.md`, `config/strategy.json` |
| Catatan perubahan dari UTS | Kode | `docs/PERUBAHAN_DARI_UTS.md`, tabel perbedaan di dashboard |
| Universe 3 sampai 10, kriteria pada awal backtest | Anda jalankan | `scripts/pilih_universe.js` |
| Backtest ≥ 3 tahun data asli | Anda jalankan | `scripts/tarik_data.js`, `scripts/backtest.js` (menolak < 3 tahun) |
| Fee, spread, slippage terukur di backtest | Kode; tarif dari Anda | `config/fees.json`, `scripts/ukur_biaya.js` |
| Fungsi sinyal yang sama | Kode | `lib/signal.js` dipakai `lib/tick.js` dan `lib/backtest.js` |
| Long-only, tanpa margin | Kode | Tidak ada jalur short di kode |
| Hanya API publik, tanpa API key | Kode | `lib/indodax.js` |
| Buang candle berjalan | Kode, diuji | `closedOnly` (Time detik vs server_time milidetik) |
| Validasi data dan pencatatan alasan | Kode, diuji | `validateWindow`, `bookIssue`, tabel `events` |
| Maksimal 3 request/detik, tanpa paralel | Kode | `lib/indodax.js`, jeda 350 sampai 400 ms |
| Beli di ask, jual di bid, habiskan level | Kode, diuji | `lib/orderbook.js` |
| Fee yang lebih mahal, dua sumber dicantumkan | Kode | `effectiveFee`, kolom `fee_*` di `orders` |
| Minimum order Rp25.000, increment, pembulatan | Kode, diuji | `minOrderIdr`, `floorQty`, `on_tick` |
| Snapshot ≥ 3× sehari, mentah dikumpulkan | Kode (tiap jam) | tabel `ob_snapshots` |
| Equity pada best bid, harian setelah 00.00 WIB | Kode, diuji | `markEquity`, `dayStartEquity` |
| Log lengkap per order | Kode | tabel `orders` |
| Batas posisi, daily loss limit WIB | Kode, diuji | `lib/tick.js`, `lib/backtest.js` |
| Kill switch tanpa deploy ulang | Kode, diuji | `api/kill.js` |
| Timeout, error, respons kosong, retry terbatas | Kode, diuji | `lib/indodax.js` |
| Idempotency | Kode, diuji | Slot, lease, kunci unik `signals` |
| Endpoint tick, durasi ≤ 300 detik | Kode | `vercel.json` (120 detik) |
| Penjadwal luar | Anda pasang | cron-job.org + `.github/workflows/tick.yml` |
| State di storage | Kode | Neon Postgres, `lib/store.js` |
| CRON_SECRET | Kode, diuji | `lib/runtime.js` |
| Uji koneksi dari Vercel | Anda jalankan | `/api/health` |
| Dashboard Vercel dan offline, desain sama dengan dashboard UTS | Kode, diuji | `public/index.html`, `scripts/bangun_dashboard.js` |
| Secret hanya di env, `.env.example` | Kode, diuji | `.gitignore`, `scripts/cek_rahasia.js` |
| Freeze di README dan commit, sebelum Rabu 4 Nov 12.00 WIB | Anda jalankan | `scripts/catat_freeze.js`, tag `freeze` |
| Bukti freeze dari riwayat commit: repo GitHub publik tanpa force-push, atau ZIP dengan `.git` utuh | Kode, diuji; Anda jalankan | `scripts/cek_freeze.js`, `scripts/buat_paket.js` |
| Secret tidak ada di berkas maupun riwayat commit | Kode, diuji | `scripts/cek_rahasia.js` |
| Forward test 10 hari (4 Nov 12.00 sampai 14 Nov 12.00 WIB) | Anda jalankan | Otomatis setelah deploy |
| Log mentah, hitung_ulang | Kode, diuji | `scripts/ekspor_log.js`, `scripts/hitung_ulang.js` |
| Refleksi dengan angka | Draf otomatis; Anda tulis penjelasannya | `scripts/buat_draf_refleksi.js` |
| Metrik wajib dashboard, tanpa CAGR forward | Kode | `public/index.html` |
| Gap pada jendela forward yang sama | Kode, diuji | `scripts/replay_forward.js`, `buildGapSection` |
| Panel operasional | Kode | `buildOps` |

## Yang belum teruji

Kode belum pernah menyentuh API Indodax asli dan belum pernah berjalan di Vercel karena keduanya tidak terjangkau dari lingkungan pengerjaan. Pengujian memakai tiruan API mengikuti format dokumentasi resmi serta Postgres sungguhan. Bila format respons asli berbeda, `npm run cek-sumber` dan `/api/health` akan menunjukkannya pada hari pertama, jauh sebelum freeze.
