// forum.js - tiny file-based forum store: data/forum.json (+ data/forum-images/).
// A post: { id, authorId, title, body, createdAt, imageExt, comments: [...] }
// A comment: { id, authorId, body, createdAt }

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "forum.json");
const IMG_DIR = path.join(DATA_DIR, "forum-images");

function load() {
  try {
    const posts = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(posts) ? posts : [];
  } catch {
    return [];
  }
}

function save(posts) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(posts, null, 2), "utf8");
}

const newId = () => crypto.randomBytes(6).toString("hex");

function listPosts() {
  return load().sort((a, b) => b.createdAt - a.createdAt);
}

function getPost(id) {
  return load().find((p) => p.id === String(id)) || null;
}

// image = { buf, ext } or null
function createPost({ authorId, title, body, image }) {
  const posts = load();
  const post = {
    id: newId(),
    authorId,
    title,
    body,
    createdAt: Date.now(),
    imageExt: image ? image.ext : null,
    comments: [],
  };
  if (image) {
    fs.mkdirSync(IMG_DIR, { recursive: true });
    fs.writeFileSync(path.join(IMG_DIR, `${post.id}.${image.ext}`), image.buf);
  }
  posts.push(post);
  save(posts);
  return post;
}

function addComment(postId, { authorId, body }) {
  const posts = load();
  const post = posts.find((p) => p.id === String(postId));
  if (!post) return null;
  const comment = { id: newId(), authorId, body, createdAt: Date.now() };
  post.comments.push(comment);
  save(posts);
  return comment;
}

function imagePath(post) {
  if (!post || !post.imageExt) return null;
  const file = path.join(IMG_DIR, `${post.id}.${post.imageExt}`);
  return fs.existsSync(file) ? file : null;
}

function deletePost(id) {
  const posts = load();
  const post = posts.find((p) => p.id === String(id));
  if (!post) return false;
  const img = imagePath(post);
  if (img) {
    try { fs.rmSync(img, { force: true }); } catch { /* ignore */ }
  }
  save(posts.filter((p) => p.id !== post.id));
  return true;
}

function deleteComment(postId, commentId) {
  const posts = load();
  const post = posts.find((p) => p.id === String(postId));
  if (!post) return false;
  const before = post.comments.length;
  post.comments = post.comments.filter((c) => c.id !== String(commentId));
  if (post.comments.length === before) return false;
  save(posts);
  return true;
}

module.exports = { listPosts, getPost, createPost, addComment, deletePost, deleteComment, imagePath };
