const express = require("express");
const { body, validationResult } = require("express-validator");

const app = express();
app.use(express.json());

const db = {
  blogs: [],
  posts: [],
};

let blogIdCounter = 1;
let postIdCounter = 1;

const createErrorsMessages = (errors) => ({ errorsMessages: errors });

const getBasicAuthCredentials = (authHeader) => {
  if (typeof authHeader !== "string" || !authHeader.startsWith("Basic ")) {
    return null;
  }

  const encoded = authHeader.slice("Basic ".length);
  let decoded;

  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return null;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return null;

  return {
    login: decoded.slice(0, separatorIndex),
    password: decoded.slice(separatorIndex + 1),
  };
};

const requireAdminAuth = (req, res, next) => {
  const credentials = getBasicAuthCredentials(req.headers.authorization);
  if (!credentials || credentials.login !== "admin" || credentials.password !== "qwerty") {
    res.sendStatus(401);
    return;
  }
  next();
};

const handleValidationErrors = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) {
    next();
    return;
  }

  const errors = result.array({ onlyFirstError: true }).map((error) => ({
    message: error.msg,
    field: error.path,
  }));

  res.status(400).send(createErrorsMessages(errors));
};

const blogValidators = [
  body("name").isString().withMessage("Invalid name").trim().isLength({ min: 1, max: 15 }).withMessage("Invalid name"),
  body("description")
    .isString()
    .withMessage("Invalid description")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Invalid description"),
  body("websiteUrl")
    .isString()
    .withMessage("Invalid websiteUrl")
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Invalid websiteUrl")
    .isURL({ require_protocol: true, protocols: ["https"] })
    .withMessage("Invalid websiteUrl"),
];

const postValidators = [
  body("title").isString().withMessage("Invalid title").trim().isLength({ min: 1, max: 30 }).withMessage("Invalid title"),
  body("shortDescription")
    .isString()
    .withMessage("Invalid shortDescription")
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Invalid shortDescription"),
  body("content")
    .isString()
    .withMessage("Invalid content")
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage("Invalid content"),
  body("blogId")
    .isString()
    .withMessage("Invalid blogId")
    .bail()
    .custom((blogId) => db.blogs.some((blog) => blog.id === blogId))
    .withMessage("Invalid blogId"),
];

const router = express.Router();

router.get("/blogs", (req, res) => {
  res.status(200).send(db.blogs);
});

router.post("/blogs", requireAdminAuth, blogValidators, handleValidationErrors, (req, res) => {
  const blog = {
    id: String(blogIdCounter++),
    name: req.body.name.trim(),
    description: req.body.description.trim(),
    websiteUrl: req.body.websiteUrl.trim(),
  };

  db.blogs.push(blog);
  res.status(201).send(blog);
});

router.get("/blogs/:id", (req, res) => {
  const foundBlog = db.blogs.find((blog) => blog.id === req.params.id);
  if (!foundBlog) {
    res.sendStatus(404);
    return;
  }
  res.status(200).send(foundBlog);
});

router.put("/blogs/:id", requireAdminAuth, blogValidators, handleValidationErrors, (req, res) => {
  const foundBlog = db.blogs.find((blog) => blog.id === req.params.id);
  if (!foundBlog) {
    res.sendStatus(404);
    return;
  }

  foundBlog.name = req.body.name.trim();
  foundBlog.description = req.body.description.trim();
  foundBlog.websiteUrl = req.body.websiteUrl.trim();
  res.sendStatus(204);
});

router.delete("/blogs/:id", requireAdminAuth, (req, res) => {
  const blogIndex = db.blogs.findIndex((blog) => blog.id === req.params.id);
  if (blogIndex === -1) {
    res.sendStatus(404);
    return;
  }

  db.blogs.splice(blogIndex, 1);
  db.posts = db.posts.filter((post) => post.blogId !== req.params.id);
  res.sendStatus(204);
});

router.get("/posts", (req, res) => {
  res.status(200).send(db.posts);
});

router.post("/posts", requireAdminAuth, postValidators, handleValidationErrors, (req, res) => {
  const blog = db.blogs.find((item) => item.id === req.body.blogId);
  const post = {
    id: String(postIdCounter++),
    title: req.body.title.trim(),
    shortDescription: req.body.shortDescription.trim(),
    content: req.body.content.trim(),
    blogId: req.body.blogId,
    blogName: blog.name,
  };

  db.posts.push(post);
  res.status(201).send(post);
});

router.get("/posts/:id", (req, res) => {
  const foundPost = db.posts.find((post) => post.id === req.params.id);
  if (!foundPost) {
    res.sendStatus(404);
    return;
  }
  res.status(200).send(foundPost);
});

router.put("/posts/:id", requireAdminAuth, postValidators, handleValidationErrors, (req, res) => {
  const foundPost = db.posts.find((post) => post.id === req.params.id);
  if (!foundPost) {
    res.sendStatus(404);
    return;
  }

  const blog = db.blogs.find((item) => item.id === req.body.blogId);
  foundPost.title = req.body.title.trim();
  foundPost.shortDescription = req.body.shortDescription.trim();
  foundPost.content = req.body.content.trim();
  foundPost.blogId = req.body.blogId;
  foundPost.blogName = blog.name;
  res.sendStatus(204);
});

router.delete("/posts/:id", requireAdminAuth, (req, res) => {
  const postIndex = db.posts.findIndex((post) => post.id === req.params.id);
  if (postIndex === -1) {
    res.sendStatus(404);
    return;
  }

  db.posts.splice(postIndex, 1);
  res.sendStatus(204);
});

router.delete("/testing/all-data", (req, res) => {
  db.blogs = [];
  db.posts = [];
  blogIdCounter = 1;
  postIdCounter = 1;
  res.sendStatus(204);
});

app.get("/", (req, res) => {
  res.status(200).send("Hello world!");
});

app.use("", router);
app.use("/ht_02/api", router);
app.use("/api/index.js", router);

module.exports = app;
