use std::sync::mpsc;
use tauri::{AppHandle, Manager};

const HUD_WINDOW_LABEL: &str = "main";

#[tauri::command]
pub fn set_hud_visibility(
    app: AppHandle,
    visible: bool,
    click_through: bool,
) -> Result<(), String> {
    let window = app
        .get_webview_window(HUD_WINDOW_LABEL)
        .ok_or_else(|| "HUD window not found".to_string())?;
    let (sender, receiver) = mpsc::sync_channel(1);

    // Tauri executes this inline when already on the main thread; otherwise the
    // channel waits for the queued closure, keeping native window operations ordered.
    app.run_on_main_thread(move || {
        let result = apply_hud_visibility(&window, visible, click_through);
        if sender.send(result).is_err() {
            log::error!("[hud-window] Failed to return main-thread result");
        }
    })
    .map_err(|error| format!("Failed to schedule HUD visibility update: {error}"))?;

    receiver
        .recv()
        .map_err(|error| format!("Failed to receive HUD visibility result: {error}"))?
}

fn apply_hud_visibility(
    window: &tauri::WebviewWindow,
    visible: bool,
    click_through: bool,
) -> Result<(), String> {
    if !visible {
        return window
            .hide()
            .map_err(|error| format!("Failed to hide HUD: {error}"));
    }

    // Keep native repair last: tao rewrites the complete GWL_EXSTYLE when
    // show/click-through changes, which can discard HUD invariants and DWM blur.
    window
        .show()
        .map_err(|error| format!("Failed to show HUD: {error}"))?;
    window
        .set_ignore_cursor_events(click_through)
        .map_err(|error| format!("Failed to set HUD click-through: {error}"))?;

    #[cfg(target_os = "windows")]
    restore_windows_hud(window, true);

    Ok(())
}

#[cfg(target_os = "windows")]
pub fn configure_windows_hud_window(window: &tauri::WebviewWindow) {
    restore_windows_hud(window, false);
}

#[cfg(target_os = "windows")]
fn required_hud_ex_style(ex_style: u32) -> u32 {
    use windows::Win32::UI::WindowsAndMessaging::{WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW};

    ex_style | WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0
}

#[cfg(target_os = "windows")]
fn restore_windows_hud(window: &tauri::WebviewWindow, recover_visibility: bool) {
    use std::ffi::c_void;
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Dwm::{
        DwmEnableBlurBehindWindow, DwmGetWindowAttribute, DWMWA_CLOAKED, DWM_BB_BLURREGION,
        DWM_BB_ENABLE, DWM_BLURBEHIND,
    };
    use windows::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, IsIconic, IsWindowVisible,
        SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    };

    let hwnd = match window.hwnd() {
        Ok(hwnd) => hwnd,
        Err(error) => {
            log::error!("[hud-window] Failed to get HWND: {error}");
            return;
        }
    };

    unsafe {
        let visible = IsWindowVisible(hwnd).as_bool();
        let iconic = IsIconic(hwnd).as_bool();
        let mut rect = RECT::default();
        let _ = GetWindowRect(hwnd, &mut rect);
        let mut cloaked = 0_u32;
        let _ = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut c_void,
            std::mem::size_of::<u32>() as u32,
        );

        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        log::info!(
            "[hud-window] visible={visible} iconic={iconic} cloaked=0x{cloaked:x} \
             topmost={} toolwindow={} noactivate={} exstyle=0x{ex_style:x} \
             rect=({},{},{},{}) foreground={:?}",
            ex_style & WS_EX_TOPMOST.0 != 0,
            ex_style & WS_EX_TOOLWINDOW.0 != 0,
            ex_style & WS_EX_NOACTIVATE.0 != 0,
            rect.left,
            rect.top,
            rect.right,
            rect.bottom,
            GetForegroundWindow(),
        );

        if cloaked != 0 {
            log::warn!(
                "[hud-window] DWM-cloaked (0x{cloaked:x}); shell cloak cannot be forced open"
            );
        }

        if recover_visibility && (!visible || iconic) {
            log::warn!(
                "[hud-window] not-visible/minimized (visible={visible} iconic={iconic}) \
                 -> SW_SHOWNOACTIVATE"
            );
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }

        let repaired_ex_style = required_hud_ex_style(ex_style);
        if repaired_ex_style != ex_style {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, repaired_ex_style as isize);
        }

        if let Err(error) = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        ) {
            log::warn!("[hud-window] Failed to restore topmost/invariants: {error}");
        }

        let applied_ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let required_bits = required_hud_ex_style(0);
        if applied_ex_style & required_bits != required_bits {
            log::warn!(
                "[hud-window] Native invariants did not stick: expected=0x{required_bits:x} \
                 actual=0x{applied_ex_style:x}"
            );
        }

        let region = CreateRectRgn(0, 0, -1, -1);
        if region.is_invalid() {
            log::warn!(
                "[hud-window] Failed to create blur region: {}",
                windows::core::Error::from_win32()
            );
            return;
        }

        let blur = DWM_BLURBEHIND {
            dwFlags: DWM_BB_ENABLE | DWM_BB_BLURREGION,
            fEnable: true.into(),
            hRgnBlur: region,
            fTransitionOnMaximized: false.into(),
        };
        match DwmEnableBlurBehindWindow(hwnd, &blur) {
            Ok(()) => {
                log::info!(
                    "[hud-window] Restored DWM transparency: exstyle=0x{applied_ex_style:x}"
                );
            }
            Err(error) => {
                log::warn!("[hud-window] Failed to restore DWM transparency: {error}");
            }
        }
        if !DeleteObject(region.into()).as_bool() {
            log::warn!(
                "[hud-window] Failed to delete blur region: {}",
                windows::core::Error::from_win32()
            );
        }
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::required_hud_ex_style;
    use windows::Win32::UI::WindowsAndMessaging::{
        WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    #[test]
    fn required_style_restores_native_hud_invariants() {
        let original = WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0;
        let repaired = required_hud_ex_style(original);

        assert_ne!(repaired & WS_EX_TOOLWINDOW.0, 0);
        assert_ne!(repaired & WS_EX_NOACTIVATE.0, 0);
        assert_ne!(repaired & WS_EX_LAYERED.0, 0);
        assert_ne!(repaired & WS_EX_TRANSPARENT.0, 0);
    }
}
