//! Offline migration utility. Exit the desktop application before running.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 2 { return Err("usage: migrate-desktop <home-directory> <legacy-data-directory>".into()); }
    workflowgenerator_server::data_layout::desktop_root(std::path::Path::new(&args[0]), std::path::Path::new(&args[1]))?;
    println!("Data copied and verified; legacy source preserved.");
    Ok(())
}
