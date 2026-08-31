ALTER TABLE terminal_workspaces
ADD COLUMN active_terminal_id_nullable TEXT CHECK (active_terminal_id_nullable <> '');

UPDATE terminal_workspaces
SET active_terminal_id_nullable = active_terminal_id;

ALTER TABLE terminal_workspaces
DROP COLUMN active_terminal_id;

ALTER TABLE terminal_workspaces
RENAME COLUMN active_terminal_id_nullable TO active_terminal_id;
