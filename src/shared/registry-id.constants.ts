// WHY: the registries share one id namespace (a `/m/<id>` link and an analytics item id name either), so their ids
// share one grammar.
export const REGISTRY_ID_RE = /^[a-z0-9-]+$/;
