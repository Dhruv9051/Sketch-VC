<div align="center">

# ⚡ Sketch VC

### A self-hosted, cloud-native deployment platform — deploy any GitHub repo to the web in seconds.

[![Node.js](https://img.shields.io/badge/Node.js-23-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![AWS](https://img.shields.io/badge/AWS-ECS%20%7C%20S3%20%7C%20ECR-FF9900?style=for-the-badge&logo=amazon-aws&logoColor=white)](https://aws.amazon.com)
[![Kafka](https://img.shields.io/badge/Apache%20Kafka-Streaming-231F20?style=for-the-badge&logo=apache-kafka&logoColor=white)](https://kafka.apache.org)
[![ClickHouse](https://img.shields.io/badge/ClickHouse-Analytics-FFCC01?style=for-the-badge&logo=clickhouse&logoColor=black)](https://clickhouse.com)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://prisma.io)
[![Docker](https://img.shields.io/badge/Docker-Containerized-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)

<br/>

> Paste a GitHub URL → Get a live, publicly accessible web app. No configuration needed.

<br/>

<img width="2560" height="1406" alt="image" src="https://github.com/user-attachments/assets/732ccca2-d39d-4933-9a71-a238e7a87ded" />


</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [System Architecture](#-system-architecture)
- [Project Structure](#-project-structure)
- [Services Deep Dive](#-services-deep-dive)
- [Data Flow](#-data-flow)
- [Tech Stack](#-tech-stack)
- [Environment Variables](#-environment-variables)
- [Getting Started](#-getting-started)
- [API Reference](#-api-reference)
- [How It Works](#-how-it-works)

---

## 🌐 Overview

**Sketch VC** is a full-stack, production-grade deployment platform inspired by Vercel. It allows users to deploy any public GitHub repository (React, Vite, CRA, or any Node.js web project) to the web instantly — with real-time build logs, persistent log storage, and automatic asset serving via a smart reverse proxy.

### ✨ Key Features

| Feature | Description |
|---|---|
| 🚀 **One-Click Deploy** | Paste a GitHub URL and deploy immediately |
| 📡 **Real-Time Logs** | Live build output streamed via WebSockets |
| 📦 **Auto Framework Detection** | Handles Vite, Create React App, and more |
| 🗂️ **Persistent Log History** | All logs stored in ClickHouse for replay |
| 🔁 **Redeploy Support** | Retrigger builds for existing projects |
| 🌍 **Smart Reverse Proxy** | Subdomain-based routing to S3 assets |
| ☁️ **Serverless Build Runners** | ECS Fargate tasks — scale to zero |

---

## 🏗 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER BROWSER                               │
│                      (React Frontend)                                │
└───────────────┬───────────────────────────────────────┬─────────────┘
                │ HTTP REST + WebSocket                  │ HTTP (visit app)
                ▼                                        ▼
┌──────────────────────────┐              ┌──────────────────────────┐
│       API SERVER          │              │     S3 REVERSE PROXY     │
│  (Express + Socket.IO)    │              │       (Express)          │
│  Port 9000                │              │  Port 8000               │
│                           │              │                          │
│ • POST /project           │              │ • Slug → S3 routing      │
│ • POST /deploy            │              │ • Referer-based fallback │
│ • GET  /logs/:id          │              │ • Cookie session tracking│
│ • WS   subscribe          │              └────────────┬─────────────┘
└──────┬────────────────────┘                           │
       │ RunTask (AWS SDK)                              │ Proxy to S3
       ▼                                                ▼
┌─────────────────┐                     ┌──────────────────────────────┐
│  AWS ECS Fargate │                     │          AWS S3              │
│  (Build Runner)  │                     │                              │
│                  │                     │  __outputs/                  │
│ Dockerized Node  │ ──── Uploads ──────▶│  └── {projectId}/           │
│ script.js        │     build assets    │      ├── index.html          │
│                  │                     │      ├── assets/             │
└──────┬───────────┘                     │      └── ...                 │
       │ Publishes logs                  └──────────────────────────────┘
       ▼
┌─────────────────────────────────────────────┐
│              Apache Kafka                    │
│         Topic: container-logs               │
└──────────────────┬──────────────────────────┘
                   │ Consumed by API Server
                   ▼
┌─────────────────────────────────────────────┐
│              ClickHouse DB                  │
│         Table: log_events                   │
│  (event_id, deployment_id, log, timestamp)  │
└─────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
vercel-clone/
│
├── 📂 api-server/                  # Core orchestration service
│   ├── prisma/
│   │   ├── schema.prisma           # Project & Deployment models
│   │   ├── migrations/             # DB migration history
│   │   └── ca.pem                  # Kafka SSL certificate
│   ├── index.js                    # Express + Socket.IO + Kafka consumer
│   ├── .env                        # Environment config
│   └── package.json
│
├── 📂 build-server/                # Dockerized build runner (runs on ECS)
│   ├── Dockerfile                  # Container definition
│   ├── script.js                   # Clone → Build → Upload logic
│   ├── main.sh                     # Container entrypoint
│   ├── kafka.pem                   # Kafka SSL certificate
│   └── package.json
│
├── 📂 frontend/                    # React + Vite user interface
│   ├── src/
│   │   └── App.jsx                 # Full UI: deploy form, logs, status
│   ├── public/
│   ├── .env                        # VITE_API_URL, VITE_PROXY_URL
│   ├── tailwind.config.js
│   └── vite.config.js
│
└── 📂 s3-reverse-proxy/            # Asset serving & routing layer
    ├── prisma/
    │   └── schema.prisma           # Shared project model
    ├── index.js                    # Proxy server with slug routing
    ├── .env
    └── package.json
```

---

## 🔬 Services Deep Dive

### 1. 🖥️ API Server (`api-server/`)

The central nervous system of the platform. Handles all incoming requests, orchestrates deployments, and bridges real-time log streaming.

**Responsibilities:**
- Accepts project creation and deployment requests via REST endpoints
- Triggers AWS ECS Fargate tasks with per-deployment environment variables
- Consumes build logs from Kafka and persists them to ClickHouse
- Relays live logs to connected browser clients via Socket.IO rooms
- Exposes historical log retrieval for reconnecting clients

**Key Dependencies:** `express`, `@aws-sdk/client-ecs`, `socket.io`, `kafkajs`, `@clickhouse/client`, `@prisma/client`, `zod`

---

### 2. 🏗️ Build Server (`build-server/`)

A fully self-contained Docker image that runs ephemerally on AWS ECS Fargate. Each deployment spins up a fresh container, builds the project, and terminates.

**Build Pipeline:**
```
1. Clone GitHub repo         →  git clone <GIT_REPO_URL> .
2. Detect framework          →  Reads package.json dependencies
3. Apply framework patches   →  Sets homepage / --base=./ for relative paths
4. Install dependencies      →  npm install
5. Build project             →  npm run build
6. Locate output folder      →  Checks dist/ then build/
7. Upload assets to S3       →  PutObject for each file with correct MIME type
8. Publish logs throughout   →  Kafka → API Server → Browser
```

**Framework Support:**
- ✅ Vite — applies `--base=./` flag
- ✅ Create React App — sets `"homepage": "."` in package.json
- ✅ Any npm-based project with a `build` script

---

### 3. 🔀 S3 Reverse Proxy (`s3-reverse-proxy/`)

An intelligent routing layer that maps incoming requests to the correct project's S3 assets. Handles multi-level asset resolution using a three-tier lookup strategy.

**Routing Strategy (in priority order):**

```
Request comes in
      │
      ▼
1. Extract slug from URL path  →  /my-project/index.html
      │ (found? use it)
      ▼
2. Check Referer header        →  Browser fetching assets after page load
      │ (found slug in referer? use parent project)
      ▼
3. Check Cookie                →  activeProject cookie from previous visit
      │
      ▼
4. 404 — Project Not Found
```

This ensures CSS, JS, image assets, and other sub-resources load correctly even when the browser requests them from the root path.

---

### 4. 🎨 Frontend (`frontend/`)

A sleek React + Tailwind UI that provides a seamless deployment experience.

**UI States:**
- `idle` → Input form ready for a GitHub URL
- `deploying` → Creating project & triggering ECS task
- `building` → Streaming real-time build logs via WebSocket
- `success` → Displays the live deployment URL
- `error` → Shows error details with a Redeploy button

**Real-Time Mechanism:**
```
Browser                        API Server
   │                               │
   │── socket.emit("subscribe") ──▶│  join room "logs:{deploymentId}"
   │                               │
   │◀── socket.emit("message") ───│  relay Kafka messages
   │                               │
   │  (on reconnect)               │
   │── GET /logs/:id ─────────────▶│  fetch historical logs from ClickHouse
```

---

## 🔄 Data Flow

### Deployment Lifecycle

```
User submits GitHub URL
        │
        ▼
POST /project  ──▶  Prisma creates Project record (subDomain = random slug)
        │
        ▼
POST /deploy   ──▶  Prisma creates Deployment record (status: QUEUED)
        │
        ▼
ECS RunTask    ──▶  Fargate container starts with env vars:
                    GIT_REPO_URL, PROJECT_ID, DEPLOYMENT_ID
        │
        ▼
script.js runs ──▶  Clones → Builds → Uploads → Publishes logs to Kafka
        │
        ▼
Kafka consumer ──▶  API Server reads messages from "container-logs" topic
        │
        ├──▶  Socket.IO emits to "logs:{deploymentId}" room (real-time)
        │
        └──▶  ClickHouse inserts log_events row (persistent)
        │
        ▼
"Upload completed" log ──▶  Frontend transitions to "success" state
        │
        ▼
User visits: http://{proxy-domain}/{subDomain}
        │
        ▼
Reverse Proxy  ──▶  Looks up subDomain in DB  ──▶  Serves from S3
```

---

## 🛠 Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 19 + Vite | User interface |
| **Styling** | Tailwind CSS | Utility-first styles |
| **Icons** | Lucide React | UI iconography |
| **API Server** | Node.js + Express | REST API & orchestration |
| **WebSockets** | Socket.IO | Real-time log streaming |
| **Database** | PostgreSQL + Prisma | Project & deployment records |
| **Message Queue** | Apache Kafka | Async log pipeline |
| **Analytics DB** | ClickHouse | High-performance log storage |
| **Build Runner** | Docker + ECS Fargate | Isolated, scalable builds |
| **Asset Storage** | AWS S3 | Built file hosting |
| **Proxy** | http-proxy (Node) | S3 asset routing |
| **Validation** | Zod | Runtime request validation |
| **Slug Gen** | random-word-slugs | Human-readable project URLs |

---

## 🔐 Environment Variables

### `api-server/.env`

```env
# Server
PORT=9000

# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# ClickHouse
CLICKHOUSE_URL=https://your-clickhouse-host
CLICKHOUSE_DB=default
CLICKHOUSE_USERNAME=default
CLICKHOUSE_PASSWORD=your_password

# Kafka
KAFKA_BROKER=your-broker:9092
KAFKA_CA_CERT=-----BEGIN CERTIFICATE-----...
KAFKA_USERNAME=your_username
KAFKA_PASSWORD=your_password
KAFKA_CONSUMER_GROUP_ID=api-server-group

# AWS ECS
ECS_ACCESS_KEY_ID=AKIA...
ECS_SECRET_ACCESS_KEY=...
ECS_REGION=us-east-1
ECS_CLUSTER=your-cluster-arn
ECS_TASK_DEFINITION=your-task-def-arn
ECS_LAUNCH_TYPE=FARGATE
ECS_SUBNETS=subnet-xxx,subnet-yyy
ECS_SECURITY_GROUPS=sg-xxx
```

### `build-server/.env` (passed via ECS task overrides)

```env
GIT_REPO_URL=           # Injected per deployment
PROJECT_ID=             # Injected per deployment
DEPLOYMENT_ID=          # Injected per deployment

AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_BUCKET_NAME=your-bucket

KAFKA_BROKER=your-broker:9092
KAFKA_USERNAME=your_username
KAFKA_PASSWORD=your_password
```

### `s3-reverse-proxy/.env`

```env
PORT=8000
DATABASE_URL=postgresql://user:pass@host:5432/db
BASE_PATH=https://your-bucket.s3.amazonaws.com/__outputs/
```

### `frontend/.env`

```env
VITE_API_URL=http://localhost:9000
VITE_PROXY_URL=http://localhost:8000
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Docker & Docker CLI
- AWS account (S3, ECS Fargate, IAM)
- Kafka cluster (Upstash, Confluent, or self-hosted)
- ClickHouse instance
- PostgreSQL database

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/vercel-clone.git
cd vercel-clone
```

### 2. Set Up the Database

```bash
cd api-server
npm install
npx prisma migrate dev
```

### 3. Start the API Server

```bash
cd api-server
cp .env.example .env   # Fill in your values
node index.js
# → API & Socket Server running on port 9000
```

### 4. Build & Push the Docker Image

```bash
cd build-server
docker build -t sketch-vc-builder .
docker tag sketch-vc-builder:latest <your-ecr-repo>:latest
docker push <your-ecr-repo>:latest
```

> Register this image as an ECS Task Definition and configure the environment variables listed above.

### 5. Set Up the Reverse Proxy

```bash
cd s3-reverse-proxy
npm install
npx prisma generate
node index.js
# → Proxy running on port 8000
```

### 6. Launch the Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

---

## 📡 API Reference

### `POST /project`
Creates a new project with a unique subdomain.

**Request Body:**
```json
{
  "name": "my-project",
  "gitUrl": "https://github.com/username/repo"
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "project": {
      "id": "uuid",
      "name": "my-project",
      "gitUrl": "https://github.com/username/repo",
      "subDomain": "happy-golden-panda"
    }
  }
}
```

---

### `POST /deploy`
Triggers a new deployment for an existing project.

**Request Body:**
```json
{
  "projectId": "uuid"
}
```

**Response:**
```json
{
  "status": "queued",
  "data": {
    "deploymentId": "uuid"
  }
}
```

---

### `GET /logs/:deploymentId`
Retrieves all stored logs for a given deployment from ClickHouse.

**Response:**
```json
{
  "logs": [
    {
      "event_id": "uuid",
      "deployment_id": "uuid",
      "log": "Build Service Started...",
      "timestamp": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

### WebSocket Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `subscribe` | Client → Server | `"logs:{deploymentId}"` | Join a deployment log room |
| `message` | Server → Client | `"log string"` | Receive a log line |

---

## 🔍 How It Works

### Framework Auto-Detection

The build server inspects `package.json` before building to apply necessary patches for relative asset paths — critical for serving apps from S3 subdirectories:

```js
if (dependencies['react-scripts']) {
  // Ensures assets load with relative paths
  packageJson.homepage = '.';
}
else if (dependencies['vite']) {
  // Equivalent for Vite builds
  packageJson.scripts.build = '... vite build --base=./';
}
```

### Real-Time Log Pipeline

Logs flow through a multi-hop pipeline with no loss:

```
ECS Container stdout/stderr
        ↓
Kafka Producer (in script.js)
        ↓
Kafka Topic: container-logs
        ↓
Kafka Consumer (in api-server/index.js)
        ↓
    ┌───┴───┐
    ↓       ↓
Socket.IO  ClickHouse
(live)     (persistent)
```

This decoupled design means logs are never lost — even if the browser disconnects, it can fetch the full history from `/logs/:id`.

### Subdomain Routing

Each project gets a unique slug (e.g., `happy-golden-panda`) generated by `random-word-slugs`. The S3 reverse proxy maps:

```
http://proxy:8000/happy-golden-panda/  →  s3://bucket/__outputs/{projectId}/index.html
```

---

<div align="center">

Built with ☕ and way too many AWS console tabs.

</div>
