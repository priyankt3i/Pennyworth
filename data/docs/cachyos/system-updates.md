# CachyOS Updates

Use these commands on CachyOS (Arch family):

- Full system update: `sudo pacman -Syu`
- Refresh mirrors if package resolution fails: `sudo pacman -S cachyos-rate-mirrors && cachyos-rate-mirrors`
- Rebuild keyring when signature checks fail: `sudo pacman -Sy archlinux-keyring cachyos-keyring`

If update fails due to file conflicts, inspect each conflicting path before forcing overwrite.
