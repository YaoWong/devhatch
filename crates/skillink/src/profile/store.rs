use crate::{Error, Profile, Result, Skill, Skillink};
use sqlx::{Sqlite, Transaction};

pub(super) async fn insert_profile(
    transaction: &mut Transaction<'_, Sqlite>,
    id: &str,
    slug: &str,
) -> Result<()> {
    sqlx::query("INSERT INTO profiles (id, slug) VALUES (?, ?)")
        .bind(id)
        .bind(slug)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

pub(super) async fn list_profiles(app: &Skillink) -> Result<Vec<Profile>> {
    Ok(
        sqlx::query_as::<_, Profile>("SELECT id, slug FROM profiles ORDER BY slug")
            .fetch_all(app.pool())
            .await?,
    )
}

pub(super) async fn resolve_profile(app: &Skillink, identifier: &str) -> Result<Profile> {
    sqlx::query_as::<_, Profile>(
        "SELECT id, slug FROM profiles WHERE id = ? OR slug = ? COLLATE NOCASE",
    )
    .bind(identifier)
    .bind(identifier)
    .fetch_optional(app.pool())
    .await?
    .ok_or_else(|| Error::NotFound(format!("profile {identifier}")))
}

pub(super) async fn profile_skills(app: &Skillink, profile_id: &str) -> Result<Vec<Skill>> {
    Ok(sqlx::query_as::<_, Skill>(
        "SELECT s.id, s.slug, s.description, s.source_type, s.repository_id, s.revision, s.relative_path FROM skills s JOIN profile_skills ps ON ps.skill_id = s.id WHERE ps.profile_id = ? ORDER BY s.slug",
    )
    .bind(profile_id)
    .fetch_all(app.pool())
    .await?)
}

pub(super) async fn enable_skill(app: &Skillink, profile_id: &str, skill_id: &str) -> Result<()> {
    sqlx::query("INSERT OR IGNORE INTO profile_skills (profile_id, skill_id) VALUES (?, ?)")
        .bind(profile_id)
        .bind(skill_id)
        .execute(app.pool())
        .await?;
    Ok(())
}

pub(super) async fn disable_skill(app: &Skillink, profile_id: &str, skill_id: &str) -> Result<()> {
    sqlx::query("DELETE FROM profile_skills WHERE profile_id = ? AND skill_id = ?")
        .bind(profile_id)
        .bind(skill_id)
        .execute(app.pool())
        .await?;
    Ok(())
}

pub(super) async fn replace_skills(
    app: &Skillink,
    profile_id: &str,
    skill_ids: &[String],
) -> Result<()> {
    let mut transaction = app.pool().begin().await?;
    sqlx::query("DELETE FROM profile_skills WHERE profile_id = ?")
        .bind(profile_id)
        .execute(&mut *transaction)
        .await?;
    for skill_id in skill_ids {
        sqlx::query("INSERT INTO profile_skills (profile_id, skill_id) VALUES (?, ?)")
            .bind(profile_id)
            .bind(skill_id)
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await?;
    Ok(())
}
