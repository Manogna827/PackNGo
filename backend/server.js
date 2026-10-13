import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(currentDir, ".env") });

const [{ default: cors }, { default: express }, { default: helmet }, { default: rateLimit }, { db }, { HttpError }, { apiRouter }] = await Promise.all([
  import("cors"),
  import("express"),
  import("helmet"),
  import("express-rate-limit"),
  import("./config/firebase.js"),
  import("./lib/errors.js"),
  import("./routes/api.js")
]);

const app = express();
const port = Number(process.env.PORT || 5000);
const frontendDir = path.resolve(currentDir, "../frontend");
const configuredOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

app.disable("x-powered-by");
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://www.gstatic.com"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com", "https://res.cloudinary.com"],
      connectSrc: ["'self'", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com", "https://firestore.googleapis.com", "http://localhost:*", "http://127.0.0.1:*"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (!origin) return next();
  let sameOrigin = false;
  try {
    const parsed = new URL(origin);
    sameOrigin = parsed.host.toLowerCase() === req.get("host")?.toLowerCase() &&
      parsed.protocol === `${req.protocol}:`;
  } catch {
    return next(new HttpError(403, "This origin is not allowed to access PackNGo."));
  }
  if (!sameOrigin && !configuredOrigins.includes(origin)) {
    return next(new HttpError(403, "This origin is not allowed to access PackNGo."));
  }
  cors({
    origin,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600
  })(req, res, next);
});
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  if (req.body === undefined) req.body = {};
  if (req.body === null || typeof req.body !== "object" || Array.isArray(req.body)) {
    return next(new HttpError(400, "Request body must be a JSON object."));
  }
  next();
});
app.use("/api", rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false
}));

app.get("/api/health", async (_req, res, next) => {
  try {
    await db.collection("_health").doc("probe").get();
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/config", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    firebase: {
      apiKey: process.env.FIREBASE_API_KEY || "",
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
      projectId: process.env.FIREBASE_PROJECT_ID || "",
      appId: process.env.FIREBASE_APP_ID || "",
      authEmulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST || ""
    },
    services: {
      cloudinary: Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
      destinationGuide: Boolean(process.env.GEMINI_API_KEY)
    }
  });
});

app.use("/api", apiRouter);
app.use(express.static(frontendDir, { extensions: ["html"], maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
app.get("/", (_req, res) => res.sendFile(path.join(frontendDir, "index.html")));

app.use((req, _res, next) => next(new HttpError(404, "That page or API endpoint was not found.")));
app.use((error, _req, res, _next) => {
  const status = error instanceof HttpError ? error.status : Number(error.status) || 500;
  if (status >= 500) console.error(error);
  const message = status >= 500 ? "PackNGo could not complete that request. Please try again." : error.message;
  res.status(status).json({ error: message });
});

app.listen(port, () => console.log(`PackNGo is listening on port ${port}.`));
