const express = require("express");
const { body, validationResult } = require("express-validator");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
app.use(express.json());

const fallbackMongoURI =
  "mongodb+srv://tinirait_db_user:FxhMOYau1YtxpzB9@cluster0.abcnv5v.mongodb.net/project_1?retryWrites=true&w=majority";
const mongoURI = process.env.MONGO_URL || fallbackMongoURI;
const client = new MongoClient(mongoURI, {
  serverSelectionTimeoutMS: 2000,
  connectTimeoutMS: 2000,
});
let collectionsPromise;
let shouldUseMemoryStore = false;

const memoryDb = {
  blogs: [],
  posts: [],
};

const matchesQuery = (doc, query) =>
  Object.entries(query).every(([key, value]) => {
    if (value instanceof ObjectId) {
      return String(doc[key]) === String(value);
    }
    return doc[key] === value;
  });

const createMemoryCollection = (collectionName) => ({
  find(query = {}) {
    return {
      async toArray() {
        return memoryDb[collectionName].filter((doc) => matchesQuery(doc, query));
      },
    };
  },
  async findOne(query) {
    return memoryDb[collectionName].find((doc) => matchesQuery(doc, query)) || null;
  },
  async insertOne(doc) {
    const insertedId = new ObjectId();
    memoryDb[collectionName].push({ _id: insertedId, ...doc });
    return { insertedId };
  },
  async updateOne(filter, update) {
    const index = memoryDb[collectionName].findIndex((doc) => matchesQuery(doc, filter));
    if (index === -1) {
      return { matchedCount: 0 };
    }
    memoryDb[collectionName][index] = {
      ...memoryDb[collectionName][index],
      ...(update.$set || {}),
    };
    return { matchedCount: 1 };
  },
  async deleteOne(filter) {
    const initialLength = memoryDb[collectionName].length;
    memoryDb[collectionName] = memoryDb[collectionName].filter((doc) => !matchesQuery(doc, filter));
    return { deletedCount: initialLength - memoryDb[collectionName].length };
  },
  async deleteMany(filter) {
    if (!filter || Object.keys(filter).length === 0) {
      const deletedCount = memoryDb[collectionName].length;
      memoryDb[collectionName] = [];
      return { deletedCount };
    }
    const initialLength = memoryDb[collectionName].length;
    memoryDb[collectionName] = memoryDb[collectionName].filter((doc) => !matchesQuery(doc, filter));
    return { deletedCount: initialLength - memoryDb[collectionName].length };
  },
});

const memoryCollections = {
  blogs: createMemoryCollection("blogs"),
  posts: createMemoryCollection("posts"),
};

const getCollections = async () => {
  if (shouldUseMemoryStore) {
    return memoryCollections;
  }

  if (!collectionsPromise) {
    collectionsPromise = client
      .connect()
      .then(() => {
        const db = client.db();
        return {
          blogs: db.collection("blogs"),
          posts: db.collection("posts"),
        };
      })
      .catch((error) => {
        // Keep API responsive in serverless even when Mongo is temporarily unavailable.
        console.error("Mongo connection failed, fallback to memory store:", error.message);
        shouldUseMemoryStore = true;
        return memoryCollections;
      });
  }

  return collectionsPromise;
};

const createErrorsMessages = (errors) => ({ errorsMessages: errors });
const mapBlog = (blog) => ({
  id: String(blog._id),
  name: blog.name,
  description: blog.description,
  websiteUrl: blog.websiteUrl,
  createdAt: blog.createdAt,
  isMembership: blog.isMembership,
});
const mapPost = (post) => ({
  id: String(post._id),
  title: post.title,
  shortDescription: post.shortDescription,
  content: post.content,
  blogId: post.blogId,
  blogName: post.blogName,
  createdAt: post.createdAt,
});

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
    .custom(async (blogId) => {
      if (!ObjectId.isValid(blogId)) return false;
      const { blogs } = await getCollections();
      const foundBlog = await blogs.findOne({ _id: new ObjectId(blogId) });
      return !!foundBlog;
    })
    .withMessage("Invalid blogId"),
];

const router = express.Router();

router.get("/blogs", async (req, res, next) => {
  try {
    const { blogs } = await getCollections();
    const blogsList = await blogs.find({}).toArray();
    res.status(200).send(blogsList.map(mapBlog));
  } catch (error) {
    next(error);
  }
});

