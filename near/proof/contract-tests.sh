#!/usr/bin/env bash
# Proof 1 of 2: every contract test for the splits router.
#
#   bash near/proof/contract-tests.sh            # uses your Rust if it can, Docker otherwise
#   bash near/proof/contract-tests.sh --docker   # always Docker (rust:1.89-trixie)
#
# Runs the router's unit tests, then the sandbox test: a local NEAR node with the real TEST DOLLAR
# token, paying splits through ft_transfer_call. The toolchain (Rust 1.95, wasm32 target) comes from
# near/splits-router/rust-toolchain.toml. The sandbox needs glibc 2.38 or newer, which is why the
# Docker path uses a Debian trixie image. Proof 2 (testnet-proof.mjs) then runs the live router's
# exact code on testnet.
set -euo pipefail
NEAR_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# The sandbox test builds both contracts with `cargo near`; install the version the router was built
# with if it is missing.
inner='set -euo pipefail
if ! cargo near --version >/dev/null 2>&1; then
  echo "== Installing cargo-near 0.23.0"
  curl --proto "=https" --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/download/cargo-near-v0.23.0/cargo-near-installer.sh | sh
  export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
fi
cd test-token && { [ -f Cargo.lock ] || cargo generate-lockfile; } && cd ..
cd splits-router
echo "== Unit tests"
cargo test --lib
echo "== Sandbox test (local NEAR node, real token)"
cargo test --test "*" -- --nocapture
echo "== All contract tests passed"'

glibc_ok() {
  command -v ldd >/dev/null || return 1
  local v
  v="$(ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+$' || true)"
  [ -n "$v" ] && [ "$(printf '%s\n2.38\n' "$v" | sort -V | head -1)" = "2.38" ]
}

if [ "${1:-}" != "--docker" ] && command -v cargo >/dev/null && command -v rustup >/dev/null && glibc_ok; then
  echo "Using local Rust ($(cargo --version))"
  (cd "$NEAR_DIR" && bash -c "$inner")
else
  command -v docker >/dev/null || { echo "Needs Rust (rustup, glibc 2.38+) or Docker." >&2; exit 1; }
  echo "Using Docker (rust:1.89-trixie); the first run downloads the image and Rust 1.95"
  docker run --rm -v "$NEAR_DIR":/work -w /work \
    -e CARGO_HOME=/work/.cargo-home -e RUSTUP_HOME=/work/.rustup-home -e CARGO_TARGET_DIR=/work/target \
    rust:1.89-trixie bash -c "export PATH=/work/.cargo-home/bin:/usr/local/cargo/bin:\$PATH
mkdir -p /work/.cargo-home/bin && cp -n /usr/local/cargo/bin/rustup /work/.cargo-home/bin/ 2>/dev/null || true
$inner; chown -R $(id -u):$(id -g) /work/target /work/.cargo-home /work/.rustup-home 2>/dev/null || true"
fi
