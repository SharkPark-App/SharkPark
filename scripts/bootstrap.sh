#!/usr/bin/env bash
#
# SharkPark first-time setup
# ─────────────────────────────────────────────────────────────────────────────
# Idempotent — safe to re-run anytime. Brings a fresh clone to the point where
# `pnpm install && pnpm dev` will work end-to-end.
#
# What it does (in order):
#   1. Verify required tooling (Homebrew, Node, pnpm, Docker)
#   2. Install rbenv + ruby-build (macOS only) and the project's pinned Ruby
#   3. Install the bundler version pinned in apps/mobile/Gemfile.lock
#   4. Run `bundle install` for the mobile app's Ruby gems (CocoaPods etc.)
#   5. Symlink apps/backend/.env -> ../../.env so the backend picks up env vars
#   6. Print next steps
#
# Re-running is safe: every step short-circuits if already done.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

OK="\033[0;32m[OK]\033[0m"
INFO="\033[0;36m[..]\033[0m"
WARN="\033[1;33m[!!]\033[0m"
FAIL="\033[0;31m[FAIL]\033[0m"

log()    { echo -e "$INFO $*"; }
ok()     { echo -e "$OK $*"; }
warn()   { echo -e "$WARN $*"; }
fatal()  { echo -e "$FAIL $*" >&2; exit 1; }

is_macos() { [[ "$(uname -s)" == "Darwin" ]]; }

# ── 1. Required tooling ─────────────────────────────────────────────────────
log "Checking required tooling..."

command -v node    >/dev/null 2>&1 || fatal "node not found. Install Node.js >= 20."
command -v pnpm    >/dev/null 2>&1 || fatal "pnpm not found. Run: corepack enable && corepack prepare pnpm@10.20.0 --activate"
command -v docker  >/dev/null 2>&1 || fatal "docker not found. Install Docker Desktop."

if is_macos; then
  command -v brew >/dev/null 2>&1 || fatal "Homebrew not found. Install from https://brew.sh"
fi
ok "Tooling present."

# ── 2. rbenv + Ruby (macOS only — Linux/CI uses system Ruby) ────────────────
if is_macos; then
  if ! command -v rbenv >/dev/null 2>&1; then
    log "Installing rbenv + ruby-build..."
    brew install rbenv ruby-build
  fi

  # Make rbenv usable in this shell regardless of ~/.zshrc state
  eval "$(rbenv init - bash)" 2>/dev/null || eval "$(rbenv init -)"

  RUBY_PINNED="$(cat apps/mobile/.ruby-version 2>/dev/null || echo '')"
  if [[ -z "$RUBY_PINNED" ]]; then
    fatal "apps/mobile/.ruby-version is missing. Run 'rbenv local <version>' inside apps/mobile/ first."
  fi

  if ! rbenv versions --bare | grep -qx "$RUBY_PINNED"; then
    log "Installing Ruby $RUBY_PINNED (this can take a few minutes)..."
    rbenv install "$RUBY_PINNED"
  fi
  ok "Ruby $RUBY_PINNED installed."

  # Activate the pinned Ruby for the rest of this script
  export RBENV_VERSION="$RUBY_PINNED"

  # Ensure rbenv init is in zshrc so future shells pick it up automatically
  if [[ -f "$HOME/.zshrc" ]] && ! grep -q "rbenv init" "$HOME/.zshrc"; then
    log "Adding rbenv init to ~/.zshrc..."
    {
      echo ''
      echo '# rbenv (Ruby version manager) — added by SharkPark scripts/bootstrap.sh'
      echo 'eval "$(rbenv init - zsh)"'
    } >> "$HOME/.zshrc"
    warn "Open a new terminal (or 'source ~/.zshrc') so rbenv shims load in your shell."
  fi
fi

# ── 3. Bundler matching Gemfile.lock ────────────────────────────────────────
if is_macos; then
  GEMFILE_LOCK="apps/mobile/Gemfile.lock"
  if [[ ! -f "$GEMFILE_LOCK" ]]; then
    fatal "$GEMFILE_LOCK missing — cannot determine bundler version."
  fi
  BUNDLER_PINNED="$(awk '/^BUNDLED WITH$/{getline; print $1}' "$GEMFILE_LOCK")"
  if [[ -z "$BUNDLER_PINNED" ]]; then
    fatal "Could not parse BUNDLED WITH from $GEMFILE_LOCK."
  fi

  if ! gem list bundler -i -v "$BUNDLER_PINNED" >/dev/null 2>&1; then
    log "Installing bundler $BUNDLER_PINNED..."
    gem install "bundler:$BUNDLER_PINNED"
  fi
  ok "Bundler $BUNDLER_PINNED installed."

  # ── 4. Ruby gems for the mobile app ───────────────────────────────────────
  log "Running bundle install for apps/mobile..."
  (cd apps/mobile && bundle install)
  ok "Mobile Ruby gems installed."
fi

# ── 5. Backend .env symlink ─────────────────────────────────────────────────
BACKEND_ENV="apps/backend/.env"
ROOT_ENV=".env"
if [[ ! -f "$ROOT_ENV" ]]; then
  if [[ -f ".env.example" ]]; then
    warn "Root .env missing. Copy .env.example to .env and fill in values:"
    warn "    cp .env.example .env"
  else
    warn "Root .env missing and no .env.example to copy from."
  fi
fi

if [[ -e "$BACKEND_ENV" || -L "$BACKEND_ENV" ]]; then
  if [[ -L "$BACKEND_ENV" ]]; then
    ok "Backend .env symlink already in place."
  else
    warn "$BACKEND_ENV exists as a regular file, not a symlink. Leaving it alone."
  fi
else
  ln -s ../../.env "$BACKEND_ENV"
  ok "Created $BACKEND_ENV -> ../../.env"
fi

# ── 6. Done ────────────────────────────────────────────────────────────────
echo ""
ok "Bootstrap complete."
echo ""
echo "Next steps:"
echo "  1. If you haven't already: cp .env.example .env && \$EDITOR .env"
echo "     (DEVICE_HASH_SALT and DEVICE_EVENT_SECRET: 'openssl rand -hex 32')"
echo "  2. pnpm install         # installs deps + brings up Postgres/MinIO + migrates + seeds"
echo "  3. pnpm dev             # starts backend + mobile in parallel"
echo "     (or: pnpm --filter @sharkpark/backend dev   /   pnpm --filter mobile ios)"
