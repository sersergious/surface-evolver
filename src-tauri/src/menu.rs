//! Native application menu — port of src/main/src/app-menu.ts.
//! Custom item ids are the action strings; clicks are emitted to the webview
//! as a "se-menu" event, re-dispatched there as the CustomEvent('se-menu')
//! useMenuAction already listens for.
//!
//! Platform notes: the app submenu (About/Hide/…), the Window submenu, and
//! the Undo/Redo/Hide predefined items are macOS-only in muda — on Linux we
//! fold About + Quit into File and skip the rest.

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
        .item(&item("panel:inspect", "Inspect / Pick", None)?)
        .build()?;

    let mac = cfg!(target_os = "macos");
    let run = SubmenuBuilder::new(handle, "Run")
        .item(&item("iterate:10", "Iterate ×10", surface_op_accel("CmdOrCtrl+G", mac))?)
        .item(&item("iterate:100", "Iterate ×100", surface_op_accel("CmdOrCtrl+Shift+G", mac))?)
        .separator()
        .item(&item("run:refine", "Refine", surface_op_accel("CmdOrCtrl+R", mac))?)
        .item(&item("run:equi", "Equiangulate", surface_op_accel("CmdOrCtrl+U", mac))?)
        .item(&item("run:vertex_avg", "Vertex Average", surface_op_accel("CmdOrCtrl+E", mac))?)
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

/// The accelerator for a Run-menu item that changes the surface, or none off
/// macOS (#28). There CmdOrCtrl is Ctrl, and Ctrl+R/U/E/G are keys people
/// press while typing (readline keys in the CLI, CodeMirror's Mod-u), so a
/// native accelerator would run an irreversible refine or equiangulate
/// mid-sentence. On macOS they are Cmd, which typing never sends. The items
/// stay in the menu either way.
fn surface_op_accel(accel: &'static str, macos: bool) -> Option<&'static str> {
    macos.then_some(accel)
}

#[cfg(test)]
mod tests {
    use super::surface_op_accel;

    #[test]
    fn surface_ops_have_no_accelerator_on_linux() {
        // #28: on Linux CmdOrCtrl is Ctrl, and Ctrl+R/U/E/G are typing keys.
        assert_eq!(surface_op_accel("CmdOrCtrl+R", true), Some("CmdOrCtrl+R"));
        assert_eq!(surface_op_accel("CmdOrCtrl+R", false), None);
    }
}
