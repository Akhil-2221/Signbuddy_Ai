import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

import authRoutes from "./routes/authRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import tutorRoutes from "./routes/tutorRoutes.js";
import emergencyRoutes from "./routes/emergencyRoutes.js";
import dictionaryRoutes from "./routes/dictionaryRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { checkAiServiceHealth } from "./services/aiServiceClient.js";

dotenv.config();

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" })); // landmark frame batches can be sizable
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max: Number(process.env.RATE_LIMIT_MAX) || 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limiter);

app.get("/health", async (req, res) => {
  const aiHealthy = await checkAiServiceHealth().catch(() => false);
  res.json({
    status: "ok",
    aiService: aiHealthy ? "healthy" : "unreachable",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/sessions", sessionRoutes);
app.use("/api/v1/tutor", tutorRoutes);
app.use("/api/v1/emergency-phrases", emergencyRoutes);
app.use("/api/v1/dictionary", dictionaryRoutes);
app.use("/api/v1/users", userRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
