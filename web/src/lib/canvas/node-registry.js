// Node's strip-types test runner requires an explicit runtime extension.
// Production bundlers still resolve the typed registry behind this facade.
export * from "./node-registry.ts";
