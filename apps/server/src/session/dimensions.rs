pub(crate) fn dimension(value: Option<&serde_json::Value>, fallback: u16) -> u16 {
    let number = value
        .and_then(value_to_number)
        .unwrap_or(f64::from(fallback));
    if !number.is_finite() {
        return fallback;
    }
    number.trunc().clamp(1.0, 500.0) as u16
}

fn value_to_number(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::String(value) => value.trim().parse().ok().or_else(|| {
            if value.trim().is_empty() {
                Some(0.0)
            } else {
                None
            }
        }),
        serde_json::Value::Bool(value) => Some(u8::from(*value).into()),
        serde_json::Value::Null => Some(0.0),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::dimension;

    #[test]
    fn normalizes_dimensions() {
        assert_eq!(dimension(Some(&serde_json::json!(0)), 120), 1);
        assert_eq!(dimension(Some(&serde_json::json!(501)), 120), 500);
        assert_eq!(dimension(Some(&serde_json::json!(" 20.9 ")), 120), 20);
        assert_eq!(dimension(Some(&serde_json::json!([])), 120), 120);
    }
}
