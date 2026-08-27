use crate::history::HistoryBackend;

pub(crate) const CODEX_ID: &str = "codex";
pub(crate) const CODEX_NAME: &str = "Codex";
pub(crate) const OPENCODE_ID: &str = "opencode";
pub(crate) const OPENCODE_NAME: &str = "OpenCode";
pub(crate) const TRAECLI_ID: &str = "traecli";
pub(crate) const TRAECLI_NAME: &str = "Trae CLI";
pub(crate) const PI_ID: &str = "pi";
pub(crate) const PI_NAME: &str = "Pi Agent";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AgentKind {
    Codex,
    OpenCode,
    TraeCli,
    Pi,
}

impl AgentKind {
    pub(crate) const ALL: [Self; 4] = [Self::Codex, Self::OpenCode, Self::TraeCli, Self::Pi];

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Codex => CODEX_ID,
            Self::OpenCode => OPENCODE_ID,
            Self::TraeCli => TRAECLI_ID,
            Self::Pi => PI_ID,
        }
    }

    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::Codex => CODEX_NAME,
            Self::OpenCode => OPENCODE_NAME,
            Self::TraeCli => TRAECLI_NAME,
            Self::Pi => PI_NAME,
        }
    }

    pub(crate) const fn diagnostic(self) -> &'static str {
        match self {
            Self::Codex => "CODEX_NOT_FOUND",
            Self::OpenCode => "OPENCODE_NOT_FOUND",
            Self::TraeCli => "TRAECLI_NOT_FOUND",
            Self::Pi => "PI_NOT_FOUND",
        }
    }

    pub(crate) const fn history_backend(self) -> HistoryBackend {
        match self {
            Self::Codex => HistoryBackend::Codex,
            Self::OpenCode => HistoryBackend::OpenCode,
            Self::TraeCli => HistoryBackend::Trae,
            Self::Pi => HistoryBackend::Pi,
        }
    }
}

impl TryFrom<&str> for AgentKind {
    type Error = ();

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            CODEX_ID => Ok(Self::Codex),
            OPENCODE_ID => Ok(Self::OpenCode),
            TRAECLI_ID => Ok(Self::TraeCli),
            PI_ID => Ok(Self::Pi),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Copy)]
pub(super) struct AgentDefinition {
    pub(super) kind: AgentKind,
    pub(super) supports_resume: bool,
    pub(super) supports_skills: bool,
}

pub(super) const AGENTS: [AgentDefinition; 4] = [
    AgentDefinition {
        kind: AgentKind::Codex,
        supports_resume: true,
        supports_skills: true,
    },
    AgentDefinition {
        kind: AgentKind::OpenCode,
        supports_resume: true,
        supports_skills: true,
    },
    AgentDefinition {
        kind: AgentKind::TraeCli,
        supports_resume: true,
        supports_skills: true,
    },
    AgentDefinition {
        kind: AgentKind::Pi,
        supports_resume: true,
        supports_skills: true,
    },
];

pub(crate) fn supported(agent_id: &str) -> bool {
    AgentKind::try_from(agent_id).is_ok()
}

pub(super) fn definition(kind: AgentKind) -> AgentDefinition {
    AGENTS
        .iter()
        .copied()
        .find(|agent| agent.kind == kind)
        .expect("every agent kind has a definition")
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{AgentKind, CODEX_ID, OPENCODE_ID, PI_ID, TRAECLI_ID, definition, supported};
    use crate::history::HistoryBackend;

    #[test]
    fn agent_ids_are_stable_and_unique() {
        assert_eq!(
            AgentKind::ALL.map(AgentKind::as_str),
            [CODEX_ID, OPENCODE_ID, TRAECLI_ID, PI_ID]
        );
        assert_eq!(
            AgentKind::ALL
                .into_iter()
                .map(AgentKind::as_str)
                .collect::<HashSet<_>>()
                .len(),
            AgentKind::ALL.len()
        );
    }

    #[test]
    fn parses_built_in_agents_and_rejects_unknown_ids() {
        for kind in AgentKind::ALL {
            assert_eq!(AgentKind::try_from(kind.as_str()), Ok(kind));
            assert!(supported(kind.as_str()));
            assert_eq!(definition(kind).kind, kind);
        }
        assert_eq!(AgentKind::try_from("unknown"), Err(()));
        assert!(!supported("unknown"));
    }

    #[test]
    fn history_backend_mapping_is_stable() {
        assert!(matches!(
            AgentKind::Codex.history_backend(),
            HistoryBackend::Codex
        ));
        assert!(matches!(
            AgentKind::OpenCode.history_backend(),
            HistoryBackend::OpenCode
        ));
        assert!(matches!(
            AgentKind::TraeCli.history_backend(),
            HistoryBackend::Trae
        ));
        assert!(matches!(
            AgentKind::Pi.history_backend(),
            HistoryBackend::Pi
        ));
    }
}
