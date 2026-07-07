// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod menu;
mod rpc;
mod worker;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(rpc::AppState::default())
        .invoke_handler(tauri::generate_handler![rpc::rpc])
        .setup(|app| {
            let m = menu::build(app)?;
            app.set_menu(m)?;
            app.on_menu_event(|handle, event| menu::on_event(handle, event.id().as_ref()));
            Ok(())
        })
        .on_window_event(|window, event| {
            // App quit = worker orphaned otherwise (it blocks on stdin read).
            if let tauri::WindowEvent::Destroyed = event {
                let state: tauri::State<rpc::AppState> = window.app_handle().state();
                state.manager.kill();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
