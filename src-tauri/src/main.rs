// Prevents an extra console window on Windows in release builds. DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use sysinfo::{Disks, System};
use tauri::State;

struct Monitor {
    sys: Mutex<System>,
    disks: Mutex<Disks>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Stats {
    cpu: f32,
    gpu: Option<f32>,
    mem_used: u64,
    mem_total: u64,
    disk_used: u64,
    disk_total: u64,
    disk_free: u64,
}

/// Reads Apple Silicon GPU utilization from the IORegistry (no sudo needed).
fn gpu_usage() -> Option<f32> {
    for class in ["AGXAccelerator", "AppleGPU", "IOAccelerator"] {
        let Ok(out) = Command::new("ioreg")
            .args(["-r", "-d", "1", "-c", class])
            .output()
        else {
            continue;
        };
        if !out.status.success() {
            continue;
        }
        let text = String::from_utf8_lossy(&out.stdout);
        if let Some(v) = parse_device_utilization(&text) {
            return Some(v);
        }
    }
    None
}

fn parse_device_utilization(text: &str) -> Option<f32> {
    const KEY: &str = "\"Device Utilization %\"";
    let idx = text.find(KEY)? + KEY.len();
    let rest = text[idx..].trim_start().strip_prefix('=')?.trim_start();
    let num: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    num.parse().ok()
}

fn collect(m: &Monitor) -> Stats {
    let (cpu, mem_used, mem_total) = {
        let mut sys = m.sys.lock().unwrap();
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        (
            sys.global_cpu_usage(),
            sys.used_memory(),
            sys.total_memory(),
        )
    };

    let (disk_total, disk_free) = {
        let mut disks = m.disks.lock().unwrap();
        disks.refresh(true);
        disks
            .iter()
            .find(|d| d.mount_point() == Path::new("/"))
            .map(|d| (d.total_space(), d.available_space()))
            .unwrap_or((0, 0))
    };

    Stats {
        cpu,
        gpu: gpu_usage(),
        mem_used,
        mem_total,
        disk_used: disk_total.saturating_sub(disk_free),
        disk_total,
        disk_free,
    }
}

#[tauri::command]
async fn get_stats(state: State<'_, Arc<Monitor>>) -> Result<Stats, String> {
    let monitor = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || collect(&monitor))
        .await
        .map_err(|e| e.to_string())
}

fn main() {
    let monitor = Arc::new(Monitor {
        sys: Mutex::new(System::new_all()),
        disks: Mutex::new(Disks::new_with_refreshed_list()),
    });

    tauri::Builder::default()
        .manage(monitor)
        .invoke_handler(tauri::generate_handler![get_stats])
        .run(tauri::generate_context!())
        .expect("error while running MiniMon");
}
