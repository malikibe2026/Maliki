-- Skema awal sistem kehadiran

CREATE TABLE pengguna (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  no_pekerja  TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  nama        TEXT    NOT NULL,
  unit        TEXT    NOT NULL DEFAULT '',
  peranan     TEXT    NOT NULL DEFAULT 'pegawai' CHECK (peranan IN ('pegawai', 'penyelia')),
  pin_hash    TEXT    NOT NULL,
  pin_salt    TEXT    NOT NULL,
  tukar_pin   INTEGER NOT NULL DEFAULT 1,
  aktif       INTEGER NOT NULL DEFAULT 1,
  dicipta     INTEGER NOT NULL
);

CREATE TABLE sesi (
  token_hash  TEXT    PRIMARY KEY,
  pengguna_id INTEGER,              -- NULL = pentadbir utama (kata laluan ADMIN_PASSWORD)
  peranan     TEXT    NOT NULL,
  tamat       INTEGER NOT NULL
);
CREATE INDEX sesi_tamat ON sesi (tamat);

CREATE TABLE cubaan (
  kunci        TEXT    PRIMARY KEY,
  gagal        INTEGER NOT NULL DEFAULT 0,
  kunci_hingga INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE kehadiran (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  pengguna_id      INTEGER NOT NULL REFERENCES pengguna (id),
  tarikh           TEXT    NOT NULL,          -- YYYY-MM-DD waktu Malaysia
  status           TEXT    NOT NULL DEFAULT 'hadir'
                   CHECK (status IN ('hadir', 'cuti', 'mc', 'kursus', 'lain')),
  masuk            INTEGER,                   -- epoch ms
  masuk_lat        REAL,
  masuk_lng        REAL,
  masuk_ketepatan  REAL,
  masuk_catatan    TEXT,
  keluar           INTEGER,
  keluar_lat       REAL,
  keluar_lng       REAL,
  keluar_ketepatan REAL,
  keluar_catatan   TEXT,
  catatan_penyelia TEXT,
  UNIQUE (pengguna_id, tarikh)
);
CREATE INDEX kehadiran_tarikh ON kehadiran (tarikh);
