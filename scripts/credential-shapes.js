'use strict';
// The two credential shapes guard-secret-value.js judges a literal by, for repo tooling that is not
// a hook. The hook is copied into projects as a standalone file and cannot require this one, so the
// lines are COPIES, pinned to the hook by meta/shared-rules.json (credential-literal-shapes,
// credential-literal-pem): edit the hook first, then here. No g flag - a g-flagged regex keeps
// lastIndex between .test calls and misses every other hit.
const SECRET_SHAPE = /\b(sntryu_[0-9a-f]{16,}|ctx7sk-[0-9a-f-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|glpat-[0-9A-Za-z_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;
const PEM_PRIVATE = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;

module.exports = { SECRET_SHAPE, PEM_PRIVATE };
