require("dotenv").config();
const express = require("express");
const httpProxy = require("http-proxy");
const { PrismaClient } = require("@prisma/client");
const cookieParser = require("cookie-parser");

const app = express();
const prisma = new PrismaClient();

const BASE_PATH = process.env.BASE_PATH;
const PORT = process.env.PORT || 8000;

const proxy = httpProxy.createProxyServer({});

proxy.on("error", (err, req, res) => {
  console.error("Proxy error:", err);
  res.status(500).send("Proxy Error");
});

app.use(cookieParser());

app.use(async (req, res) => {
  try {
    const pathParts = req.url.split("/").filter(Boolean);
    let slug = pathParts[0];
    let project;

    // Check if the slug is directly in the URL
    const systemFiles = ['favicon.ico', 'manifest.json', 'robots.txt', 'logo192.png', 'logo512.png'];
    if (slug && !systemFiles.includes(slug) && slug !== 'static' && !slug.includes('.')) {
      project = await prisma.project.findFirst({ where: { subDomain: slug } });
    }

    // If it's an asset request, check the Referer header
    if (!project && req.headers.referer) {
      const refererUrl = new URL(req.headers.referer);
      const refererSlug = refererUrl.pathname.split('/').filter(Boolean)[0];
      
      if (refererSlug && !systemFiles.includes(refererSlug)) {
        project = await prisma.project.findFirst({ where: { subDomain: refererSlug } });
        slug = null; // Don't strip the slug because it's not in the current URL
      }
    }

    // Fallback to Cookie
    if (!project && req.cookies?.activeProject) {
      project = await prisma.project.findUnique({ where: { id: req.cookies.activeProject } });
      slug = null;
    }

    if (!project) return res.status(404).send("Project not found");

    // Keep the cookie updated for future use
    res.cookie("activeProject", project.id, { maxAge: 900000, httpOnly: true, sameSite: "Lax", path: "/" });

    const target = `${BASE_PATH}${project.id}/`;

    // URL Preparation for S3
    if (slug) req.url = req.url.replace(`/${slug}`, "");
    if (!req.url || req.url === "/" || req.url === "") req.url = "/index.html";

    console.log(`Proxying ${req.url} for ${project.subDomain} to ${target}`);
    return proxy.web(req, res, { target, changeOrigin: true });
  } catch (err) {
    console.error("Proxy Error:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Proxy running on ${PORT}`);
});
