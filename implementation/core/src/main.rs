use std::io::{self, Read};

use ssk_core::process_json;

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| format!("failed to read request: {error}"))?;

    print!("{}", process_json(&input).map_err(|error| error.to_string())?);
    Ok(())
}
