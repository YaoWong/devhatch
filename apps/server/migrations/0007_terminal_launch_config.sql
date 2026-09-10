INSERT INTO agent_launch_configs (
    id,
    agent_id,
    name,
    is_default,
    pre_launch_script,
    provider_script,
    tui_script,
    created_at,
    updated_at
) VALUES (
    'terminal-default',
    'terminal',
    'Default',
    1,
    '',
    '',
    '',
    CAST(unixepoch('subsec') * 1000 AS INTEGER),
    CAST(unixepoch('subsec') * 1000 AS INTEGER)
);
