//! Native application menu — port of src/main/src/app-menu.ts.
//! Custom item ids are the action strings; clicks are emitted to the webview
//! as a "se-menu" event, re-dispatched there as the CustomEvent('se-menu')
//! useMenuAction already listens for.
//!
//! Platform notes: the app submenu (About/Hide/…), the Window submenu, and
//! the Undo/Redo/Hide predefined items are macOS-only in muda — on Linux and
//! Windows we fold About + Quit into File and skip the rest.

use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{App, Emitter, Wry};

pub fn build(app: &App) -> tauri::Result<Menu<Wry>> {
    let handle = app.handle();

    let item = |id: &str, label: &str, accel: Option<&str>| {
        let mut b = MenuItemBuilder::with_id(id, label);
        if let Some(a) = accel {
            b = b.accelerator(a);
        }
        b.build(handle)
    };

    let mut menu = MenuBuilder::new(handle);

    #[cfg(target_os = "macos")]
    let app_menu = SubmenuBuilder::new(handle, "Surface Evolver")
        .item(&PredefinedMenuItem::about(handle, None, Some(AboutMetadata::default()))?)
        .separator()
        .item(&PredefinedMenuItem::hide(handle, None)?)
        .item(&PredefinedMenuItem::hide_others(handle, None)?)
        .item(&PredefinedMenuItem::show_all(handle, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(handle, None)?)
        .build()?;
    #[cfg(target_os = "macos")]
    {
        menu = menu.item(&app_menu);
    }

    #[allow(unused_mut)] // mutated only on non-macOS
    let mut file = SubmenuBuilder::new(handle, "File")
        .item(&item("file:reload", "Reload Surface", Some("CmdOrCtrl+Shift+R"))?);
    #[cfg(not(target_os = "macos"))]
    {
        file = file
            .separator()
            .item(&PredefinedMenuItem::about(handle, None, Some(AboutMetadata::default()))?)
            .item(&PredefinedMenuItem::quit(handle, None)?);
    }
    let file = file.build()?;

    #[allow(unused_mut)] // mutated only on macOS
    let mut edit = SubmenuBuilder::new(handle, "Edit");
    #[cfg(target_os = "macos")]
    {
        edit = edit
            .item(&PredefinedMenuItem::undo(handle, None)?)
            .item(&PredefinedMenuItem::redo(handle, None)?)
            .separator();
    }
    let edit = edit
        .item(&PredefinedMenuItem::cut(handle, None)?)
        .item(&PredefinedMenuItem::copy(handle, None)?)
        .item(&PredefinedMenuItem::paste(handle, None)?)
        .item(&PredefinedMenuItem::select_all(handle, None)?)
        .build()?;

    let render = SubmenuBuilder::new(handle, "Render")
        .item(&item("render:solid", "Solid", None)?)
        .item(&item("render:wireframe", "Wireframe", None)?)
        .item(&item("render:xray", "X-Ray", None)?)
        .build()?;

    let view = SubmenuBuilder::new(handle, "View")
        .item(&item("view:sidebar", "Toggle Explorer", Some("CmdOrCtrl+B"))?)
        .separator()
        .item(&render)
        .separator()
        .item(&item("panel:quants", "Quantities & Energy", None)?)
        .item(&item("panel:settings", "Mesh & Physics Settings", None)?)
        .item(&item("panel:inspect", "Inspect / Pick", None)?)
        .build()?;

    let run = SubmenuBuilder::new(handle, "Run")
        .item(&item("iterate:10", "Iterate ×10", Some("CmdOrCtrl+G"))?)
        .item(&item("iterate:100", "Iterate ×100", Some("CmdOrCtrl+Shift+G"))?)
        .separator()
        .item(&item("run:refine", "Refine", Some("CmdOrCtrl+R"))?)
        .item(&item("run:equi", "Equiangulate", Some("CmdOrCtrl+U"))?)
        .item(&item("run:vertex_avg", "Vertex Average", Some("CmdOrCtrl+E"))?)
        .item(&item("run:pop", "Pop", None)?)
        .build()?;

    menu = menu.item(&file).item(&edit).item(&view).item(&run);

    #[cfg(target_os = "macos")]
    {
        let window = SubmenuBuilder::new(handle, "Window")
            .item(&PredefinedMenuItem::minimize(handle, None)?)
            .item(&PredefinedMenuItem::maximize(handle, None)?)
            .build()?;
        menu = menu.item(&window);
    }

    menu.build()
}

pub fn on_event(app: &tauri::AppHandle, id: &str) {
    // Predefined items handle themselves; anything with a ":" is ours.
    if id.contains(':') {
        let _ = app.emit("se-menu", id);
    }
}
