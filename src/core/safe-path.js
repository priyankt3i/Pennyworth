const fs = require("fs");
const path = require("path");

// Reject links in every existing component, including parent directories. Never
// silently follow a user-selected alias to a different file for approval.
function checkedPath(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || !path.isAbsolute(value)) {
    throw new Error("An absolute file path is required.");
  }
  const resolved = path.resolve(value);
  const root = path.parse(resolved).root;
  let current = root;
  for (const component of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Symbolic links are not permitted for file operations.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return resolved;
}
function openRegularFile(value) {
  const filepath = checkedPath(value);
  const parent = process.platform === "linux" ? openParent(filepath) : null;
  let fd;
  try { fd = fs.openSync(parent ? parent.anchored : filepath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)); }
  finally { if (parent) fs.closeSync(parent.fd); }
  const stat = fs.fstatSync(fd);
  if (!stat.isFile()) {
    fs.closeSync(fd);
    throw new Error("Only regular files can be read.");
  }
  return { fd, stat, filepath };
}
module.exports = { checkedPath, openRegularFile };

// Linux descriptor-relative traversal: each directory is opened without following
// links. Keeping the final directory FD prevents parent-renaming races from
// redirecting an approved operation to a different directory.
function openParent(value) {
  const filepath = checkedPath(value);
  if (process.platform !== "linux") {
    // Platforms without descriptor-relative support retain no-follow validation;
    // do not enable direct writes there until equivalent guarantees are tested.
    throw new Error("Guarded direct file operations currently require Linux.");
  }
  let fd = fs.openSync("/", fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try {
    for (const part of path.dirname(filepath).split("/").filter(Boolean)) {
      const next = fs.openSync(`/proc/self/fd/${fd}/${part}`, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      fs.closeSync(fd);
      fd = next;
    }
    return { fd, filepath, anchored: `/proc/self/fd/${fd}/${path.basename(filepath)}` };
  } catch (error) { fs.closeSync(fd); throw error; }
}
module.exports.openParent = openParent;
