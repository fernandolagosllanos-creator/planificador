// Evita que se abra una consola adicional en Windows en modo release. NO QUITAR.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    planificador_lib::run();
}
