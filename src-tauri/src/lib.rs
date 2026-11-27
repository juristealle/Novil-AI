use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize, Deserialize)]
struct LicensePayload {
    machine_id: String,
    tier: String,
}

#[derive(Serialize, Deserialize)]
struct LicenseFile {
    payload: String,
    signature: String,
}

const PUBLIC_KEY_HEX: &str = "2282400fec0fe61ec9d3843cda382aa326b33e5677aaa6e3ed2ad84c51545bf1";

fn log_to_file(path: &std::path::Path, msg: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(f, "{}", msg);
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_available_ram() -> u64 {
    let mut sys = sysinfo::System::new_all();
    sys.refresh_memory();
    sys.available_memory() / (1024 * 1024 * 1024)
}

#[tauri::command]
fn verify_license(license_data: String, machine_id: String) -> bool {
    println!("--- VERIFY LICENSE ---");
    println!("Machine ID from app: {}", machine_id);

    let lic: LicenseFile = match serde_json::from_str(&license_data) {
        Ok(l) => l,
        Err(e) => {
            println!("Failed to parse JSON: {}", e);
            return false;
        }
    };

    let payload_bytes = match BASE64.decode(&lic.payload) {
        Ok(b) => b,
        Err(e) => {
            println!("Failed to decode payload: {}", e);
            return false;
        }
    };

    let sig_bytes = match hex::decode(&lic.signature) {
        Ok(b) => b,
        Err(e) => {
            println!("Failed to decode signature: {}", e);
            return false;
        }
    };

    let pk_bytes = match hex::decode(PUBLIC_KEY_HEX) {
        Ok(b) => b,
        Err(e) => {
            println!("Failed to decode public key: {}", e);
            return false;
        }
    };

    let pk_array: [u8; 32] = match pk_bytes.try_into() {
        Ok(a) => a,
        Err(_) => {
            println!("Public key is not 32 bytes");
            return false;
        }
    };

    let public_key = match VerifyingKey::from_bytes(&pk_array) {
        Ok(pk) => pk,
        Err(e) => {
            println!("Invalid public key: {}", e);
            return false;
        }
    };

    let signature = match Signature::from_slice(&sig_bytes) {
        Ok(s) => s,
        Err(e) => {
            println!("Invalid signature: {}", e);
            return false;
        }
    };

    if public_key.verify(&payload_bytes, &signature).is_err() {
        println!("Signature verification FAILED - keys do not match");
        return false;
    }

    let parsed_payload: LicensePayload = match serde_json::from_slice(&payload_bytes) {
        Ok(p) => p,
        Err(e) => {
            println!("Failed to parse payload: {}", e);
            return false;
        }
    };

    println!("Payload machine_id: {}", parsed_payload.machine_id);
    println!("App machine_id: {}", machine_id);
    println!("Tier: {}", parsed_payload.tier);

    let result = parsed_payload.machine_id == machine_id && parsed_payload.tier == "pro";
    println!("Final result: {}", result);
    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = match app.path().app_local_data_dir() {
                Ok(p) => p,
                Err(_) => return Ok(()),
            };

            let log_file = app_data_dir.join("debug_log.txt");
            log_to_file(&log_file, "--- APP STARTED ---");

            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                use std::process::Command;
                let _ = Command::new("taskkill")
                    .args(["/F", "/IM", "ollama-x86_64-pc-windows-msvc.exe", "/T"])
                    .creation_flags(0x08000000)
                    .output();
                let _ = Command::new("taskkill")
                    .args(["/F", "/IM", "ollama.exe", "/T"])
                    .creation_flags(0x08000000)
                    .output();
            }

            let models_path = app_data_dir.join("models");
            if let Err(e) = std::fs::create_dir_all(&models_path) {
                log_to_file(&log_file, &format!("Create dir failed: {}", e));
                return Ok(());
            }

            let exe_path = match std::env::current_exe() {
                Ok(p) => p,
                Err(_) => return Ok(()),
            };

            let exe_dir = match exe_path.parent() {
                Some(p) => p,
                None => return Ok(()),
            };

            let binaries_dir = match app
                .path()
                .resolve("binaries", tauri::path::BaseDirectory::Resource)
            {
                Ok(p) => p,
                Err(e) => {
                    log_to_file(
                        &log_file,
                        &format!("FATAL: Could not resolve binaries dir: {}", e),
                    );
                    return Ok(());
                }
            };

            let ollama_exe = binaries_dir.join("ollama-x86_64-pc-windows-msvc.exe");
            let ollama_lib_dir = binaries_dir.join("lib").join("ollama");

            if !ollama_exe.exists() {
                log_to_file(
                    &log_file,
                    &format!("FATAL: Could not find {:?}", ollama_exe),
                );
                return Ok(());
            }

            log_to_file(&log_file, &format!("SPAWNING EXE: {:?}", ollama_exe));

            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                let mut command = std::process::Command::new(&ollama_exe);

                command.current_dir(&binaries_dir);

                let mut paths = std::env::var_os("PATH").unwrap_or_default();
                paths.push(";");
                paths.push(&binaries_dir);
                paths.push(";");
                paths.push(&ollama_lib_dir);
                command.env("PATH", paths);

                command
                    .arg("serve")
                    .env("OLLAMA_HOST", "127.0.0.1:11435")
                    .env("OLLAMA_MODELS", &models_path)
                    .env("OLLAMA_FLASH_ATTENTION", "1")
                    .env("OLLAMA_ORIGINS", "*")
                    .creation_flags(0x08000000);

                match command.spawn() {
                    Ok(mut child) => {
                        log_to_file(&log_file, "OLLAMA SPAWNED SUCCESSFULLY VIA STD::PROCESS");
                        let child_id = child.id();

                        let async_log_file = log_file.clone();
                        std::thread::spawn(move || match child.wait() {
                            Ok(status) => {
                                log_to_file(
                                    &async_log_file,
                                    &format!(
                                        "OLLAMA EXITED. Status: {:?}, Code: {:?}",
                                        status,
                                        status.code()
                                    ),
                                );
                            }
                            Err(e) => {
                                log_to_file(&async_log_file, &format!("OLLAMA WAIT ERROR: {}", e));
                            }
                        });
                    }
                    Err(e) => {
                        log_to_file(&log_file, &format!("FATAL: Spawn failed: {}", e));
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_available_ram,
            verify_license
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit { .. } = event {
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    use std::process::Command;
                    let _ = Command::new("taskkill")
                        .args(["/F", "/IM", "ollama-x86_64-pc-windows-msvc.exe", "/T"])
                        .creation_flags(0x08000000)
                        .output();
                    let _ = Command::new("taskkill")
                        .args(["/F", "/IM", "ollama.exe", "/T"])
                        .creation_flags(0x08000000)
                        .output();
                }
            }
        });
}
