# Windows + WSL Local Development Workflow

This guide helps Windows users set up a robust local development environment for the Stellar Portfolio Rebalancer using Windows Subsystem for Linux (WSL).

## 1. WSL Installation Recommendations

We highly recommend using WSL 2 with Ubuntu 22.04 LTS.

1. Open PowerShell as Administrator.
2. Run: `wsl --install -d Ubuntu-22.04`
3. Restart your computer if prompted.
4. Open the "Ubuntu 22.04" app from your start menu and complete the initial user setup.

## 2. Git Setup for Windows

To avoid line-ending issues between Windows and Linux environments, configure Git on Windows **before** cloning the repository:

```cmd
git config --global core.autocrlf false
git config --global core.eol lf
```
*Note: Always clone your repositories inside the WSL filesystem (e.g., `~/projects/`), NOT on the Windows `/mnt/c/` filesystem. Cross-OS file IO is significantly slower and causes permission issues.*

## 3. Node.js Version Management

Install Node.js 18+ inside WSL using `nvm` (Node Version Manager):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# Restart your terminal or source ~/.bashrc
nvm install 18
nvm use 18
nvm alias default 18
```

## 4. Rust + Soroban Installation

Install Rust and the WebAssembly target inside WSL:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown
```

Install Soroban CLI:
```bash
cargo install --locked soroban-cli
```

*Cargo Cache Handling:* Cargo caches can grow large. Run `cargo clean` inside the `contracts/` directory occasionally if you run out of WSL disk space.

## 5. Environment Variable Handling

Ensure your `.env` files are created inside WSL. You can edit them using VS Code (see Terminal Recommendations).

## 6. Docker Notes

If you use Docker Desktop for Windows, ensure you enable the "WSL 2 based engine" and enable integration with your specific WSL distro (e.g., Ubuntu-22.04) in Docker Desktop Settings -> Resources -> WSL Integration.

## 7. Terminal and IDE Recommendations

- **Terminal:** Use [Windows Terminal](https://apps.microsoft.com/store/detail/windows-terminal/9N0DX20HK701). Set the default profile to your WSL Ubuntu distribution.
- **IDE:** Use [Visual Studio Code](https://code.visualstudio.com/) with the "WSL" extension.
  - Open your WSL terminal, navigate to your project directory, and type `code .` to open the project in VS Code running natively in WSL.

## 8. Common Issues and Fixes

### CRLF/LF Problems
If you see `\r` errors in shell scripts (`install.sh`, `Makefile`), run:
```bash
sudo apt install dos2unix
dos2unix script.sh
```

### Permission Issues
If you get `EACCES` errors with npm or node, **do not** use `sudo npm`. Instead, ensure your project is in your WSL home directory (`~/`) and check ownership:
```bash
sudo chown -R $USER:$USER ~/stellar-portfolio-rebalancer
```

### Localhost Networking
Services running on `localhost` in WSL are automatically forwarded to Windows `localhost`. You can access the frontend at `http://localhost:3000` from your Windows browser. If it fails, check your Windows Firewall settings to allow the WSL network profile.
