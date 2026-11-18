use rusty_leveldb::{Options, DB};
use std::{collections::BTreeMap, fs, path::Path};

// Chromium uses a one-byte string tag followed by Latin-1 or little-endian UTF-16.
fn decode(bytes: &[u8]) -> Result<String, String> {
    match bytes.split_first() {
        Some((1, raw)) => Ok(raw.iter().map(|&b| char::from(b)).collect()),
        Some((0, raw)) if raw.len() % 2 == 0 => {
            let units: Vec<_> = raw.chunks_exact(2).map(|p| u16::from_le_bytes([p[0], p[1]])).collect();
            String::from_utf16(&units).map_err(|_| "Некорректная строка сохранения".into())
        }
        _ => Err("Неизвестный формат сохранения".into()),
    }
}

pub fn read(dir: &Path) -> Result<BTreeMap<String, String>, String> {
    let mut values = BTreeMap::new();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(values),
        Err(e) => return Err(e.to_string()),
    };
    // LevelDB replays its journal on open. Only let it write inside a private temporary copy.
    let copy = tempfile::tempdir().map_err(|e| e.to_string())?;
    for item in entries {
        let item = item.map_err(|e| e.to_string())?;
        if item.file_type().map_err(|e| e.to_string())?.is_file() && item.file_name() != "LOCK" {
            fs::copy(item.path(), copy.path().join(item.file_name())).map_err(|e| e.to_string())?;
        }
    }
    let mut db = DB::open(copy.path(), Options { create_if_missing: false, paranoid_checks: true, ..Default::default() })
        .map_err(|e| e.to_string())?;
    let snapshot = db.get_snapshot();
    for key in ["profile", "settings", "snapshot", "lastConfig", "seenVersion"] {
        let name = format!("river.{key}");
        let storage_key = format!("_file://\0\x01{name}");
        if let Some(bytes) = db.get_at(&snapshot, storage_key.as_bytes()).map_err(|e| e.to_string())? {
            let value = decode(&bytes)?;
            serde_json::from_str::<serde_json::Value>(&value).map_err(|_| "Не удалось прочитать данные игры".to_string())?;
            values.insert(name, value);
        }
    }
    Ok(values)
}
