// Sin consola extra en Windows al abrir la app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    autofirma_web_lib::run()
}
