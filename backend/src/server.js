import http from "http";
import dotenv from "dotenv";
import { app } from "./app.js";
import { attachWebSocketServer } from "./services/websocketServer.js";
import { logger } from "./utils/logger.js";

dotenv.config();

const PORT = process.env.PORT || 4000;

const server = http.createServer(app);
attachWebSocketServer(server);

server.listen(PORT, () => {
  logger.info(`SignBuddy backend listening on port ${PORT}`);
  logger.info(`WebSocket recognition channel at ws://localhost:${PORT}/ws/recognize`);
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  server.close(() => process.exit(0));
});
