mod agent;
mod auth;
mod clock;
mod filesystem;
mod history;
mod launch_config;
mod launch_path;
mod router;
mod server;
mod session;
mod session_socket;
mod skillink;
mod state;
mod terminal;
mod web_app;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    server::run().await
}
