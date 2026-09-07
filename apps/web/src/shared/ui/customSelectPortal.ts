const portalSelector = "[data-custom-select-portal]"

export const CUSTOM_SELECT_OPEN_CHANGE_EVENT = "devhatch:custom-select-open-change"

export function dispatchCustomSelectOpenChange(trigger: HTMLElement | null, open: boolean) {
  trigger?.dispatchEvent(new CustomEvent(CUSTOM_SELECT_OPEN_CHANGE_EVENT, { bubbles: true, detail: open }))
}

function getPortal(target: EventTarget | null) {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null
  return element?.closest<HTMLElement>(portalSelector) ?? null
}

function isPortalOwnedBy(owner: Element | null, portal: HTMLElement | null) {
  const triggerId = portal?.dataset.customSelectTrigger
  const trigger = triggerId ? document.getElementById(triggerId) : null
  return Boolean(owner && trigger && owner.contains(trigger))
}

export function isCustomSelectPortalOwnedBy(owner: Element | null, target: EventTarget | null) {
  return isPortalOwnedBy(owner, getPortal(target))
}

export function isCustomSelectOwnedBy(owner: Element | null, target: EventTarget | null) {
  return Boolean(owner && target instanceof Node && owner.contains(target)) || isCustomSelectPortalOwnedBy(owner, target)
}

export function hasOpenCustomSelectPortalOwnedBy(owner: Element | null) {
  if (!owner) return false
  return Array.from(document.querySelectorAll<HTMLElement>(portalSelector)).some((portal) => (
    isPortalOwnedBy(owner, portal) && Boolean(portal.querySelector('[data-slot="select-content"][data-open], [data-slot="dropdown-menu-content"][data-open]'))
  ))
}
