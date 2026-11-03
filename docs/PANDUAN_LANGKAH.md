# Panduan langkah sampai pengumpulan

Semua waktu WIB. **Batas keras freeze: Rabu 4 Nov 12.00.** Targetkan selesai Rabu pukul 10.00. Pengumpulan: **Sabtu 14 Nov 23.59.**

Ganti `SECRET` dengan kode rahasia dan `PROYEK` dengan nama proyek Vercel. Di PowerShell Windows, tulis `curl.exe`, bukan `curl`.

**Tiga aturan riwayat commit**, karena tanpa riwayat komponen kecocokan bernilai 0:
- Repositori GitHub **publik**, dan dibuat dari awal, bukan diunggah ulang di akhir.
- **Jangan pernah force-push**, rebase, atau menghapus tag `freeze`.
- Secret tidak boleh pernah ter-commit, karena riwayat repositori publik bisa dibaca siapa saja.

## Tahap 1: Selasa 3 Nov (siapkan bot, sepagi mungkin)

Snapshot order book baru terkumpul setelah bot berjalan, jadi tahap ini menentukan banyaknya data biaya.

1. Pasang Node 22 atau lebih baru, ekstrak ZIP, lalu `npm install` dan `npm test`. Semua tes harus lolos.
2. Buat repositori **publik** di GitHub, lalu `git init`, `git add -A`, commit, dan push.
3. Di Vercel: **Add New Project**, impor repositori, preset **Other**, tanpa perintah build.
4. Tambahkan **Neon Postgres** dari Marketplace. Pastikan `DATABASE_URL` muncul di Environment Variables.
5. Buat secret, simpan sebagai `CRON_SECRET` di Environment Variables, lalu redeploy:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
6. Salin `.env.example` menjadi `.env`, isi keduanya, lalu `npm run init-db`.
7. Uji koneksi dari fungsi Vercel. `lolos` harus `true`. **Jika Indodax gagal dari Vercel, laporkan ke dosen sebelum freeze.**
   `curl -H "Authorization: Bearer SECRET" https://PROYEK.vercel.app/api/health`
8. Isi tarif resmi di `config/fees.json` (lihat `docs/SUMBER.md`).
9. Di laptop:
   ```
   npm run pilih-universe
   npm run cek-sumber
   ```
   Commit dan push `config/` dan `hasil/`.
10. Pasang penjadwal:
    - **Utama:** [cron-job.org](https://cron-job.org), URL `https://PROYEK.vercel.app/api/tick?source=cron_job_org`, menit ke-3 tiap jam, header `Authorization: Bearer SECRET`.
    - **Cadangan:** GitHub > Settings > Secrets > Actions: `TICK_URL` (`https://PROYEK.vercel.app/api/tick`) dan `CRON_SECRET`.
11. Buka `https://PROYEK.vercel.app`. Panggilan persiapan harus bertambah tiap jam.

## Tahap 2: Selasa malam (bukti dan latihan)

1. Uji kill switch dan panggilan ganda:
   ```
   curl -X POST -H "Authorization: Bearer SECRET" "https://PROYEK.vercel.app/api/kill?state=on&reason=uji"
   curl -H "Authorization: Bearer SECRET" "https://PROYEK.vercel.app/api/tick?source=uji_manual"
   curl -H "Authorization: Bearer SECRET" "https://PROYEK.vercel.app/api/tick?source=uji_manual"
   curl -X POST -H "Authorization: Bearer SECRET" "https://PROYEK.vercel.app/api/kill?state=off&reason=selesai_uji"
   ```
   Panggilan tick kedua harus `duplicate_slot`. **Pastikan kill switch sudah off.**
2. Simpan bukti tes: `npm test > hasil/bukti_tes.txt`
3. Latihan alur backtest:
   ```
   npm run tarik-data
   npm run ekspor-log
   npm run ukur-biaya
   npm run backtest
   npm run hitung-ulang
   ```
   Jika `ukur-biaya` melaporkan kedalaman tidak cukup untuk suatu pasangan, buang pasangan itu atau kecilkan `estimasi_ukuran_order_idr`, lalu catat alasannya.

## Tahap 3: Rabu 4 Nov pagi, selesai sebelum 10.00

Ulangi kelima perintah latihan di atas, lalu:

```
npm run catat-freeze
npm run cek-rahasia
git add -A
git commit -m "FREEZE aturan, parameter, universe"
git tag freeze
git push
git push origin freeze
```

Pastikan deployment Vercel dari commit itu sudah **Ready** sebelum 12.00, dan tag `freeze` terlihat di GitHub.

## Tahap 4: forward test, Rabu 4 Nov 12.00 sampai Sabtu 14 Nov 12.00

- Bot berjalan sendiri. Setiap panggilan mencatat hash aturan dan commit.
- **Jangan ubah** `config/strategy.json`, `config/universe.json`, atau fungsi sinyal.
- Sehari sekali cek dashboard Vercel. Bila uptime turun, periksa cron-job.org dan GitHub Actions.
- Perbaikan bug yang tidak mengubah aturan: commit biasa, lalu catat:
  `curl -X POST -H "Authorization: Bearer SECRET" -H "Content-Type: application/json" -d "{\"catatan\":\"apa yang diperbaiki\",\"commit\":\"HASH\"}" https://PROYEK.vercel.app/api/catatan`
- Hindari kill switch kecuali perlu. Setiap pemakaian harus dijelaskan di refleksi.

## Tahap 5: Sabtu 14 Nov, setelah 12.05, selesai sebelum 23.59

```
npm run ekspor-log
node scripts/tarik_data.js --replay
npm run replay
npm run hitung-ulang
npm run dashboard
node scripts/hitung_ulang.js --cek
npm run refleksi
```

Jangan menjalankan ulang `cek-sumber` atau `tarik-data` tanpa `--replay`, karena keduanya menimpa bukti masa persiapan.

1. Lengkapi bagian `[TULIS]` di `docs/REFLEKSI.md` dengan membaca log.
2. Buat bukti freeze, periksa secret, lalu commit dan push (commit biasa, tanpa force-push):
   ```
   npm run cek-freeze
   npm run cek-rahasia
   git add -A
   git commit -m "Hasil akhir forward test"
   git push
   ```
3. Buat ZIP, yang sudah menyertakan folder `.git` tanpa `.env` dan `node_modules`:
   `npm run paket`
   ZIP muncul di folder di atas folder proyek.
4. Unggah ZIP ke RISE. Tulis link dashboard Vercel dan link repositori di kolom catatan.
5. Jangan matikan Vercel dan database, dan jangan jadikan repositori privat, sampai nilai keluar.
