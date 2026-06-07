use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    println!("cargo:rustc-check-cfg=cfg(hoshi_dicts_linked)");
    println!("cargo:rerun-if-changed=src/dict/dict_capi.cpp");
    println!("cargo:rerun-if-changed=src/dict/dict_capi.h");
    println!("cargo:rerun-if-env-changed=HSW_HOSHIDICTS_DIR");

    if let Err(err) = try_link_hoshidicts() {
        println!("cargo:warning=hoshidicts backend disabled: {err}");
    }

    tauri_build::build()
}

fn try_link_hoshidicts() -> Result<(), String> {
    let cmake = find_program("cmake").ok_or_else(|| "cmake was not found in PATH".to_string())?;
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?);
    let hoshidicts_dir = env::var_os("HSW_HOSHIDICTS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            manifest_dir
                .join("..")
                .join("third_party")
                .join("hoshidicts")
        });
    let hoshidicts_dir = hoshidicts_dir
        .canonicalize()
        .map_err(|e| format!("cannot resolve hoshidicts dir: {e}"))?;
    let hoshidicts_dir = cmake_compatible_path(hoshidicts_dir);
    let utfcpp_cpp11_header = hoshidicts_dir
        .join("external")
        .join("utfcpp")
        .join("source")
        .join("utf8")
        .join("cpp11.h");
    if !hoshidicts_dir.join("CMakeLists.txt").is_file() {
        return Err(format!(
            "hoshidicts CMakeLists.txt was not found at {}",
            hoshidicts_dir.display()
        ));
    }
    if !utfcpp_cpp11_header.is_file() {
        return Err(format!(
            "utfcpp cpp11.h was not found at {}",
            utfcpp_cpp11_header.display()
        ));
    }

    let out_dir = PathBuf::from(env::var("OUT_DIR").map_err(|e| e.to_string())?);
    let build_dir = out_dir.join("hoshidicts-build");
    let profile = if env::var("PROFILE").unwrap_or_default() == "release" {
        "Release"
    } else {
        "Debug"
    };

    let mut configure = Command::new(&cmake);
    configure
        .arg("-S")
        .arg(&hoshidicts_dir)
        .arg("-B")
        .arg(&build_dir)
        .arg(format!("-DCMAKE_BUILD_TYPE={profile}"));
    #[cfg(windows)]
    configure.arg("-DCMAKE_C_FLAGS_INIT=/utf-8").arg(format!(
        "-DCMAKE_CXX_FLAGS_INIT=/utf-8 /FI\"{}\"",
        utfcpp_cpp11_header.display()
    ));
    run(&mut configure)?;
    run(Command::new(&cmake)
        .arg("--build")
        .arg(&build_dir)
        .arg("--config")
        .arg(profile)
        .arg("--target")
        .arg("hoshidicts"))?;

    cc::Build::new()
        .cpp(true)
        .file(manifest_dir.join("src").join("dict").join("dict_capi.cpp"))
        .include(hoshidicts_dir.join("include"))
        .include(
            hoshidicts_dir
                .join("external")
                .join("utfcpp")
                .join("source"),
        )
        .include(hoshidicts_dir.join("external").join("xxHash"))
        .flag_if_supported("/utf-8")
        .flag_if_supported("/EHsc")
        .flag_if_supported("/std:c++latest")
        .flag_if_supported("-std=c++23")
        .compile("dict_capi_bridge");

    let libraries = collect_static_libraries(&build_dir)?;
    for dir in collect_library_dirs(&libraries) {
        println!("cargo:rustc-link-search=native={}", dir.display());
    }

    link_library("hoshidicts", &libraries);
    for library in libraries {
        let stem = library
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if stem != "hoshidicts" {
            println!("cargo:rustc-link-lib=static={stem}");
        }
    }
    println!("cargo:rustc-cfg=hoshi_dicts_linked");
    Ok(())
}

fn cmake_compatible_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(stripped) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{stripped}"));
        }
        if let Some(stripped) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    path
}

fn find_program(name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    env::split_paths(&path).find_map(|dir| {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        let exe = dir.join(format!("{name}.exe"));
        exe.is_file().then_some(exe)
    })
}

fn run(command: &mut Command) -> Result<(), String> {
    let program = command.get_program().to_string_lossy().into_owned();
    let args = command
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(" ");
    let status = command
        .status()
        .map_err(|e| format!("failed to run {program}: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{program} {args} exited with {status}"))
    }
}

fn collect_static_libraries(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut libraries = Vec::new();
    collect_static_libraries_inner(root, &mut libraries)?;
    if libraries.is_empty() {
        return Err(format!(
            "no static libraries found under {}",
            root.display()
        ));
    }
    Ok(libraries)
}

fn collect_static_libraries_inner(dir: &Path, libraries: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_static_libraries_inner(&path, libraries)?;
        } else if matches!(
            path.extension().and_then(|value| value.to_str()),
            Some("lib" | "a")
        ) {
            libraries.push(path);
        }
    }
    Ok(())
}

fn collect_library_dirs(libraries: &[PathBuf]) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for library in libraries {
        if let Some(parent) = library.parent() {
            let parent = parent.to_path_buf();
            if !dirs.contains(&parent) {
                dirs.push(parent);
            }
        }
    }
    dirs
}

fn link_library(name: &str, libraries: &[PathBuf]) {
    if libraries
        .iter()
        .any(|library| library.file_stem().and_then(|value| value.to_str()) == Some(name))
    {
        println!("cargo:rustc-link-lib=static={name}");
    }
}
