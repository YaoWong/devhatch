use super::initialized_repository;
use crate::Error;
use tempfile::TempDir;

#[tokio::test]
async fn renames_repository() {
    let temp = TempDir::new().unwrap();
    let (app, source, repository) =
        initialized_repository(&temp, "---\nname: alpha\ndescription: Alpha\n---\n").await;
    assert_eq!(repository.name, source.to_str().unwrap());

    let renamed = app
        .rename_repository(&repository.id, "Shared Skills")
        .await
        .unwrap();
    assert_eq!(renamed.name, "Shared Skills");
    assert_eq!(
        app.list_repositories().await.unwrap()[0].name,
        "Shared Skills"
    );
    assert!(matches!(
        app.rename_repository(&repository.id, "  ").await,
        Err(Error::InvalidRepositoryName)
    ));
}
