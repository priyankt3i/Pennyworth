# Pacman Troubleshooting

Common patterns:

- Database lock issue:
  - Check no package manager is currently running.
  - Remove stale lock only when safe: `sudo rm /var/lib/pacman/db.lck`

- Partial upgrade risk:
  - Never install random packages without syncing package databases.
  - Prefer one transaction: `sudo pacman -Syu <package>`

- Search and inspect:
  - Search package: `pacman -Ss <name>`
  - Show package details: `pacman -Si <name>`
  - List installed package files: `pacman -Ql <name>`
