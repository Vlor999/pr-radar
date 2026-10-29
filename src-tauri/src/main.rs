// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // shim MCP stdio : avant le builder Tauri (single-instance focaliserait l'app et quitterait)
    if std::env::args().skip(1).any(|a| a == "--mcp") {
        std::process::exit(pr_radar_lib::mcp::run_shim());
    }
    pr_radar_lib::run()
}
