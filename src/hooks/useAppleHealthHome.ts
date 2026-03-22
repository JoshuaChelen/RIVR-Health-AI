// Apple Health state is now managed by AppleHealthContext (single shared instance).
// This file is kept so that any stale import compiles without error.
export { useAppleHealth as useAppleHealthHome } from "../context/AppleHealthContext";
