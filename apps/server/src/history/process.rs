use std::process::Output;
use std::time::Duration;

const OUTPUT_LIMIT: usize = 512 * 1024;

pub(crate) async fn command_output_with_timeout(
    command: &mut tokio::process::Command,
    duration: Duration,
) -> Result<Result<Output, std::io::Error>, ()> {
    match crate::process::command_output(command, duration, OUTPUT_LIMIT).await {
        Ok(output) => Ok(Ok(output)),
        Err(error) if error == "Command timed out" => Err(()),
        Err(error) => Ok(Err(crate::process::io_error(error))),
    }
}
