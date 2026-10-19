import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { app, Menu, nativeImage, Tray } from "electron"

import { nativeT } from "./native-translations"

type TrayActions = {
  reveal: () => void
  newWindow: () => void
}

let tray: Tray | undefined
let actions: TrayActions | undefined

// Created the first time a window hides instead of closing, and kept until the
// app quits: the tray icon is the only way back to a hidden window. Returns
// false when the icon cannot be created so the caller can keep the window
// reachable instead of hiding it for good.
export function ensureTray(next: TrayActions) {
  actions = next
  if (tray) return true

  const image = trayIcon()
  if (image.isEmpty()) return false

  tray = new Tray(image)
  tray.on("click", () => actions?.reveal())
  tray.on("double-click", () => actions?.reveal())
  refreshTray()

  app.once("will-quit", () => {
    tray?.destroy()
    tray = undefined
    actions = undefined
  })
  return true
}

// Native menu labels come from the renderer translation bundle, which arrives
// after the tray may already exist.
export function refreshTray() {
  if (!tray || !actions) return
  tray.setToolTip(app.getName())
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: nativeT("desktop.menu.app"), click: () => actions?.reveal() },
      { type: "separator" },
      { label: nativeT("desktop.menu.newWindow"), click: () => actions?.newWindow() },
      { type: "separator" },
      { label: nativeT("desktop.recovery.action.quit"), click: () => app.quit() },
    ]),
  )
}

// Packaged builds carry the icons inside the asar, so read through fs rather
// than a filesystem path. Windows picks the tray size from the image, so keep
// the larger asset instead of hard-coding 16px.
function trayIcon() {
  const file = join(app.getAppPath(), "resources/icons/32x32.png")
  if (!existsSync(file)) return nativeImage.createEmpty()
  return nativeImage.createFromBuffer(readFileSync(file))
}
