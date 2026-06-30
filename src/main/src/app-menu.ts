/**
 * Native application menu (macOS menu bar + accelerators).
 *
 * Menu clicks carry a string `action` that is forwarded verbatim to the webview
 * as a `se-menu` CustomEvent; the React side routes it (see useMenuAction).
 * This surfaces every existing feature — render modes, topology ops,
 * iteration, panels — through the OS-native menu and keyboard shortcuts.
 */
import Electrobun, { type BrowserWindow } from "electrobun/bun";

// `any` for the menu config — Electrobun's ApplicationMenuItemConfig is loosely
// typed and a precise shape here adds noise without safety.
function menuConfig(): unknown[] {
  return [
    {
      label: "Surface Evolver",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "Reload Surface", action: "file:reload", accelerator: "CmdOrCtrl+Shift+R" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" },
        { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Explorer", action: "view:sidebar", accelerator: "CmdOrCtrl+B" },
        { type: "separator" },
        {
          label: "Render",
          submenu: [
            { label: "Solid",     action: "render:solid" },
            { label: "Wireframe", action: "render:wireframe" },
            { label: "X-Ray",     action: "render:xray" },
          ],
        },
        { type: "separator" },
        { label: "Quantities & Energy", action: "panel:quants" },
        { label: "Mesh & Physics Settings", action: "panel:settings" },
        { label: "Inspect / Pick", action: "panel:inspect" },
      ],
    },
    {
      label: "Run",
      submenu: [
        { label: "Iterate ×10",  action: "iterate:10",  accelerator: "CmdOrCtrl+G" },
        { label: "Iterate ×100", action: "iterate:100", accelerator: "CmdOrCtrl+Shift+G" },
        { type: "separator" },
        { label: "Refine",        action: "run:refine",     accelerator: "CmdOrCtrl+R" },
        { label: "Equiangulate",  action: "run:equi",       accelerator: "CmdOrCtrl+U" },
        { label: "Vertex Average", action: "run:vertex_avg", accelerator: "CmdOrCtrl+E" },
        { label: "Pop",           action: "run:pop" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }],
    },
  ];
}

export function installAppMenu(win: BrowserWindow): void {
  Electrobun.ApplicationMenu.setApplicationMenu(menuConfig() as never);
  Electrobun.ApplicationMenu.on("application-menu-clicked", (e: unknown) => {
    const action = (e as { data?: { action?: string } })?.data?.action;
    if (!action) return;
    win.webview.executeJavascript(
      `window.dispatchEvent(new CustomEvent('se-menu', { detail: ${JSON.stringify(action)} }))`,
    );
  });
}