router.post("/blogs", requireAdminAuth, blogValidators, handleValidationErrors, async (req, res, next) => {
  try {
    const { blogs } = await getCollections();
    const newBlog = {
      name: req.body.name.trim(),
      description: req.body.description.trim(),
      websiteUrl: req.body.websiteUrl.trim(),
      createdAt: new Date().toISOString(),
      isMembership: false,
    };

    const insertResult = await blogs.insertOne(newBlog);
    const createdBlog = await blogs.findOne({ _id: insertResult.insertedId });
    res.status(201).send(mapBlog(createdBlog));
  } catch (error) {
    next(error);
  }
});

router.get("/blogs/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.sendStatus(404);
      return;
    }

    const { blogs } = await getCollections();
    const foundBlog = await blogs.findOne({ _id: new ObjectId(req.params.id) });
    if (!foundBlog) {
      res.sendStatus(404);
      return;
    }
    res.status(200).send(mapBlog(foundBlog));
  } catch (error) {
    next(error);
  }
});

router.put("/blogs/:id", requireAdminAuth, blogValidators, handleValidationErrors, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.sendStatus(404);
      return;
    }

    const { blogs } = await getCollections();
    const updateResult = await blogs.updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          name: req.body.name.trim(),
          description: req.body.description.trim(),
          websiteUrl: req.body.websiteUrl.trim(),
        },
      },
    );

    if (!updateResult.matchedCount) {
      res.sendStatus(404);
      return;
    }

    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

router.delete("/blogs/:id", requireAdminAuth, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.sendStatus(404);
      return;
    }

    const { blogs, posts } = await getCollections();
    const blogObjectId = new ObjectId(req.params.id);
    const deleteResult = await blogs.deleteOne({ _id: blogObjectId });
    if (!deleteResult.deletedCount) {
      res.sendStatus(404);
      return;
    }

    await posts.deleteMany({ blogId: req.params.id });
    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

router.get("/posts", async (req, res, next) => {
  try {
    const { posts } = await getCollections();
    const postsList = await posts.find({}).toArray();
    res.status(200).send(postsList.map(mapPost));
  } catch (error) {
    next(error);
  }
});

router.post("/posts", requireAdminAuth, postValidators, handleValidationErrors, async (req, res, next) => {
  try {
    const { blogs, posts } = await getCollections();
    const blog = await blogs.findOne({ _id: new ObjectId(req.body.blogId) });
    if (!blog) {
      res.status(400).send(createErrorsMessages([{ message: "Invalid blogId", field: "blogId" }]));
      return;
    }

    const newPost = {
      title: req.body.title.trim(),
      shortDescription: req.body.shortDescription.trim(),
      content: req.body.content.trim(),
      blogId: req.body.blogId,
      blogName: blog.name,
      createdAt: new Date().toISOString(),
    };

    const insertResult = await posts.insertOne(newPost);
    const createdPost = await posts.findOne({ _id: insertResult.insertedId });
    res.status(201).send(mapPost(createdPost));
  } catch (error) {
    next(error);
  }
});

router.get("/posts/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.sendStatus(404);
      return;
    }

    const { posts } = await getCollections();
    const foundPost = await posts.findOne({ _id: new ObjectId(req.params.id) });
    if (!foundPost) {
      res.sendStatus(404);
      return;
    }
    res.status(200).send(mapPost(foundPost));
  } catch (error) {
    next(error);
  }
});

router.put("/posts/:id", requireAdminAuth, postValidators, handleValidationErrors, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.sendStatus(404);
      return;
    }

    const { blogs, posts } = await getCollections();
    const blog = await blogs.findOne({ _id: new ObjectId(req.body.blogId) });
    if (!blog) {
      res.status(400).send(createErrorsMessages([{ message: "Invalid blogId", field: "blogId" }]));
      return;
    }
    const updateResult = await posts.updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          title: req.body.title.trim(),
          shortDescription: req.body.shortDescription.trim(),
          content: req.body.content.trim(),
          blogId: req.body.blogId,
          blogName: blog.name,
        },
      },
    );

    if (!updateResult.matchedCount) {
      res.sendStatus(404);
      return;
    }

    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

router.delete("/posts/:id", requireAdminAuth, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.sendStatus(404);
      return;
    }

    const { posts } = await getCollections();
    const deleteResult = await posts.deleteOne({ _id: new ObjectId(req.params.id) });
    if (!deleteResult.deletedCount) {
      res.sendStatus(404);
      return;
    }

    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

router.delete("/testing/all-data", async (req, res, next) => {
  try {
    const { blogs, posts } = await getCollections();
    await Promise.all([blogs.deleteMany({}), posts.deleteMany({})]);
    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.get("/", (req, res) => {
  res.status(200).send("Hello world!");
});

app.use("/hometask_03/api", router);
app.use("/api/index.js", router);
app.use("", router);

app.use((err, req, res, next) => {
  console.error(err);
  res.sendStatus(500);
});

module.exports = app;
