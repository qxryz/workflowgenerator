#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="workflowgenerator"
APP_BUNDLE="$ROOT_DIR/src-tauri/target/release/bundle/macos/WorkflowGenerator.app"

cd "$ROOT_DIR"

pkill -x "$APP_NAME" >/dev/null 2>&1 || true

sign_bundle() {
    /usr/bin/codesign --force --deep --sign - --timestamp=none "$APP_BUNDLE"
}

case "$MODE" in
  run)
    exec bunx --no-install tauri dev
    ;;
  --debug|debug)
    RUST_BACKTRACE=1 RUST_LOG=debug exec bunx --no-install tauri dev
    ;;
  --logs|logs)
    RUST_LOG=debug exec bunx --no-install tauri dev
    ;;
  --telemetry|telemetry)
    RUST_LOG=info exec bunx --no-install tauri dev
    ;;
  --verify|verify)
    bunx --no-install tauri build --bundles app
    test -d "$APP_BUNDLE"
    sign_bundle
    /usr/bin/codesign --verify --deep --strict "$APP_BUNDLE"
    /usr/bin/open -n "$APP_BUNDLE"
    sleep 1
    pgrep -x "$APP_NAME" >/dev/null
    ;;
  --build|build)
    bunx --no-install tauri build --bundles app
    test -d "$APP_BUNDLE"
    sign_bundle
    ;;
  *)
    echo "usage: $0 [run|--build|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
