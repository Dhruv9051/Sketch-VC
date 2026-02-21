require("dotenv").config();

const express = require("express");

const { generateSlug } = require("random-word-slugs");

const { ECSClient, RunTaskCommand } = require("@aws-sdk/client-ecs");

const { Server } = require("socket.io");

const cors = require("cors");

const { z } = require("zod");

const { PrismaClient } = require("@prisma/client");

const { createClient } = require("@clickhouse/client");

const { Kafka } = require("kafkajs");

const { v4: uuidv4 } = require("uuid");

const fs = require("fs");

const path = require("path");

const http = require("http");

const app = express();

const PORT = process.env.PORT || 9000;

app.use(express.json());

app.use(cors());

const httpServer = http.createServer(app);

const prisma = new PrismaClient({});

const io = new Server(httpServer, {
  cors: {
    origin: "*",

    methods: ["GET", "POST"],

    credentials: true,
  },

  transports: ["websocket", "polling"],
});

const client = createClient({
  url: process.env.CLICKHOUSE_URL,

  database: process.env.CLICKHOUSE_DB,

  username: process.env.CLICKHOUSE_USERNAME,

  password: process.env.CLICKHOUSE_PASSWORD,
});

const kafka = new Kafka({
  clientId: "api-server",

  brokers: [process.env.KAFKA_BROKER],

  ssl: {
    ca: [process.env.KAFKA_CA_CERT],
  },

  sasl: {
    username: process.env.KAFKA_USERNAME,

    password: process.env.KAFKA_PASSWORD,

    mechanism: "plain",
  },
});

const consumer = kafka.consumer({
  groupId: process.env.KAFKA_CONSUMER_GROUP_ID,
});

const ecsClient = new ECSClient({
  credentials: {
    accessKeyId: process.env.ECS_ACCESS_KEY_ID,

    secretAccessKey: process.env.ECS_SECRET_ACCESS_KEY,
  },
  region: process.env.ECS_REGION,
});

app.post("/project", async (req, res) => {
  const schema = z.object({
    name: z.string(),

    gitUrl: z.string(),
  });

  const safeParseResult = schema.safeParse(req.body);

  if (safeParseResult.error)
    return res.status(400).json({ error: safeParseResult.error });

  const { name, gitUrl } = safeParseResult.data;

  const project = await prisma.project.create({
    data: {
      name,

      gitUrl,

      subDomain: generateSlug(),
    },
  });

  return res.json({ status: "success", data: { project } });
});

app.post("/deploy", async (req, res) => {
  const schema = z.object({
    projectId: z.string(),
  });

  const safeParseResult = schema.safeParse(req.body);

  if (safeParseResult.error)
    return res.status(400).json({ error: safeParseResult.error });

  const { projectId } = safeParseResult.data;

  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
    },
  });

  if (!project) return res.status(404).json({ error: "Project not found" });

  // Check if there are no running deployments

  const deployment = await prisma.deployment.create({
    data: {
      project: {
        connect: {
          id: projectId,
        },
      },

      status: "QUEUED",
    },
  });

  const projectSlug = project.subDomain;

  // Spin the container

  const command = new RunTaskCommand({
    cluster: process.env.ECS_CLUSTER,

    taskDefinition: process.env.ECS_TASK_DEFINITION,

    launchType: process.env.ECS_LAUNCH_TYPE,

    count: 1,

    networkConfiguration: {
      awsvpcConfiguration: {
        assignPublicIp: "ENABLED",

        subnets: process.env.ECS_SUBNETS
          ? process.env.ECS_SUBNETS.split(",")
          : [],

        securityGroups: process.env.ECS_SECURITY_GROUPS
          ? process.env.ECS_SECURITY_GROUPS.split(",")
          : [],
      },
    },

    overrides: {
      containerOverrides: [
        {
          name: "builder-image",

          environment: [
            { name: "GIT_REPO_URL", value: project.gitUrl },

            { name: "PROJECT_ID", value: projectId },

            { name: "DEPLOYMENT_ID", value: deployment.id },
          ],
        },
      ],
    },
  });

  await ecsClient.send(command);

  return res.json({ status: "queued", data: { deploymentId: deployment.id } });
});

app.get("/logs/:id", async (req, res) => {
  const id = req.params.id;

  const logs = await client
    .query({
      query: `SELECT event_id, deployment_id, log, timestamp FROM log_events WHERE deployment_id='${id}'`,

      format: "JSONEachRow",
    })
    .then((result) => result.json());

  return res.json({ logs });
});

async function kafkaConsumer() {
  await consumer.connect();

  await consumer.subscribe({ topics: ["container-logs"] });

  await consumer.run({
    autoCommit: false,

    eachBatch: async ({
      batch,
      heartbeat,
      commitOffsetsIfNecessary,
      resolveOffset,
    }) => {
      const messages = batch.messages;

      console.log(`Received batch of ${messages.length} messages`);

      for (const message of messages) {
        // Parse message

        const payload = JSON.parse(message.value.toString());

        // Extract ID

        const activeDeploymentId =
          payload.DEPLOYMENT_ID || payload.deploymentId;

        const logText = payload.log;

        const roomName = `logs:${activeDeploymentId}`;

        try {
          console.log(`Relaying log to Socket Room: ${roomName}`);

          io.to(roomName).emit("message", logText);

          await client.insert({
            table: "log_events",

            values: [
              {
                event_id: uuidv4(),

                deployment_id: activeDeploymentId,

                log: logText,
              },
            ],

            format: "JSONEachRow",
          });

          resolveOffset(message.offset);

          await commitOffsetsIfNecessary(message.offset);

          await heartbeat();
        } catch (e) {
          console.log(e);
        }
      }
    },
  });
}

kafkaConsumer();

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("subscribe", (channel) => {
    socket.join(channel);

    console.log(`Socket ${socket.id} joined room: ${channel}`);

    socket.emit("message", `[System] Joined channel: ${channel}`);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`API & Socket Server running on port ${PORT}`);
});
